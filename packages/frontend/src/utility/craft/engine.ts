/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BLOCK, BLOCK_DEFS, ITEM_DEFS, MOB_DEFS, PLAYER, daylight, isBlockItem } from './constants.js';
import type { MobType, Recipe } from './constants.js';
import type { BlockHit, InputState, ItemStack, MobHit, MobSnapshot, PlayerStats, RemotePlayerInfo } from './types.js';
import { CraftWorld } from './world.js';
import { CraftRenderer } from './renderer.js';
import type { EntityDraw } from './models.js';
import { Player } from './player.js';
import { MobSystem } from './mobs.js';
import { InputController } from './input.js';
import type { InputMode, TouchElements } from './input.js';
import { Minimap } from './minimap.js';
import { attackDamage, breakTime, dropsFor } from './mining.js';
import { availableRecipes, craft, isNearCraftingTable } from './crafting.js';
import { isHeadInWater } from './physics.js';
import { lookDir, project } from './math.js';

export type RemotePlayer = RemotePlayerInfo & {
	x: number; y: number; z: number;
	yaw: number; pitch: number;
	tx: number; ty: number; tz: number;
	walkPhase: number;
	lastSeen: number;
	color: string;
};

export type EngineEvents = {
	/** サーバーへ送る */
	setBlock: (x: number, y: number, z: number, type: number) => void;
	move: (x: number, y: number, z: number, yaw: number, pitch: number) => void;
	mobs: (snapshot: MobSnapshot) => void;
	mobHit: (hit: MobHit) => void;
	/** UI 向け */
	hotbarChange: (index: number) => void;
	inventoryChange: () => void;
	statsChange: (stats: PlayerStats) => void;
	activeChange: (active: boolean) => void;
	fullscreenChange: (fullscreen: boolean) => void;
	hostChange: (isHost: boolean) => void;
	died: () => void;
	toggleInventory: () => void;
	openCrafting: () => void;
	playersChange: () => void;
};

const REMOTE_TIMEOUT = 15000;
const MOVE_SEND_INTERVAL = 100;
const MOVE_HEARTBEAT_INTERVAL = 5000;
const MOB_BROADCAST_INTERVAL = 200;
const ATTACK_COOLDOWN = 450;
const MINIMAP_INTERVAL = 500;

function colorFromId(id: string): string {
	let h = 0;
	for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
	return `hsl(${h % 360}, 60%, 55%)`;
}

export type EngineState = {
	inventory: (number[] | null)[];
	stats: PlayerStats;
	pos: { x: number; y: number; z: number };
	yaw: number;
	pitch: number;
	hotbarIndex: number;
};

/**
 * 画面 (canvas) への描画・入力・物理・MOB を束ねる。ネットワークは持たず、
 * 自分の操作はイベントで外へ出し、他人の操作は apply* で受け取る。
 */
