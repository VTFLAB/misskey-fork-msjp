/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BLOCK, BLOCK_DEFS, GACHA_TIERS, ITEM, ITEM_DEFS, MOB_DEFS, PLAYER, WORLD, daylight, isBlockItem, timeOfDay } from './constants.js';
import type { EnchantId, GachaTier, MobType, Recipe } from './constants.js';
import type { BlockHit, InputState, ItemStack, MobHit, MobSnapshot, PlayerStats, RemotePlayerInfo, SerializedStack, SoundMaterial } from './types.js';
import { CraftWorld } from './world.js';
import { CraftRenderer } from './renderer.js';
import type { EntityDraw } from './models.js';
import { Player } from './player.js';
import type { DamageSource } from './player.js';
import { MobSystem } from './mobs.js';
import type { MobEvent } from './mobs.js';
import { ProjectileSystem } from './projectiles.js';
import { InputController } from './input.js';
import type { InputMode, TouchElements } from './input.js';
import { Minimap } from './minimap.js';
import { CraftAudio } from './audio.js';
import { WorldTicker, canPlaceAt, cascadeAfterRemoval, gravityDestination, plantResult, tillResult } from './ticks.js';
import { attackCooldownSeconds, attackDamage, blockXp, breakTime, canHarvest, dropsFor, durabilityCostPerAttack, durabilityCostPerBlock, knockbackStrength } from './mining.js';
import { availableRecipes, craft, isNearBlock } from './crafting.js';
import { enchantStack, rollGacha } from './enchant.js';
import { isHeadInWater } from './physics.js';
import { damageItem, enchantLevel } from './items.js';
import { lookDir, project } from './math.js';

export type RemotePlayer = RemotePlayerInfo & {
	x: number; y: number; z: number;
	yaw: number; pitch: number;
	tx: number; ty: number; tz: number;
	walkPhase: number;
	lastSeen: number;
	color: string;
};

export type EngineToast =
	| { kind: 'pickup'; id: number; count: number }
	| { kind: 'kill'; mobType: MobType; xp: number }
	| { kind: 'levelUp'; level: number }
	| { kind: 'spawnSet' }
	| { kind: 'itemBroke'; id: number }
	| { kind: 'inventoryFull' };

export type PanelKind = 'crafting' | 'furnace' | 'enchanting';

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
	openPanel: (panel: PanelKind) => void;
	playersChange: () => void;
	toast: (toast: EngineToast) => void;
};

export type EngineSettings = {
	soundVolume: number;
	muted: boolean;
	renderDistance: number;
	viewBobbing: boolean;
};

export type EngineState = {
	version: 2;
	inventory: SerializedStack[];
	stats: PlayerStats;
	pos: { x: number; y: number; z: number };
	yaw: number;
	pitch: number;
	hotbarIndex: number;
	spawn: { x: number; y: number; z: number } | null;
};

const REMOTE_TIMEOUT = 15000;
const MOVE_SEND_INTERVAL = 100;
const MOVE_HEARTBEAT_INTERVAL = 5000;
const MOB_BROADCAST_INTERVAL = 200;
const MINIMAP_INTERVAL = 500;
const TICK_INTERVAL = 500;
const MINE_HIT_SOUND_INTERVAL = 250;
const MINE_PARTICLE_INTERVAL = 120;
const EAT_SOUND_INTERVAL = 250;
const SWING_MS = 300;
/** サーバーの setBlock 上限 30 件/秒に対して、少し余裕を持って送る */
const SEND_RATE_PER_SEC = 24;
const SEND_BUCKET_MAX = 12;
const BOW_FULL_CHARGE_S = 1.0;
const MOB_AMBIENT_MIN_INTERVAL = 3000;

function colorFromId(id: string): string {
	let h = 0;
	for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
	return `hsl(${h % 360}, 60%, 55%)`;
}

function clamp(v: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, v));
}

function soundMaterialOf(blockId: number): SoundMaterial {
	return BLOCK_DEFS[blockId]?.sound ?? 'stone';
}

/**
 * 画面 (canvas) への描画・入力・物理・MOB・効果音を束ねる。ネットワークは持たず、
 * 自分の操作はイベントで外へ出し、他人の操作は apply* で受け取る。
 */