export class CraftEngine {
	public readonly world: CraftWorld;
	public readonly player: Player;
	public readonly mobs: MobSystem;
	public readonly input: InputController;
	private renderer: CraftRenderer;
	private minimap: Minimap | null = null;
	private raf = 0;
	private lastTime = 0;
	private lastMoveSent = 0;
	private lastSent = { x: NaN, y: NaN, z: NaN, yaw: NaN, pitch: NaN };
	private lastMobBroadcast = 0;
	private lastMinimap = 0;
	private lastAttackAt = 0;
	private lastStatsEmit = 0;
	private breakProgress = 0;
	private breakTarget: string | null = null;
	/** サーバーに送った設置・破壊のうち未確定のもの (key → 変更前の type、消費したアイテム、得たドロップ) */
	private pendingEdits = new Map<string, { prev: number; placed: number | null; dropped: ItemStack }>();
	/** 自分が倒した MOB (古いスナップショットで復活させない)。id → 時刻 */
	private killedMobs = new Map<string, number>();
	/** MOB ごとに最後に受けた攻撃の時刻 (スナップショットの改ざんや重複で連続ダメージを受けない) */
	private lastMobAttackAt = new Map<string, number>();
	/** 同じユーザーが複数タブで入っても MOB の id が衝突しないようにする */
	private readonly sessionNonce = Math.random().toString(36).slice(2, 8);
	private lastHostCheck = 0;
	private listeners: Partial<EngineEvents> = {};
	private disposed = false;
	private spawnPoint = { x: 0, z: 0 };
	/** 最後に見たホストの配信 */
	private lastSnapshotHost: { id: string; at: number } | null = null;
	public localUserId: string | null = null;
	private canBuildValue = false;
	public get canBuild(): boolean {
		return this.canBuildValue;
	}
	public set canBuild(v: boolean) {
		this.canBuildValue = v;
		this.updateHost();
	}
	/** インベントリなどの UI を開いている間は入力を無視する */
	public uiOpen = false;
	public remotePlayers = new Map<string, RemotePlayer>();
	public target: BlockHit | null = null;
	public targetMob: string | null = null;

	constructor(private canvas: HTMLCanvasElement, stage: HTMLElement, seed: number) {
		this.world = new CraftWorld(seed);
		this.player = new Player(this.world);
		this.mobs = new MobSystem(this.world);
		this.renderer = new CraftRenderer(canvas, this.world);
		this.input = new InputController({ canvas, stage });
		this.input.on('activeChange', (v) => this.listeners.activeChange?.(v));
		this.input.on('fullscreenChange', (v) => this.listeners.fullscreenChange?.(v));
	}

	public on<K extends keyof EngineEvents>(event: K, fn: EngineEvents[K]): void {
		this.listeners[event] = fn;
	}

	public start(state?: EngineState | null): void {
		this.spawnPoint = this.world.findSpawn();
		if (state != null) {
			this.player.inventory.load(state.inventory);
			this.player.stats.health = Math.max(1, Math.min(PLAYER.maxHealth, state.stats.health));
			this.player.stats.hunger = Math.max(0, Math.min(PLAYER.maxHunger, state.stats.hunger));
			this.player.stats.air = PLAYER.maxAir;
			this.player.pos.x = state.pos.x;
			this.player.pos.y = state.pos.y;
			this.player.pos.z = state.pos.z;
			this.player.yaw = state.yaw;
			this.player.pitch = state.pitch;
			this.player.hotbarIndex = Math.max(0, Math.min(PLAYER.hotbarSize - 1, state.hotbarIndex));
			// 保存位置が埋まっていたら地表へ
			if (this.world.getBlock(Math.floor(state.pos.x), Math.floor(state.pos.y), Math.floor(state.pos.z)) !== BLOCK.air) {
				this.player.pos.y = this.world.surfaceY(Math.floor(state.pos.x), Math.floor(state.pos.z));
			}
		} else {
			this.player.spawn(this.spawnPoint.x, this.spawnPoint.z);
		}
		this.lastTime = performance.now();
		this.updateHost();
		this.loop(this.lastTime);
	}

	public exportState(): EngineState {
		return {
			inventory: this.player.inventory.serialize(),
			stats: { ...this.player.stats },
			pos: { x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z },
			yaw: this.player.yaw,
			pitch: this.player.pitch,
			hotbarIndex: this.player.hotbarIndex,
		};
	}

	// ----- UI から呼ぶ -----

	public attachMinimap(canvas: HTMLCanvasElement | null): void {
		this.minimap?.dispose();
		this.minimap = canvas ? new Minimap(canvas, this.world) : null;
	}

	public bindTouchControls(els: TouchElements): void {
		this.input.bindTouchControls(els);
	}

	public setInputMode(mode: InputMode): void {
		this.input.setMode(mode);
	}

	public get inputMode(): InputMode {
		return this.input.mode;
	}

	public get isActive(): boolean {
		return this.input.active;
	}

	public startPlaying(): void {
		if (this.disposed) return;
		this.uiOpen = false;
		this.input.start();
	}

	public stopPlaying(): void {
		this.input.stop();
	}

	public toggleFullscreen(): Promise<void> {
		return this.input.toggleFullscreen();
	}

	public get isFullscreen(): boolean {
		return this.input.isFullscreen;
	}

	public selectHotbar(index: number): void {
		this.player.hotbarIndex = index;
		this.listeners.hotbarChange?.(index);
	}

	public get selectedStack(): ItemStack {
		return this.player.selectedStack;
	}

	public respawn(): void {
		this.player.respawn(this.spawnPoint.x, this.spawnPoint.z);
		this.emitStats(true);
	}

	public get nearTable(): boolean {
		return isNearCraftingTable(this.world, this.player.pos);
	}

	public recipes(): { recipe: Recipe; craftable: boolean }[] {
		return availableRecipes(this.player.inventory, this.nearTable);
	}

	public craftRecipe(recipe: Recipe): boolean {
		const ok = craft(this.player.inventory, recipe, this.nearTable);
		if (ok) this.listeners.inventoryChange?.();
		return ok;
	}

	public moveItem(from: number, to: number): void {
		this.player.inventory.move(from, to);
		this.listeners.inventoryChange?.();
	}

	public get isHost(): boolean {
		return this.mobs.isHost;
	}

	public get daylight(): number {
		return daylight();
	}

	// ----- ブロック操作 -----

	private blockKey(x: number, y: number, z: number): string {
		return `${x},${y},${z}`;
	}

	private localEdit(x: number, y: number, z: number, id: number, placed: number | null, dropped: ItemStack = null): void {
		const key = this.blockKey(x, y, z);
		const prev = this.world.getBlock(x, y, z);
		if (this.world.setBlock(x, y, z, id)) {
			if (!this.pendingEdits.has(key)) this.pendingEdits.set(key, { prev, placed, dropped });
			this.minimap?.invalidate(`${CraftWorld.toChunk(x)},${CraftWorld.toChunk(z)}`);
			this.listeners.setBlock?.(x, y, z, id);
		}
	}

	private finishBreak(hit: BlockHit): void {
		const id = this.world.getBlock(hit.x, hit.y, hit.z);
		if (id === BLOCK.air || BLOCK_DEFS[id]?.hardness === Infinity) return;
		const drop = dropsFor(id, this.player.selectedStack);
		this.localEdit(hit.x, hit.y, hit.z, BLOCK.air, null, drop);
		if (drop != null) {
			this.player.inventory.add(drop.id, drop.count);
			this.listeners.inventoryChange?.();
		}
	}

	private tryPlace(hit: BlockHit): void {
		const stack = this.player.selectedStack;
		if (stack == null || !isBlockItem(stack.id)) return;
		const x = hit.x + hit.nx;
		const y = hit.y + hit.ny;
		const z = hit.z + hit.nz;
		if (!this.world.inBounds(x, y, z)) return;
		const current = this.world.getBlock(x, y, z);
		if (current !== BLOCK.air && current !== BLOCK.water) return;
		if (this.player.overlapsBlock(x, y, z)) return;
		for (const p of this.remotePlayers.values()) {
			if (x + 1 > p.x - 0.3 && x < p.x + 0.3 && y + 1 > p.y && y < p.y + 1.8 && z + 1 > p.z - 0.3 && z < p.z + 0.3) return;
		}
		if (!this.player.inventory.take(this.player.hotbarIndex, 1)) return;
		this.listeners.inventoryChange?.();
		this.localEdit(x, y, z, stack.id, stack.id);
	}