export class CraftEngine {
	public readonly world: CraftWorld;
	public readonly player: Player;
	public readonly mobs: MobSystem;
	public readonly projectiles: ProjectileSystem;
	public readonly input: InputController;
	public readonly audio: CraftAudio;
	private renderer: CraftRenderer;
	private ticker: WorldTicker;
	private minimap: Minimap | null = null;
	private raf = 0;
	private lastTime = 0;
	private lastMoveSent = 0;
	private lastSent = { x: NaN, y: NaN, z: NaN, yaw: NaN, pitch: NaN };
	private lastMobBroadcast = 0;
	private lastMinimap = 0;
	private lastTick = 0;
	private lastAttackAt = -Infinity;
	private lastSwingAt = -Infinity;
	private lastStatsEmit = 0;
	private lastMineHitSound = 0;
	private lastMineParticle = 0;
	private lastEatSound = 0;
	private lastMobAmbientAt = 0;
	private breakProgress = 0;
	private breakTarget: string | null = null;
	/** 弓を引いている・食べている (右クリック長押し) */
	private usingSince: number | null = null;
	private usingItem: number | null = null;
	/** 死亡処理 (レベル喪失・通知) を済ませたか。復活でリセットする */
	private deathHandled = false;
	/** サーバーに送った設置・破壊のうち未確定のもの (key → 変更前の type、送った type、消費したアイテム、実際に受け取ったドロップ) */
	private pendingEdits = new Map<string, { prev: number; id: number; placed: number | null; dropped: { id: number; count: number }[] }>();
	/** サーバーへ送る編集の待ち行列 (30 件/秒の制限に収める)。自分の操作は先頭に入れる */
	private sendQueue: { x: number; y: number; z: number; id: number }[] = [];
	private sendTokens = SEND_BUCKET_MAX;
	private lastSendRefill = 0;
	/** 再接続後の再取得中 (未確定の編集はサーバーの値と比べてから確定・取消する) */
	private resyncing = false;
	/** ワールドの所有者と公開設定 (ホスト選出に使う) */
	public worldOwnerId: string | null = null;
	public worldIsPublic = true;
	/** 自分が倒した MOB (古いスナップショットで復活させない)。id → 時刻 */
	private killedMobs = new Map<string, number>();
	/** MOB ごとに最後に受けた攻撃の時刻 (スナップショットの改ざんや重複で連続ダメージを受けない) */
	private lastMobAttackAt = new Map<string, number>();
	private hurtMobs = new Set<string>();
	/** 同じユーザーが複数タブで入っても MOB の id が衝突しないようにする */
	private readonly sessionNonce = Math.random().toString(36).slice(2, 8);
	private lastHostCheck = 0;
	private listeners: Partial<EngineEvents> = {};
	private disposed = false;
	private worldSpawn = { x: 0, z: 0 };
	public spawnPoint: { x: number; y: number; z: number } | null = null;
	/** 最後に見たホストの配信 */
	private lastSnapshotHost: { id: string; at: number } | null = null;
	public localUserId: string | null = null;
	private canBuildValue = false;
	public settings: EngineSettings = { soundVolume: 0.6, muted: false, renderDistance: WORLD.renderDistance, viewBobbing: true };
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
		this.projectiles = new ProjectileSystem();
		this.renderer = new CraftRenderer(canvas, this.world);
		this.ticker = new WorldTicker(this.world);
		this.audio = new CraftAudio();
		this.input = new InputController({ canvas, stage });
		this.input.on('activeChange', (v) => {
			if (v) this.audio.unlock();
			this.listeners.activeChange?.(v);
		});
		this.input.on('fullscreenChange', (v) => this.listeners.fullscreenChange?.(v));
	}

	public on<K extends keyof EngineEvents>(event: K, fn: EngineEvents[K]): void {
		this.listeners[event] = fn;
	}

	public start(state?: EngineState | null): void {
		this.worldSpawn = this.world.findSpawn();
		const num = (v: unknown, fallback: number): number => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
		if (state != null && typeof state === 'object') {
			this.player.inventory.load(state.inventory);
			this.player.loadStats(state.stats);
			const px = clamp(num(state.pos?.x, this.worldSpawn.x), -WORLD.maxCoord, WORLD.maxCoord);
			const pz = clamp(num(state.pos?.z, this.worldSpawn.z), -WORLD.maxCoord, WORLD.maxCoord);
			const py = clamp(num(state.pos?.y, this.world.surfaceY(Math.floor(px), Math.floor(pz))), WORLD.minY, WORLD.maxY + 16);
			this.player.pos.x = px;
			this.player.pos.y = py;
			this.player.pos.z = pz;
			this.player.yaw = num(state.yaw, 0);
			this.player.pitch = clamp(num(state.pitch, 0), -1.5, 1.5);
			this.player.hotbarIndex = clamp(Math.floor(num(state.hotbarIndex, 0)), 0, PLAYER.hotbarSize - 1);
			const sp = state.spawn;
			this.spawnPoint = sp != null && typeof sp === 'object' && Number.isInteger(sp.x) && Number.isInteger(sp.y) && Number.isInteger(sp.z) ? { x: sp.x, y: sp.y, z: sp.z } : null;
			// 保存位置が埋まっていたら地表へ
			if (BLOCK_DEFS[this.world.getBlock(Math.floor(px), Math.floor(py), Math.floor(pz))]?.solid) {
				this.player.pos.y = this.world.surfaceY(Math.floor(px), Math.floor(pz));
			}
			// 死んだまま保存されていたら復活地点から始める
			if (this.player.stats.health <= 0 || this.player.isDead) this.respawn();
		} else {
			this.player.spawn(this.worldSpawn.x, this.worldSpawn.z);
		}
		this.applySettings();
		this.lastTime = performance.now();
		this.updateHost();
		this.loop(this.lastTime);
	}

	public exportState(): EngineState {
		return {
			version: 2,
			inventory: this.player.inventory.serialize(),
			stats: this.player.exportStats(),
			pos: { x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z },
			yaw: this.player.yaw,
			pitch: this.player.pitch,
			hotbarIndex: this.player.hotbarIndex,
			spawn: this.spawnPoint,
		};
	}

	// ----- 設定 -----

	public updateSettings(patch: Partial<EngineSettings>): void {
		this.settings = { ...this.settings, ...patch };
		this.applySettings();
	}

	private applySettings(): void {
		this.audio.volume = this.settings.soundVolume;
		this.audio.muted = this.settings.muted;
		this.renderer.renderDistance = clamp(Math.round(this.settings.renderDistance), 3, 12);
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
		this.audio.unlock();
		this.input.start();
	}

	public stopPlaying(): void {
		this.input.stop();
		this.cancelUsing();
	}

	public toggleFullscreen(): Promise<void> {
		return this.input.toggleFullscreen();
	}

	public get isFullscreen(): boolean {
		return this.input.isFullscreen;
	}

	public selectHotbar(index: number): void {
		if (index === this.player.hotbarIndex) return;
		this.player.hotbarIndex = index;
		this.cancelUsing();
		this.listeners.hotbarChange?.(index);
	}

	public get selectedStack(): ItemStack {
		return this.player.selectedStack;
	}

	public respawn(): void {
		this.deathHandled = false;
		let x = this.worldSpawn.x, z = this.worldSpawn.z;
		if (this.spawnPoint != null && this.world.getBlock(this.spawnPoint.x, this.spawnPoint.y, this.spawnPoint.z) === BLOCK.bed) {
			x = this.spawnPoint.x + 0.5;
			z = this.spawnPoint.z + 0.5;
		} else {
			this.spawnPoint = null;
		}
		this.player.respawn(x, z);
		this.emitStats(true);
		this.listeners.inventoryChange?.();
	}

	public get nearTable(): boolean {
		return isNearBlock(this.world, this.player.pos, BLOCK.craftingTable);
	}

	public get nearFurnace(): boolean {
		return isNearBlock(this.world, this.player.pos, BLOCK.furnace);
	}

	public get nearEnchantingTable(): boolean {
		return isNearBlock(this.world, this.player.pos, BLOCK.enchantingTable);
	}

	public recipes(): { recipe: Recipe; craftable: boolean }[] {
		return availableRecipes(this.player.inventory, { nearTable: this.nearTable, nearFurnace: this.nearFurnace });
	}

	public craftRecipe(recipe: Recipe): boolean {
		const res = craft(this.player.inventory, recipe, { nearTable: this.nearTable, nearFurnace: this.nearFurnace });
		if (res.ok) {
			if (res.xp > 0) this.gainXp(res.xp);
			this.audio.play(recipe.needs === 'furnace' ? 'furnace' : 'craft');
			this.listeners.inventoryChange?.();
			this.emitStats(true);
		}
		return res.ok;
	}

	public moveItem(from: number, to: number): void {
		const before = this.player.inventory.armorPoints();
		this.player.inventory.move(from, to);
		if (this.player.inventory.armorPoints() !== before || to >= PLAYER.armorSlotStart || from >= PLAYER.armorSlotStart) this.audio.play('equip');
		this.listeners.inventoryChange?.();
		this.emitStats(true);
	}

	public equipFromSlot(index: number): boolean {
		const ok = this.player.inventory.equipFromSlot(index);
		if (ok) {
			this.audio.play('equip');
			this.listeners.inventoryChange?.();
			this.emitStats(true);
		}
		return ok;
	}

	public discardItem(index: number): void {
		this.player.inventory.discard(index);
		this.listeners.inventoryChange?.();
	}

	/** ガチャを回す。失敗理由を返す */
	public rollGacha(tier: GachaTier): { ok: true; item: NonNullable<ItemStack> } | { ok: false; reason: 'notEnough' | 'full' | 'noTable' } {
		if (!this.nearEnchantingTable) return { ok: false, reason: 'noTable' };
		const cost = GACHA_TIERS[tier];
		const inv = this.player.inventory;
		if (this.player.levelsAvailable < cost.levels || inv.count(ITEM.lapis) < cost.lapis) return { ok: false, reason: 'notEnough' };
		const item = rollGacha(tier);
		const backup = inv.serialize();
		inv.remove({ ids: [ITEM.lapis], count: cost.lapis });
		if (inv.addStack(item) > 0) {
			inv.load(backup);
			return { ok: false, reason: 'full' };
		}
		this.player.spendLevels(cost.levels);
		this.audio.play('gachaWin');
		this.listeners.inventoryChange?.();
		this.emitStats(true);
		return { ok: true, item };
	}

	/** 手に持っている物にエンチャントを付ける */
	public enchantHeld(tier: GachaTier): { ok: true; added: [EnchantId, number][]; stack: NonNullable<ItemStack> } | { ok: false; reason: 'notEnough' | 'notApplicable' | 'noTable' } {
		if (!this.nearEnchantingTable) return { ok: false, reason: 'noTable' };
		const stack = this.player.selectedStack;
		if (stack == null) return { ok: false, reason: 'notApplicable' };
		const cost = GACHA_TIERS[tier];
		const inv = this.player.inventory;
		if (this.player.levelsAvailable < cost.levels || inv.count(ITEM.lapis) < cost.lapis) return { ok: false, reason: 'notEnough' };
		const added = enchantStack(stack, tier);
		if (added == null) return { ok: false, reason: 'notApplicable' };
		inv.remove({ ids: [ITEM.lapis], count: cost.lapis });
		this.player.spendLevels(cost.levels);
		this.audio.play('enchant');
		this.renderer.particles.spawn('enchant', this.player.pos.x, this.player.pos.y + 1, this.player.pos.z, 24);
		this.listeners.inventoryChange?.();
		this.emitStats(true);
		return { ok: true, added, stack };
	}

	public get isHost(): boolean {
		return this.mobs.isHost;
	}

	public get daylight(): number {
		return daylight();
	}

	public get breakProgressValue(): number {
		return this.breakProgress;
	}

	/** 弓を引いている・食べている進み具合 (0..1)。UI の表示用 */
	public get useProgress(): number {
		return this.player.useProgress;
	}

	public playUiSound(id: 'click' | 'gachaRoll'): void {
		this.audio.play(id);
	}

	// ----- ブロック操作 -----

	private blockKey(x: number, y: number, z: number): string {
		return `${x},${y},${z}`;
	}

	/** 同じ座標の編集がサーバーで未確定の間は、次の編集を受け付けない (取消の整合性のため) */
	private canEditAt(x: number, y: number, z: number): boolean {
		return !this.pendingEdits.has(this.blockKey(x, y, z));
	}

	/**
	 * 自分の操作による編集。ローカルに反映し、サーバーへ送る。
	 * @returns 反映したら true。dropped は実際にインベントリに入った数
	 */
	private localEdit(x: number, y: number, z: number, id: number, placed: number | null, dropped: { id: number; count: number }[] = []): boolean {
		const key = this.blockKey(x, y, z);
		if (this.pendingEdits.has(key)) return false;
		const prev = this.world.getBlock(x, y, z);
		if (!this.world.setBlock(x, y, z, id)) return false;
		this.pendingEdits.set(key, { prev, id, placed, dropped });
		this.minimap?.invalidate(`${CraftWorld.toChunk(x)},${CraftWorld.toChunk(z)}`);
		this.sendQueue.unshift({ x, y, z, id });
		if (!this.resyncing) this.flushSendQueue(performance.now());
		return true;
	}

	/** ホストの tick や落下など、取り消し不要の編集。送信は待ち行列の後ろに入れる */
	private applyEdits(edits: { x: number; y: number; z: number; id: number }[]): void {
		for (const e of edits) {
			if (this.pendingEdits.has(this.blockKey(e.x, e.y, e.z))) continue;
			if (this.world.setBlock(e.x, e.y, e.z, e.id)) {
				this.minimap?.invalidate(`${CraftWorld.toChunk(e.x)},${CraftWorld.toChunk(e.z)}`);
				this.sendQueue.push(e);
			}
		}
	}

	/** 支えを失って消えるブロックのドロップを拾いながら連鎖の編集を適用する */
	private applyCascade(edits: { x: number; y: number; z: number; id: number }[], collectDrops: boolean): void {
		const drops: ItemStack[] = [];
		// 落ちてきた砂・砂利がプレイヤーの体と重なるなら、その上で止める
		for (const e of edits) {
			if ((e.id === BLOCK.sand || e.id === BLOCK.gravel) && this.occupiedByEntity(e.x, e.y, e.z)) {
				let y = e.y;
				while (y <= WORLD.maxY && (this.occupiedByEntity(e.x, y, e.z) || this.world.getBlock(e.x, y, e.z) !== BLOCK.air)) y++;
				e.y = y;
			}
		}
		for (const e of edits) {
			if (e.id !== BLOCK.air) continue;
			const prev = this.world.getBlock(e.x, e.y, e.z);
			const def = BLOCK_DEFS[prev];
			// 落下中の砂・砂利は別の場所に置き直されるので数えない
			if (def == null || prev === BLOCK.sand || prev === BLOCK.gravel) continue;
			if (def.drops != null && (def.drops.chance == null || Math.random() < def.drops.chance)) drops.push({ id: def.drops.id, count: def.drops.count ?? 1 });
		}
		this.applyEdits(edits);
		if (collectDrops && drops.length > 0) this.giveItems(drops);
	}

	/** サーバーの受付上限を超えないように、待ち行列から少しずつ送る */
	private flushSendQueue(now: number): void {
		if (this.lastSendRefill === 0) this.lastSendRefill = now;
		this.sendTokens = Math.min(SEND_BUCKET_MAX, this.sendTokens + (now - this.lastSendRefill) / 1000 * SEND_RATE_PER_SEC);
		this.lastSendRefill = now;
		while (this.sendTokens >= 1 && this.sendQueue.length > 0) {
			const e = this.sendQueue.shift()!;
			this.sendTokens -= 1;
			this.listeners.setBlock?.(e.x, e.y, e.z, e.id);
		}
	}

	/** 実際にインベントリに入った分を返す */
	private giveItems(stacks: ItemStack[]): { id: number; count: number }[] {
		let changed = false;
		let full = false;
		const got: { id: number; count: number }[] = [];
		for (const s of stacks) {
			if (s == null) continue;
			const left = this.player.inventory.addStack(s);
			const n = s.count - left;
			if (n > 0) {
				changed = true;
				got.push({ id: s.id, count: n });
				this.listeners.toast?.({ kind: 'pickup', id: s.id, count: n });
			}
			if (left > 0) full = true;
		}
		if (changed) {
			this.audio.play('pickup');
			this.listeners.inventoryChange?.();
		}
		if (full) this.listeners.toast?.({ kind: 'inventoryFull' });
		return got;
	}

	private gainXp(n: number): void {
		if (n <= 0) return;
		const before = this.player.stats.level;
		this.player.addXp(n);
		this.audio.play('xp', { pitch: 0.8 + Math.random() * 0.4 });
		if (this.player.stats.level > before) {
			this.audio.play('levelUp');
			this.listeners.toast?.({ kind: 'levelUp', level: this.player.stats.level });
		}
		this.emitStats(true);
	}

	private damageHeld(amount: number): void {
		const idx = this.player.hotbarIndex;
		const stack = this.player.selectedStack;
		if (stack == null || amount <= 0) return;
		if (damageItem(stack, amount)) {
			this.player.inventory.discard(idx);
			this.audio.play('break', { material: 'metal', volume: 0.6 });
			this.listeners.toast?.({ kind: 'itemBroke', id: stack.id });
		}
		this.listeners.inventoryChange?.();
	}

	private finishBreak(hit: BlockHit): void {
		const id = this.world.getBlock(hit.x, hit.y, hit.z);
		const def = BLOCK_DEFS[id];
		if (id === BLOCK.air || def == null || def.hardness === Infinity) return;
		if (!this.canEditAt(hit.x, hit.y, hit.z)) return;
		const held = this.player.selectedStack;
		const drops = dropsFor(id, held, Math.random);
		const xp = canHarvest(id, held) && enchantLevel(held, 'silkTouch') === 0 ? blockXp(id, held, Math.random) : 0;
		const got = this.giveItems(drops);
		if (!this.localEdit(hit.x, hit.y, hit.z, BLOCK.air, null, got)) {
			for (const g of got) this.player.inventory.remove({ ids: [g.id], count: g.count });
			return;
		}
		this.audio.play('break', { material: def.sound, x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5 });
		this.renderer.particles.spawnBlock(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, id, 24);
		if (def.hardness > 0) {
			this.damageHeld(durabilityCostPerBlock(held));
			this.player.addExhaustion(0.005);
		}
		if (xp > 0) {
			this.gainXp(xp);
			this.renderer.particles.spawn('xp', hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, 6);
		}
		// 上に乗っていた砂・松明・作物など
		this.applyCascade(cascadeAfterRemoval(this.world, hit.x, hit.y, hit.z), true);
	}

	private occupiedByEntity(x: number, y: number, z: number): boolean {
		if (this.player.overlapsBlock(x, y, z)) return true;
		for (const p of this.remotePlayers.values()) {
			if (x + 1 > p.x - 0.3 && x < p.x + 0.3 && y + 1 > p.y && y < p.y + 1.8 && z + 1 > p.z - 0.3 && z < p.z + 0.3) return true;
		}
		return false;
	}

	private tryPlace(hit: BlockHit, blockId: number, consume: boolean): boolean {
		let x = hit.x + hit.nx;
		let y = hit.y + hit.ny;
		let z = hit.z + hit.nz;
		// 草や花を狙ったときはその場所に置く
		if (BLOCK_DEFS[this.world.getBlock(hit.x, hit.y, hit.z)]?.replaceable) {
			x = hit.x; y = hit.y; z = hit.z;
		}
		if (!this.world.inBounds(x, y, z) || y <= WORLD.minY) return false;
		if (!canPlaceAt(this.world, blockId, x, y, z, hit.nx, hit.ny, hit.nz)) return false;
		const def = BLOCK_DEFS[blockId];
		if (def?.solid && this.occupiedByEntity(x, y, z)) return false;
		// 砂・砂利は空中なら落ちる。落下先がプレイヤーと重なるなら、その上で止める (自分を埋めない)
		let destY = (blockId === BLOCK.sand || blockId === BLOCK.gravel) ? gravityDestination(this.world, x, y, z) : null;
		if (destY != null) {
			while (destY < y && this.occupiedByEntity(x, destY, z)) destY++;
			if (destY === y) destY = null;
		}
		if (!this.canEditAt(x, destY ?? y, z)) return false;
		if (consume && !this.player.inventory.take(this.player.hotbarIndex, 1)) return false;
		if (consume) this.listeners.inventoryChange?.();
		if (!this.localEdit(x, destY ?? y, z, blockId, consume ? blockId : null)) {
			if (consume) this.player.inventory.add(blockId, 1);
			return false;
		}
		this.audio.play('place', { material: def?.sound, x: x + 0.5, y: y + 0.5, z: z + 0.5 });
		this.swing(performance.now());
		return true;
	}

	private cancelUsing(): void {
		this.usingSince = null;
		this.usingItem = null;
		this.player.stopUsing();
	}

	private swing(now: number): void {
		this.lastSwingAt = now;
	}

	private tryUsePressed(now: number): void {
		const stack = this.player.selectedStack;
		const def = stack != null ? ITEM_DEFS[stack.id] : undefined;

		// 機能ブロック
		if (this.target != null && !this.player.isSneaking) {
			const id = this.world.getBlock(this.target.x, this.target.y, this.target.z);
			if (id === BLOCK.craftingTable) { this.listeners.openPanel?.('crafting'); return; }
			if (id === BLOCK.furnace) { this.listeners.openPanel?.('furnace'); return; }
			if (id === BLOCK.enchantingTable) { this.listeners.openPanel?.('enchanting'); return; }
			if (id === BLOCK.bed && this.canBuild) {
				this.spawnPoint = { x: this.target.x, y: this.target.y, z: this.target.z };
				this.audio.play('click');
				this.listeners.toast?.({ kind: 'spawnSet' });
				return;
			}
		}

		// 食べる・弓を引く (長押し)
		if (def?.food != null) {
			if (this.player.stats.hunger < PLAYER.maxHunger || def.food.alwaysEdible) {
				this.usingSince = now;
				this.usingItem = stack!.id;
				this.player.startUsing(now);
			}
			return;
		}
		if (def?.kind === 'bow') {
			if (this.player.inventory.count(ITEM.arrow) > 0 || enchantLevel(stack, 'infinity') > 0) {
				this.usingSince = now;
				this.usingItem = stack!.id;
				this.player.startUsing(now);
				this.audio.play('bowDraw');
			}
			return;
		}

		if (!this.canBuild || this.target == null || stack == null) return;
		const targetId = this.world.getBlock(this.target.x, this.target.y, this.target.z);

		// クワ: 草・土を耕す
		if (def?.tool?.kind === 'hoe' && this.target.ny === 1) {
			const tilled = tillResult(targetId);
			if (tilled != null && this.world.getBlock(this.target.x, this.target.y + 1, this.target.z) === BLOCK.air && this.localEdit(this.target.x, this.target.y, this.target.z, tilled, null)) {
				this.audio.play('place', { material: 'gravel', x: this.target.x + 0.5, y: this.target.y + 1, z: this.target.z + 0.5 });
				this.damageHeld(1);
				this.swing(now);
				return;
			}
		}

		// 種・苗木を植える
		const planted = plantResult(stack.id, targetId);
		if (planted != null && this.target.ny === 1) {
			this.tryPlace(this.target, planted, true);
			return;
		}

		if (isBlockItem(stack.id)) {
			this.tryPlace(this.target, stack.id, true);
		}
	}

	/** 右クリックを離した・使い終わった */
	private finishUsing(now: number): void {
		if (this.usingSince == null) return;
		const stack = this.player.selectedStack;
		const def = stack != null ? ITEM_DEFS[stack.id] : undefined;
		if (stack != null && def?.kind === 'bow' && stack.id === this.usingItem) {
			const charge = clamp((now - this.usingSince) / 1000 / BOW_FULL_CHARGE_S, 0, 1);
			if (charge >= 0.1) this.shootArrow(charge, stack);
		}
		this.cancelUsing();
	}

	private shootArrow(charge: number, bow: NonNullable<ItemStack>): void {
		const infinity = enchantLevel(bow, 'infinity') > 0;
		if (!infinity && !this.player.inventory.remove({ ids: [ITEM.arrow], count: 1 })) return;
		const [dx, dy, dz] = lookDir(this.player.yaw, this.player.pitch);
		const power = enchantLevel(bow, 'power');
		const punch = enchantLevel(bow, 'punch');
		const speed = 10 + charge * 50;
		let damage = Math.ceil(charge * 6 * (1 + power * 0.25));
		if (charge >= 1 && Math.random() < 0.25) damage = Math.ceil(damage * 1.5);
		this.projectiles.shoot({
			x: this.player.pos.x + dx * 0.3, y: this.player.eyeY - 0.1, z: this.player.pos.z + dz * 0.3,
			dx, dy, dz, speed, damage, knockback: punch, ownerId: this.localUserId ?? 'local',
		});
		this.audio.play('bowShoot', { pitch: 0.9 + charge * 0.3 });
		this.damageHeld(1);
		this.player.addExhaustion(0.1);
		this.listeners.inventoryChange?.();
	}

	private tryAttack(now: number): void {
		if (this.targetMob == null) return;
		const held = this.player.selectedStack;
		const cooldown = attackCooldownSeconds(held);
		const since = (now - this.lastAttackAt) / 1000;
		if (since < cooldown * 0.5) return;
		const charge = clamp(since / cooldown, 0, 1);
		this.lastAttackAt = now;
		this.swing(now);
		const critical = charge > 0.9 && !this.player.onGround && this.player.vel.y < 0 && !this.player.isSprinting && !this.player.isInWater;
		const damage = attackDamage(held, charge, critical);
		const [dx, , dz] = lookDir(this.player.yaw, 0);
		const knockback = knockbackStrength(held, this.player.isSprinting);
		const hit: MobHit = { id: this.targetMob, damage, kx: dx, kz: dz };
		const mobPos = this.mobs.positionOf(this.targetMob);
		if (critical) {
			this.audio.play('attackCrit');
			if (mobPos) this.renderer.particles.spawnCrit(mobPos.x, mobPos.y + 1, mobPos.z);
		} else if (charge > 0.9) {
			this.audio.play(knockback > 0 ? 'attackKnockback' : 'attackStrong');
		} else {
			this.audio.play('attackWeak');
		}
		this.player.addExhaustion(0.1);
		this.damageHeld(durabilityCostPerAttack(held));
		// ホストでなくても自分の画面には先に反映し、倒した判定もここで行う
		this.handleMobEvents(this.mobs.applyHit(hit, this.localUserId, now, { looting: enchantLevel(held, 'looting'), knockback }));
		if (!this.mobs.isHost) this.listeners.mobHit?.(hit);
	}

	private hurtPlayer(amount: number, source: DamageSource, now: number): void {
		if (this.player.isDead) return;
		const dealt = this.player.damage(amount, source, now);
		if (dealt > 0) {
			// 音は player.update の damaged イベント側で鳴らす
			this.emitStats(true);
			if (this.player.isDead) this.onDied();
		}
	}

	private onDied(): void {
		if (this.deathHandled) return;
		this.deathHandled = true;
		this.cancelUsing();
		// 死んだ時点でレベルを失う (リロードで逃れられないように、保存前に反映する)
		this.player.loseAllXp();
		this.emitStats(true);
		this.audio.play('death');
		this.listeners.died?.();
	}

	private handleMobEvents(events: MobEvent[]): void {
		const now = performance.now();
		for (const ev of events) {
			if (ev.type === 'attackPlayer') {
				if (ev.userId !== this.localUserId || this.player.isDead) continue;
				const mob = this.mobs.positionOf(ev.mobId);
				let kx = 0, kz = 0;
				if (mob) {
					const d = Math.hypot(this.player.pos.x - mob.x, this.player.pos.z - mob.z) || 1;
					kx = (this.player.pos.x - mob.x) / d;
					kz = (this.player.pos.z - mob.z) / d;
				}
				this.hurtPlayer(ev.damage, { kind: ev.ranged ? 'arrow' : 'mob', kx, kz }, now);
				if (ev.ranged) this.audio.play('arrowHit');
				// 棘の鎧
				const thorns = this.player.inventory.armorEnchantLevel('thorns');
				if (thorns > 0 && !ev.ranged && Math.random() < thorns * 0.15) {
					const back: MobHit = { id: ev.mobId, damage: 1 + Math.floor(Math.random() * 4), kx: -kx, kz: -kz };
					this.handleMobEvents(this.mobs.applyHit(back, this.localUserId, now));
					if (!this.mobs.isHost) this.listeners.mobHit?.(back);
				}
			} else if (ev.type === 'died') {
				this.killedMobs.set(ev.mobId, now);
				this.audio.play('mobDeath', { mob: ev.mobType, x: ev.x, y: ev.y, z: ev.z });
				this.renderer.particles.spawn('smoke', ev.x, ev.y + 0.5, ev.z, 10);
				if (ev.killerId === this.localUserId && this.localUserId != null) {
					this.giveItems(ev.drops);
					if (ev.xp > 0) {
						this.gainXp(ev.xp);
						this.renderer.particles.spawn('xp', ev.x, ev.y + 0.5, ev.z, 8);
					}
					this.listeners.toast?.({ kind: 'kill', mobType: ev.mobType, xp: ev.xp });
				}
			} else if (ev.type === 'explode') {
				this.audio.play('explosion', { x: ev.x, y: ev.y, z: ev.z, volume: 1 });
				this.renderer.particles.spawn('explosion', ev.x, ev.y + 0.5, ev.z, 30);
				const d = Math.hypot(this.player.pos.x - ev.x, this.player.pos.y + 0.9 - ev.y, this.player.pos.z - ev.z);
				if (d < ev.radius && !this.player.isDead) {
					const dmg = Math.round(ev.damage * (1 - d / ev.radius));
					const h = Math.hypot(this.player.pos.x - ev.x, this.player.pos.z - ev.z) || 1;
					this.hurtPlayer(dmg, { kind: 'explosion', kx: (this.player.pos.x - ev.x) / h, kz: (this.player.pos.z - ev.z) / h, knockback: 2 }, now);
				}
			} else if (ev.type === 'shoot') {
				const dx = ev.to.x - ev.from.x, dy = ev.to.y - ev.from.y, dz = ev.to.z - ev.from.z;
				const len = Math.hypot(dx, dy, dz) || 1;
				this.projectiles.shoot({ x: ev.from.x, y: ev.from.y, z: ev.from.z, dx: dx / len, dy: dy / len, dz: dz / len, speed: ev.speed, damage: 0, knockback: 0, ownerId: ev.mobId, visualOnly: true });
				this.audio.play('bowShoot', { x: ev.from.x, y: ev.from.y, z: ev.from.z, pitch: 0.8 });
			}
		}
	}

	// ----- サーバーから -----

	public applyRemoteBlock(x: number, y: number, z: number, type: number, userId: string | null = null): void {
		// このクライアントが知らない id は空気として扱う (サーバーは 127 まで受け付ける)
		if (type !== BLOCK.air && BLOCK_DEFS[type] == null) type = BLOCK.air;
		const key = this.blockKey(x, y, z);
		// 自分の編集の確定だけで未確定を消す (他人が同じ座標を変えても、自分の分は後で拒否か確定が届く)
		const pending = this.pendingEdits.get(key);
		const wasPending = pending != null && (userId == null || userId === this.localUserId) && pending.id === type;
		if (wasPending) this.pendingEdits.delete(key);
		const prev = this.world.getBlock(x, y, z);
		if (this.world.setBlock(x, y, z, type)) {
			this.minimap?.invalidate(`${CraftWorld.toChunk(x)},${CraftWorld.toChunk(z)}`);
			if (!wasPending) {
				// 他人の設置・破壊は音と粒子だけ出す
				const d = Math.hypot(x - this.player.pos.x, y - this.player.pos.y, z - this.player.pos.z);
				if (d < 24) {
					if (type === BLOCK.air && prev !== BLOCK.air) {
						this.audio.play('break', { material: soundMaterialOf(prev), x: x + 0.5, y: y + 0.5, z: z + 0.5 });
						this.renderer.particles.spawnBlock(x + 0.5, y + 0.5, z + 0.5, prev, 12);
					} else if (type !== BLOCK.air) {
						this.audio.play('place', { material: soundMaterialOf(type), x: x + 0.5, y: y + 0.5, z: z + 0.5 });
					}
				}
			}
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
		for (const d of pending.dropped) {
			// 受け取った分だけ、手元にある範囲で返す
			const n = Math.min(d.count, this.player.inventory.count(d.id));
			if (n > 0) this.player.inventory.remove({ ids: [d.id], count: n });
		}
		if (pending.dropped.length > 0) this.listeners.inventoryChange?.();
	}

	/** 再接続して差分を取り直す前に呼ぶ。取り直すまで新しい編集は送らない */
	public beginResync(): void {
		this.resyncing = true;
	}

	/**
	 * 差分を取り直した後に呼ぶ。未確定の編集は、サーバーの差分に同じ値があれば確定、
	 * 無ければ (届いていないので) 取り消す。別の値になっていれば他人の編集を優先して取消も返却もしない
	 */
	public finishResync(serverBlocks: Map<string, number>): void {
		this.resyncing = false;
		for (const [key, pending] of [...this.pendingEdits]) {
			const [x, y, z] = key.split(',').map(Number);
			const server = serverBlocks.get(key);
			if (server === pending.id) {
				this.pendingEdits.delete(key);
			} else if (server == null) {
				this.revertLocalEdit(x, y, z);
			} else {
				this.pendingEdits.delete(key);
			}
		}
		this.sendQueue = [];
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
		const me = this.localUserId != null ? [{ userId: this.localUserId, x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z }] : undefined;
		const events = this.mobs.applySnapshot(filteredSnapshot, now, this.localUserId, me);
		// 距離が遠い攻撃と、間隔の短すぎる攻撃は無視する
		const filtered = events.filter(ev => {
			if (ev.type !== 'attackPlayer') return true;
			const mob = snapshot.mobs.find(m => m.id === ev.mobId);
			if (mob == null) return false;
			const def = MOB_DEFS[mob.type as MobType];
			if (def == null) return false;
			const d = Math.hypot(mob.x - this.player.pos.x, mob.z - this.player.pos.z);
			const maxD = ev.ranged ? (def.ranged?.maxRange ?? 16) + 2 : def.width / 2 + 2.2;
			if (d > maxD || Math.abs(mob.y - this.player.pos.y) >= (ev.ranged ? 8 : 2.5)) return false;
			const last = this.lastMobAttackAt.get(mob.id) ?? -Infinity;
			const interval = ev.ranged ? (def.ranged?.interval ?? 2) : def.attackInterval;
			if (now - last < interval * 1000 * 0.8) return false;
			this.lastMobAttackAt.set(mob.id, now);
			return true;
		});
		this.handleMobEvents(filtered);
	}

	public applyRemoteMobHit(userId: string, hit: MobHit): void {
		if (userId === this.localUserId) return;
		this.handleMobEvents(this.mobs.applyHit(hit, userId, performance.now()));
	}

	/** その人がこのワールドで建築できる (= ホストになれる) か */
	private canHost(userId: string): boolean {
		return this.worldIsPublic || userId === this.worldOwnerId;
	}

	/** 同席者のうち、建築できる人で userId が最小の人がホスト */
	private electedHost(): string | null {
		if (this.localUserId == null || !this.canBuild) {
			// 見学者はホストにならず、配信してきた人をホストとみなす
			if (this.lastSnapshotHost && performance.now() - this.lastSnapshotHost.at < 10000) return this.lastSnapshotHost.id;
			let best: string | null = null;
			for (const id of this.remotePlayers.keys()) if (this.canHost(id) && (best == null || id < best)) best = id;
			return best;
		}
		let host = this.localUserId;
		for (const id of this.remotePlayers.keys()) if (this.canHost(id) && id < host) host = id;
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

	public nearestHostileDistance(): number | null {
		return this.mobs.nearestHostileDistance(this.player.pos.x, this.player.pos.y, this.player.pos.z);
	}

	private emitStats(force: boolean): void {
		const now = performance.now();
		if (!force && now - this.lastStatsEmit < 250) return;
		this.lastStatsEmit = now;
		this.listeners.statsChange?.(this.player.exportStats());
	}

	private lightAtEye(): number {
		const packed = this.world.lightAt(Math.floor(this.player.pos.x), Math.floor(this.player.eyeY), Math.floor(this.player.pos.z));
		const sky = (packed >> 4) / 15;
		const block = (packed & 15) / 15;
		return Math.max(sky * (0.08 + 0.92 * daylight()), block, 0.03);
	}

	private entityLight(x: number, y: number, z: number, light: number): number {
		const packed = this.world.lightAt(Math.floor(x), Math.floor(y + 0.5), Math.floor(z));
		const sky = (packed >> 4) / 15;
		const block = (packed & 15) / 15;
		return Math.max(sky * (0.2 + 0.8 * light), block, 0.15);
	}

	// ----- ループ -----

	private loop = (now: number) => {
		if (this.disposed) return;
		this.raf = window.requestAnimationFrame(this.loop);
		const dt = Math.min(0.1, (now - this.lastTime) / 1000);
		this.lastTime = now;

		if (!this.resyncing) this.flushSendQueue(now);
		const raw = this.input.consumeFrame();
		const active = this.input.active && !this.uiOpen && !this.player.isDead;
		const input: InputState = active ? raw : { ...raw, forward: false, back: false, left: false, right: false, jump: false, sneak: false, sprint: false, attack: false, usePressed: false, use: false, lookDX: 0, lookDY: 0, hotbarDelta: 0, hotbarSelect: null, dropPressed: false };

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

		// プレイヤーの物理・サバイバル
		const events = this.player.update(dt, input, now);
		if (events.damaged > 0) {
			this.audio.play('hurt');
			this.emitStats(true);
		}
		if (events.landed != null) {
			const mat = soundMaterialOf(events.landed.blockId);
			if (events.landed.distance > 3) this.audio.play('fall', { material: mat });
			else this.audio.play('step', { material: mat, volume: 0.25 });
		}
		if (events.stepped != null) {
			this.audio.play('step', { material: soundMaterialOf(events.stepped), volume: this.player.isSneaking ? 0.08 : 0.15, pitch: 0.9 + Math.random() * 0.2 });
		}
		if (events.swimmingStroke) this.audio.play('swim');
		if (events.levelUp) {
			this.audio.play('levelUp');
			this.listeners.toast?.({ kind: 'levelUp', level: this.player.stats.level });
		}
		if (events.ateFinished != null) {
			this.audio.play('burp');
			this.cancelUsing();
			this.listeners.inventoryChange?.();
			this.emitStats(true);
		}
		if (events.itemBroke != null) {
			this.audio.play('break', { material: 'metal', volume: 0.6 });
			this.listeners.toast?.({ kind: 'itemBroke', id: events.itemBroke });
			this.listeners.inventoryChange?.();
		}
		if (this.player.isDead && !this.deathHandled) this.onDied();
		if (this.world.dirty.size > 0 && this.minimap) {
			for (const key of this.world.dirty) this.minimap.invalidate(key);
		}

		// 注視対象 (MOB が手前ならそちら)
		this.target = this.player.raycast(PLAYER.reach);
		const mobHit = this.mobs.raycast(this.player.pos.x, this.player.eyeY, this.player.pos.z, this.player.yaw, this.player.pitch, PLAYER.reach);
		this.targetMob = mobHit != null && (this.target == null || mobHit.dist < this.target.dist) ? mobHit.id : null;
		if (this.targetMob != null) this.target = null;

		// 採掘と攻撃
		if (active && input.attack && this.usingSince == null) {
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
				const held = this.player.selectedStack;
				const time = breakTime(id, held, {
					inWater: this.player.isInWater,
					onGround: this.player.onGround || this.player.isInWater || this.player.onLadder,
					haste: this.player.hasteLevel,
					aquaAffinity: this.player.inventory.armorEnchantLevel('aquaAffinity') > 0,
				});
				if (Number.isFinite(time)) {
					if (now - this.lastSwingAt > SWING_MS * 0.8) this.swing(now);
					this.breakProgress += dt / time;
					const def = BLOCK_DEFS[id];
					if (now - this.lastMineHitSound > MINE_HIT_SOUND_INTERVAL && time > 0.15) {
						this.lastMineHitSound = now;
						this.audio.play('hit', { material: def?.sound, x: this.target.x + 0.5, y: this.target.y + 0.5, z: this.target.z + 0.5 });
					}
					if (now - this.lastMineParticle > MINE_PARTICLE_INTERVAL && time > 0.15) {
						this.lastMineParticle = now;
						this.renderer.particles.spawnBlock(this.target.x + 0.5 + this.target.nx * 0.5, this.target.y + 0.5 + this.target.ny * 0.5, this.target.z + 0.5 + this.target.nz * 0.5, id, 2);
					}
					if (this.breakProgress >= 1) {
						this.finishBreak(this.target);
						this.breakProgress = 0;
						this.breakTarget = null;
					}
				} else {
					this.breakProgress = 0;
				}
			} else {
				if (input.attack && now - this.lastSwingAt > SWING_MS) {
					this.swing(now);
					if (this.target == null && this.targetMob == null) this.audio.play('attackNoDamage', { volume: 0.3 });
				}
				this.breakProgress = 0;
				this.breakTarget = null;
			}
		} else {
			this.breakProgress = 0;
			this.breakTarget = null;
		}

		// 使う (エッジ) と長押し
		if (active && input.usePressed) this.tryUsePressed(now);
		if (this.usingSince != null) {
			const stack = this.player.selectedStack;
			if (!active || !input.use || stack == null || stack.id !== this.usingItem) {
				this.finishUsing(now);
			} else if (ITEM_DEFS[stack.id]?.food != null && now - this.lastEatSound > EAT_SOUND_INTERVAL) {
				this.lastEatSound = now;
				this.audio.play('eat', { pitch: 0.8 + Math.random() * 0.4 });
			}
		}

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
			// 消えた MOB の記録を掃除する
			const alive = new Set(this.mobs.drawList(now).map(m => m.id));
			for (const id of [...this.lastMobAttackAt.keys()]) if (!alive.has(id)) this.lastMobAttackAt.delete(id);
			for (const id of [...this.hurtMobs]) if (id.endsWith(':fuse') && !alive.has(id.slice(0, -5))) this.hurtMobs.delete(id);
		}
		if (this.mobs.isHost && this.localUserId != null) {
			const players = [{ userId: this.localUserId, x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z }];
			for (const p of this.remotePlayers.values()) players.push({ userId: p.userId, x: p.x, y: p.y, z: p.z });
			this.handleMobEvents(this.mobs.tick(dt, now, players, `${this.localUserId}:${this.sessionNonce}`, (x, y, z) => this.world.lightAt(x, y, z)));
			if (now - this.lastMobBroadcast >= MOB_BROADCAST_INTERVAL) {
				this.lastMobBroadcast = now;
				this.listeners.mobs?.(this.mobs.snapshot(this.localUserId));
			}
			// ワールドのランダム tick (作物の成長など)
			if (now - this.lastTick >= TICK_INTERVAL) {
				this.lastTick = now;
				const tickEdits = this.ticker.tick(TICK_INTERVAL / 1000, now, players);
				this.applyEdits(tickEdits);
				// 葉が消えたときなど、支えを失ったブロックも落とす (ドロップは誰にも入らない)
				for (const e of tickEdits) {
					if (e.id === BLOCK.air) this.applyCascade(cascadeAfterRemoval(this.world, e.x, e.y, e.z), false);
				}
			}
		} else {
			this.handleMobEvents(this.mobs.interpolate(dt, now, this.localUserId));
		}

		// 矢
		const proj = this.projectiles.update(dt, this.world, this.mobs);
		for (const h of proj.mobHits) {
			this.audio.play('arrowHit', { x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z });
			const hit: MobHit = { id: h.id, damage: h.damage, kx: h.kx, kz: h.kz };
			this.handleMobEvents(this.mobs.applyHit(hit, this.localUserId, now, { looting: 0, knockback: h.knockback }));
			if (!this.mobs.isHost) this.listeners.mobHit?.(hit);
		}
		if (proj.blockHits > 0) this.audio.play('arrowHit', { volume: 0.5 });

		// 粒子の寿命と落下
		this.renderer.particles.update(dt, this.world);

		// 描画
		this.renderer.updateChunks(this.player.pos.x, this.player.pos.z);
		const light = daylight();
		const entities: EntityDraw[] = [];
		for (const p of this.remotePlayers.values()) {
			entities.push({ kind: 'player', x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, skinUrl: p.skinUrl, walkPhase: p.walkPhase, light: this.entityLight(p.x, p.y, p.z, light) });
		}
		const mobList = this.mobs.drawList(now);
		const hurtNow = new Set<string>();
		for (const m of mobList) {
			entities.push({ kind: m.type, x: m.x, y: m.y, z: m.z, yaw: m.yaw, walkPhase: m.walkPhase, hurt: m.hurt, deathT: m.deathT, swell: m.swell, light: this.entityLight(m.x, m.y, m.z, light) });
			if (m.hurt) {
				hurtNow.add(m.id);
				if (!this.hurtMobs.has(m.id)) this.audio.play('mobHurt', { mob: m.type, x: m.x, y: m.y, z: m.z });
			}
			if (m.burning && Math.random() < dt * 6) this.renderer.particles.spawn('flame', m.x, m.y + Math.random() * 1.5, m.z, 1);
			if (m.swell > 0 && m.swell < 1 && !this.hurtMobs.has(`${m.id}:fuse`)) {
				this.audio.play('creeperFuse', { x: m.x, y: m.y, z: m.z });
				this.hurtMobs.add(`${m.id}:fuse`);
			}
			// 鳴き声は近くの MOB だけ、全体で 3 秒に 1 回まで (夜は MOB が多く、鳴きすぎると耳障り)
			if (m.deathT === 0 && now - this.lastMobAmbientAt > MOB_AMBIENT_MIN_INTERVAL && Math.random() < dt / 30) {
				const d = Math.hypot(m.x - this.player.pos.x, m.z - this.player.pos.z);
				if (d < 16) {
					this.lastMobAmbientAt = now;
					this.audio.play('mobAmbient', { mob: m.type, x: m.x, y: m.y, z: m.z, volume: 0.7 });
				}
			}
		}
		for (const id of [...this.hurtMobs]) if (!id.endsWith(':fuse') && !hurtNow.has(id)) this.hurtMobs.delete(id);
		for (const id of hurtNow) this.hurtMobs.add(id);
		entities.push(...this.projectiles.drawList());

		const underwater = isHeadInWater(this.world, this.player.pos, this.player.eyeHeight);
		const held = this.player.selectedStack;
		const swing = clamp((now - this.lastSwingAt) / SWING_MS, 0, 1);
		const bobPhase = this.player.walkDistance * Math.PI;
		const bobAmp = this.settings.viewBobbing && this.player.onGround && !this.player.isSneaking ? Math.min(1, this.player.horizontalSpeed / PLAYER.walkSpeed) * 0.05 : 0;
		const fov = 70 * this.player.fovScale * (this.usingSince != null && ITEM_DEFS[held?.id ?? -1]?.kind === 'bow' ? 1 - 0.15 * this.player.useProgress : 1);
		this.renderer.render({
			eyeX: this.player.pos.x, eyeY: this.player.eyeY, eyeZ: this.player.pos.z,
			yaw: this.player.yaw, pitch: this.player.pitch,
			fovDeg: fov,
			roll: this.player.hurtTilt(now),
			bobX: Math.sin(bobPhase) * bobAmp,
			// renderer はカメラを -(bobX, bobY) だけ動かすので、正の値で足が着くたびに視点が沈む
			bobY: Math.abs(Math.cos(bobPhase)) * bobAmp,
			target: this.target,
			breakProgress: this.breakProgress,
			daylight: light,
			timeOfDay: timeOfDay(),
			underwater,
			entities,
			hand: this.player.isDead ? null : {
				itemId: held?.id ?? null,
				swing: swing < 1 ? swing : 0,
				eating: this.usingSince != null ? this.player.useProgress : 0,
				bobX: Math.sin(bobPhase) * bobAmp * 2,
				bobY: Math.abs(Math.cos(bobPhase)) * bobAmp * 2,
			},
			light: this.lightAtEye(),
		});

		// 音の位置と環境音
		this.audio.setListener(this.player.pos.x, this.player.eyeY, this.player.pos.z, this.player.yaw);
		this.audio.setAmbient({ daylight: light, underwater });

		if (this.minimap && now - this.lastMinimap >= MINIMAP_INTERVAL) {
			this.lastMinimap = now;
			this.minimap.render({
				x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw,
				players: [...this.remotePlayers.values()].map(p => ({ x: p.x, z: p.z, color: p.color })),
				mobs: mobList.filter(m => m.deathT === 0).map(m => ({ x: m.x, z: m.z, type: m.type })),
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
		this.audio.dispose();
	}
}