	private tryUse(now: number): void {
		const stack = this.player.selectedStack;
		if (stack != null && ITEM_DEFS[stack.id]?.kind === 'food') {
			if (this.player.eat(now)) {
				this.listeners.inventoryChange?.();
				this.emitStats(true);
			}
			return;
		}
		if (!this.canBuild) return;
		if (this.target != null) {
			if (this.world.getBlock(this.target.x, this.target.y, this.target.z) === BLOCK.craftingTable) {
				this.listeners.openCrafting?.();
				return;
			}
			this.tryPlace(this.target);
		}
	}

	private tryAttack(now: number): void {
		if (this.targetMob == null) return;
		if (now - this.lastAttackAt < ATTACK_COOLDOWN) return;
		this.lastAttackAt = now;
		const [dx, , dz] = lookDir(this.player.yaw, 0);
		const hit: MobHit = { id: this.targetMob, damage: attackDamage(this.player.selectedStack), kx: dx, kz: dz };
		// ホストでなくても自分の画面には先に反映し、倒した判定もここで行う
		this.handleMobEvents(this.mobs.applyHit(hit, this.localUserId, now));
		if (!this.mobs.isHost) this.listeners.mobHit?.(hit);
	}

	private handleMobEvents(events: ReturnType<MobSystem['tick']>): void {
		for (const ev of events) {
			if (ev.type === 'attackPlayer') {
				if (ev.userId !== this.localUserId || this.player.isDead) continue;
				this.player.damage(ev.damage, performance.now());
				this.emitStats(true);
				if (this.player.isDead) this.listeners.died?.();
			} else if (ev.type === 'died') {
				this.killedMobs.set(ev.mobId, performance.now());
				if (ev.killerId === this.localUserId) {
					const drops = MOB_DEFS[ev.mobType].drops;
					if (drops) {
						this.player.inventory.add(drops.id, drops.count);
						this.listeners.inventoryChange?.();
					}
				}
			}
		}
	}

	// ----- サーバーから -----

	public applyRemoteBlock(x: number, y: number, z: number, type: number): void {
		this.pendingEdits.delete(this.blockKey(x, y, z));
		if (this.world.setBlock(x, y, z, type)) {
			this.minimap?.invalidate(`${CraftWorld.toChunk(x)},${CraftWorld.toChunk(z)}`);
		}
	}

	public revertLocalEdit(x: number, y: number, z: number): void {
		const key = this.blockKey(x, y, z);
		const pending = this.pendingEdits.get(key);
		if (pending == null) return;
		this.pendingEdits.delete(key);
		this.world.setBlock(x, y, z, pending.prev);
		if (pending.placed != null) {
			this.player.inventory.add(pending.placed, 1);
			this.listeners.inventoryChange?.();
		}
		if (pending.dropped != null) {
			this.player.inventory.remove(pending.dropped.id, pending.dropped.count);
			this.listeners.inventoryChange?.();
		}
	}

	/** 再接続時など、サーバーに届いたか分からない編集をすべて戻す */
	public revertAllPending(): void {
		for (const key of [...this.pendingEdits.keys()]) {
			const [x, y, z] = key.split(',').map(Number);
			this.revertLocalEdit(x, y, z);
		}
	}

	public applyRemotePlayer(p: RemotePlayerInfo & { x: number; y: number; z: number; yaw: number; pitch: number }): void {
		const existing = this.remotePlayers.get(p.userId);
		if (existing) {
			existing.tx = p.x; existing.ty = p.y; existing.tz = p.z;
			existing.yaw = p.yaw; existing.pitch = p.pitch;
			existing.username = p.username; existing.name = p.name; existing.avatarUrl = p.avatarUrl;
			if (existing.skinUrl !== p.skinUrl) {
				existing.skinUrl = p.skinUrl;
				this.renderer.preloadSkin(p.skinUrl);
			}
			existing.lastSeen = performance.now();
			return;
		}
		this.remotePlayers.set(p.userId, {
			...p,
			tx: p.x, ty: p.y, tz: p.z,
			walkPhase: 0,
			lastSeen: performance.now(),
			color: colorFromId(p.userId),
		});
		this.renderer.preloadSkin(p.skinUrl);
		this.listeners.playersChange?.();
		this.updateHost();
	}

	public removeRemotePlayer(userId: string): void {
		if (this.lastSnapshotHost?.id === userId) this.lastSnapshotHost = null;
		if (this.remotePlayers.delete(userId)) {
			this.listeners.playersChange?.();
		}
		this.updateHost();
	}

	public applyRemoteMobs(snapshot: MobSnapshot): void {
		if (snapshot.hostId === this.localUserId) return;
		this.lastSnapshotHost = { id: snapshot.hostId, at: performance.now() };
		this.updateHost();
		if (this.mobs.isHost) return; // 自分の方が若い id なら無視する (相手もすぐ降りる)
		if (this.electedHost() !== snapshot.hostId) return;
		const now = performance.now();
		for (const [id, at] of this.killedMobs) if (now - at > 3000) this.killedMobs.delete(id);
		const filteredSnapshot: MobSnapshot = { ...snapshot, mobs: snapshot.mobs.filter(m => !this.killedMobs.has(m.id)) };
		const events = this.mobs.applySnapshot(filteredSnapshot, now, this.localUserId);
		// 距離が遠い攻撃と、間隔の短すぎる攻撃は無視する
		const filtered = events.filter(ev => {
			if (ev.type !== 'attackPlayer') return true;
			const mob = snapshot.mobs.find(m => m.id === ev.mobId);
			if (mob == null) return false;
			const def = MOB_DEFS[mob.type as MobType];
			const d = Math.hypot(mob.x - this.player.pos.x, mob.z - this.player.pos.z);
			if (d > def.width / 2 + 2.2 || Math.abs(mob.y - this.player.pos.y) >= 2.5) return false;
			const last = this.lastMobAttackAt.get(mob.id) ?? -Infinity;
			if (now - last < def.attackInterval * 1000 * 0.8) return false;
			this.lastMobAttackAt.set(mob.id, now);
			return true;
		});
		this.handleMobEvents(filtered);
	}

	public applyRemoteMobHit(userId: string, hit: MobHit): void {
		if (userId === this.localUserId) return;
		this.handleMobEvents(this.mobs.applyHit(hit, userId, performance.now()));
	}

	/** 同席者のうち userId が最小の人がホスト */
	private electedHost(): string | null {
		if (this.localUserId == null) {
			// 見学者はホストにならず、配信してきた人をホストとみなす
			return this.lastSnapshotHost?.id ?? null;
		}
		let host = this.localUserId;
		for (const id of this.remotePlayers.keys()) if (id < host) host = id;
		if (this.lastSnapshotHost && performance.now() - this.lastSnapshotHost.at < 10000 && this.lastSnapshotHost.id < host) {
			host = this.lastSnapshotHost.id;
		}
		return host;
	}

	private updateHost(): void {
		const wasHost = this.mobs.isHost;
		// サーバーは「ワールドにいて建築できる人」の配信だけ中継するので、同じ条件で立候補する
		const isHost = this.localUserId != null && this.canBuild && this.electedHost() === this.localUserId;
		if (isHost !== wasHost) {
			this.mobs.isHost = isHost;
			if (isHost) this.mobs.clear();
			this.listeners.hostChange?.(isHost);
		}
	}

	// ----- 表示用 -----

	public remotePlayerScreenPositions(): { userId: string; x: number; y: number; dist: number }[] {
		const out: { userId: string; x: number; y: number; dist: number }[] = [];
		const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
		for (const p of this.remotePlayers.values()) {
			const pr = project(this.renderer.viewProj, p.x, p.y + 2.1, p.z);
			if (pr == null || pr.x < -1.1 || pr.x > 1.1 || pr.y < -1.1 || pr.y > 1.1) continue;
			out.push({
				userId: p.userId,
				x: (pr.x + 1) / 2 * w,
				y: (1 - pr.y) / 2 * h,
				dist: Math.hypot(p.x - this.player.pos.x, p.y - this.player.pos.y, p.z - this.player.pos.z),
			});
		}
		return out;
	}

	public get breakProgressValue(): number {
		return this.breakProgress;
	}

	private emitStats(force: boolean): void {
		const now = performance.now();
		if (!force && now - this.lastStatsEmit < 250) return;
		this.lastStatsEmit = now;
		this.listeners.statsChange?.({ ...this.player.stats });
	}

	// ----- ループ -----

	private loop = (now: number) => {
		if (this.disposed) return;
		this.raf = window.requestAnimationFrame(this.loop);
		const dt = Math.min(0.1, (now - this.lastTime) / 1000);
		this.lastTime = now;

		const raw = this.input.consumeFrame();
		const active = this.input.active && !this.uiOpen && !this.player.isDead;
		const input: InputState = active ? raw : { ...raw, forward: false, back: false, left: false, right: false, jump: false, sneak: false, sprint: false, attack: false, usePressed: false, lookDX: 0, lookDY: 0, hotbarDelta: 0, hotbarSelect: null };

		if (input.togglePressed && !this.player.isDead && this.input.active) {
			this.listeners.toggleInventory?.();
		}
		if (raw.fullscreenPressed && this.input.active) {
			this.input.toggleFullscreen().catch(() => {});
		}
		if (input.hotbarSelect != null) this.selectHotbar(input.hotbarSelect);
		if (input.hotbarDelta !== 0) {
			this.selectHotbar(((this.player.hotbarIndex + input.hotbarDelta) % PLAYER.hotbarSize + PLAYER.hotbarSize) % PLAYER.hotbarSize);
		}

		const events = this.player.update(dt, input, now);
		if (events.damaged > 0) this.emitStats(true);
		if (events.died) this.listeners.died?.();
		if (this.world.dirty.size > 0 && this.minimap) {
			for (const key of this.world.dirty) this.minimap.invalidate(key);
		}

		// 注視対象 (MOB が手前ならそちら)
		this.target = this.player.raycast(PLAYER.reach);
		const mobHit = this.mobs.raycast(this.player.pos.x, this.player.eyeY, this.player.pos.z, this.player.yaw, this.player.pitch, PLAYER.reach);
		this.targetMob = mobHit != null && (this.target == null || mobHit.dist < this.target.dist) ? mobHit.id : null;
		if (this.targetMob != null) this.target = null;

		// 採掘と攻撃
		if (active && input.attack) {
			if (this.targetMob != null) {
				this.tryAttack(now);
				this.breakProgress = 0;
				this.breakTarget = null;
			} else if (this.target != null && this.canBuild) {
				const key = this.blockKey(this.target.x, this.target.y, this.target.z);
				if (key !== this.breakTarget) {
					this.breakTarget = key;
					this.breakProgress = 0;
				}
				const id = this.world.getBlock(this.target.x, this.target.y, this.target.z);
				const time = breakTime(id, this.player.selectedStack);
				if (Number.isFinite(time)) {
					this.breakProgress += dt / time;
					if (this.breakProgress >= 1) {
						this.finishBreak(this.target);
						this.breakProgress = 0;
						this.breakTarget = null;
					}
				} else {
					this.breakProgress = 0;
				}
			} else {
				this.breakProgress = 0;
				this.breakTarget = null;
			}
		} else {
			this.breakProgress = 0;
			this.breakTarget = null;
		}
		if (active && input.usePressed) this.tryUse(now);

		// 他プレイヤーの補間と掃除
		for (const [id, p] of this.remotePlayers) {
			if (now - p.lastSeen > REMOTE_TIMEOUT) {
				this.remotePlayers.delete(id);
				this.listeners.playersChange?.();
				this.updateHost();
				continue;
			}
			const k = Math.min(1, dt * 12);
			const dx = (p.tx - p.x) * k, dz = (p.tz - p.z) * k;
			p.x += dx;
			p.y += (p.ty - p.y) * k;
			p.z += dz;
			const moved = Math.hypot(dx, dz);
			if (moved > 0.001) p.walkPhase = (p.walkPhase + moved * 6) % (Math.PI * 2);
		}

		// MOB
		if (now - this.lastHostCheck > 1000) {
			this.lastHostCheck = now;
			this.updateHost();
		}
		if (this.mobs.isHost && this.localUserId != null) {
			const players = [{ userId: this.localUserId, x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z }];
			for (const p of this.remotePlayers.values()) players.push({ userId: p.userId, x: p.x, y: p.y, z: p.z });
			this.handleMobEvents(this.mobs.tick(dt, now, players, `${this.localUserId}:${this.sessionNonce}`));
			if (now - this.lastMobBroadcast >= MOB_BROADCAST_INTERVAL) {
				this.lastMobBroadcast = now;
				this.listeners.mobs?.(this.mobs.snapshot(this.localUserId));
			}
		} else {
			this.mobs.interpolate(dt);
		}

		// 描画
		this.renderer.updateChunks(this.player.pos.x, this.player.pos.z);
		const entities: EntityDraw[] = [];
		for (const p of this.remotePlayers.values()) {
			entities.push({ kind: 'player', x: p.x, y: p.y, z: p.z, yaw: p.yaw, skinUrl: p.skinUrl, walkPhase: p.walkPhase });
		}
		for (const m of this.mobs.drawList(now)) {
			entities.push({ kind: m.type, x: m.x, y: m.y, z: m.z, yaw: m.yaw, walkPhase: m.walkPhase, hurt: m.hurt });
		}
		const light = daylight();
		this.renderer.render({
			eyeX: this.player.pos.x, eyeY: this.player.eyeY, eyeZ: this.player.pos.z,
			yaw: this.player.yaw, pitch: this.player.pitch,
			target: this.target,
			breakProgress: this.breakProgress,
			daylight: light,
			underwater: isHeadInWater(this.world, this.player.pos, PLAYER.eyeHeight),
			entities,
		});

		if (this.minimap && now - this.lastMinimap >= MINIMAP_INTERVAL) {
			this.lastMinimap = now;
			this.minimap.render({
				x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw,
				players: [...this.remotePlayers.values()].map(p => ({ x: p.x, z: p.z, color: p.color })),
				mobs: this.mobs.drawList(now).map(m => ({ x: m.x, z: m.z, type: m.type })),
				daylight: light,
			});
		}

		this.emitStats(false);

		// 位置の送信 (動いていなくても 5 秒ごと)
		if (this.localUserId != null && now - this.lastMoveSent >= MOVE_SEND_INTERVAL) {
			const p = this.player;
			const s = this.lastSent;
			const changed = Math.abs(p.pos.x - s.x) > 0.01 || Math.abs(p.pos.y - s.y) > 0.01 || Math.abs(p.pos.z - s.z) > 0.01 || Math.abs(p.yaw - s.yaw) > 0.01 || Math.abs(p.pitch - s.pitch) > 0.01;
			if (changed || now - this.lastMoveSent >= MOVE_HEARTBEAT_INTERVAL) {
				this.lastSent = { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, pitch: p.pitch };
				this.lastMoveSent = now;
				this.listeners.move?.(
					Math.round(p.pos.x * 100) / 100, Math.round(p.pos.y * 100) / 100, Math.round(p.pos.z * 100) / 100,
					Math.round(p.yaw * 1000) / 1000, Math.round(p.pitch * 1000) / 1000,
				);
			}
		}
	};

	public dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		window.cancelAnimationFrame(this.raf);
		this.input.dispose();
		this.minimap?.dispose();
		this.renderer.dispose();
	}
}
