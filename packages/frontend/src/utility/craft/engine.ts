/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BLOCK, HOTBAR_BLOCKS, WORLD } from './constants.js';
import type { BlockId } from './constants.js';
import { CraftWorld } from './world.js';
import { CraftRenderer } from './renderer.js';
import type { RemotePlayerDraw } from './renderer.js';
import { Player } from './player.js';
import type { Input } from './player.js';
import { project } from './math.js';

export type RemotePlayer = {
	userId: string;
	username: string;
	name: string | null;
	avatarUrl: string | null;
	x: number; y: number; z: number;
	yaw: number; pitch: number;
	/** 補間の目標 */
	tx: number; ty: number; tz: number;
	lastSeen: number;
	color: [number, number, number];
};

export type EngineEvents = {
	setBlock: (x: number, y: number, z: number, type: number) => void;
	move: (x: number, y: number, z: number, yaw: number, pitch: number) => void;
	hotbarChange: (index: number) => void;
	pointerLockChange: (locked: boolean) => void;
	flyChange: (flying: boolean) => void;
};

const REMOTE_TIMEOUT = 15000;
const MOVE_SEND_INTERVAL = 100;
/** 動いていなくても在席を知らせる間隔 (受信側の REMOTE_TIMEOUT より十分短く) */
const MOVE_HEARTBEAT_INTERVAL = 5000;

function colorFromId(id: string): [number, number, number] {
	let h = 0;
	for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
	const hue = (h % 360) / 360;
	// HSL (hue, 0.6, 0.55) → RGB
	const s = 0.6, l = 0.55;
	const q = l + s - l * s;
	const p = 2 * l - q;
	const f = (t: number) => {
		if (t < 0) t += 1;
		if (t > 1) t -= 1;
		if (t < 1 / 6) return p + (q - p) * 6 * t;
		if (t < 1 / 2) return q;
		if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
		return p;
	};
	return [f(hue + 1 / 3), f(hue), f(hue - 1 / 3)];
}

/**
 * 画面 (canvas) への描画・入力・物理を束ねる。ネットワークは持たず、
 * 自分の操作はイベントで外へ出し、他人の操作は apply* で受け取る。
 */
export class CraftEngine {
	public readonly world: CraftWorld;
	public readonly player: Player;
	private renderer: CraftRenderer;
	private input: Input = { forward: false, back: false, left: false, right: false, jump: false, sneak: false, sprint: false, flyUp: false, flyDown: false };
	private raf = 0;
	private lastTime = 0;
	private lastMoveSent = 0;
	private lastSent = { x: NaN, y: NaN, z: NaN, yaw: NaN, pitch: NaN };
	private lastSpaceAt = 0;
	/** サーバーに送った設置・破壊のうち未確定のもの (key → 変更前の type)。拒否されたら戻す */
	private pendingEdits = new Map<string, number>();
	public hotbarIndex = 0;
	public canBuild = false;
	public remotePlayers = new Map<string, RemotePlayer>();
	public target: { x: number; y: number; z: number; nx: number; ny: number; nz: number } | null = null;
	private listeners: Partial<EngineEvents> = {};
	private disposed = false;

	constructor(private canvas: HTMLCanvasElement, seed: number) {
		this.world = new CraftWorld(seed);
		this.player = new Player(this.world);
		this.renderer = new CraftRenderer(canvas, this.world);
	}

	public on<K extends keyof EngineEvents>(event: K, fn: EngineEvents[K]): void {
		this.listeners[event] = fn;
	}

	public start(): void {
		const spawn = this.findSpawn();
		this.player.spawn(spawn.x, spawn.z);
		this.bind();
		this.lastTime = performance.now();
		this.loop(this.lastTime);
	}

	/** 原点に近い、水に浸かっていない柱を探す */
	private findSpawn(): { x: number; z: number } {
		for (let r = 0; r <= 48; r += 4) {
			for (let dz = -r; dz <= r; dz += 4) {
				for (let dx = -r; dx <= r; dx += 4) {
					if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
					const y = this.world.surfaceY(dx, dz);
					if (this.world.getBlock(dx, y, dz) !== BLOCK.water && this.world.getBlock(dx, y + 1, dz) === BLOCK.air) {
						return { x: dx, z: dz };
					}
				}
			}
		}
		return { x: 0, z: 0 };
	}

	public get selectedBlock(): BlockId {
		return HOTBAR_BLOCKS[this.hotbarIndex];
	}

	public get isLocked(): boolean {
		return window.document.pointerLockElement === this.canvas;
	}

	public requestLock(): void {
		if (this.disposed) return;
		// 新しいブラウザは Promise を返し、連続要求で reject することがある
		const result = this.canvas.requestPointerLock() as unknown;
		if (result instanceof Promise) result.catch(() => {});
	}

	// ----- 入力 -----

	private onKeyDown = (ev: KeyboardEvent) => {
		if (!this.isLocked) return;
		if (this.setKey(ev.code, true)) ev.preventDefault();
		// 長押しのリピートで飛行切替やブロック選択が連続しないようにする
		if (ev.repeat) return;
		if (ev.code === 'Space') {
			const now = performance.now();
			if (now - this.lastSpaceAt < 300) this.toggleFly();
			this.lastSpaceAt = now;
		}
		if (ev.code === 'KeyF') this.toggleFly();
		if (ev.code.startsWith('Digit')) {
			const n = Number(ev.code.slice(5));
			if (n >= 1 && n <= HOTBAR_BLOCKS.length) this.selectHotbar(n - 1);
		}
	};

	private onKeyUp = (ev: KeyboardEvent) => {
		this.setKey(ev.code, false);
	};

	private setKey(code: string, down: boolean): boolean {
		switch (code) {
			case 'KeyW': case 'ArrowUp': this.input.forward = down; return true;
			case 'KeyS': case 'ArrowDown': this.input.back = down; return true;
			case 'KeyA': case 'ArrowLeft': this.input.left = down; return true;
			case 'KeyD': case 'ArrowRight': this.input.right = down; return true;
			case 'Space': this.input.jump = down; this.input.flyUp = down; return true;
			case 'ShiftLeft': case 'ShiftRight': this.input.sneak = down; this.input.flyDown = down; return true;
			case 'ControlLeft': case 'ControlRight': this.input.sprint = down; return true;
		}
		return false;
	}

	private clearInput(): void {
		for (const k of Object.keys(this.input) as (keyof Input)[]) this.input[k] = false;
	}

	private onMouseMove = (ev: MouseEvent) => {
		if (!this.isLocked) return;
		const sens = 0.0022;
		this.player.yaw -= ev.movementX * sens;
		this.player.pitch -= ev.movementY * sens;
		const limit = Math.PI / 2 - 0.01;
		this.player.pitch = Math.max(-limit, Math.min(limit, this.player.pitch));
	};

	private onMouseDown = (ev: MouseEvent) => {
		if (!this.isLocked) {
			if (ev.button === 0) this.requestLock();
			return;
		}
		ev.preventDefault();
		if (ev.button === 0) this.breakBlock();
		if (ev.button === 2) this.placeBlock();
	};

	private onContextMenu = (ev: Event) => {
		ev.preventDefault();
	};

	private onWheel = (ev: WheelEvent) => {
		if (!this.isLocked) return;
		ev.preventDefault();
		const dir = ev.deltaY > 0 ? 1 : -1;
		this.selectHotbar((this.hotbarIndex + dir + HOTBAR_BLOCKS.length) % HOTBAR_BLOCKS.length);
	};

	private onPointerLockChange = () => {
		if (!this.isLocked) this.clearInput();
		this.listeners.pointerLockChange?.(this.isLocked);
	};

	private bind(): void {
		window.addEventListener('keydown', this.onKeyDown);
		window.addEventListener('keyup', this.onKeyUp);
		window.document.addEventListener('mousemove', this.onMouseMove);
		this.canvas.addEventListener('mousedown', this.onMouseDown);
		this.canvas.addEventListener('contextmenu', this.onContextMenu);
		this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
		window.document.addEventListener('pointerlockchange', this.onPointerLockChange);
	}

	private unbind(): void {
		window.removeEventListener('keydown', this.onKeyDown);
		window.removeEventListener('keyup', this.onKeyUp);
		window.document.removeEventListener('mousemove', this.onMouseMove);
		this.canvas.removeEventListener('mousedown', this.onMouseDown);
		this.canvas.removeEventListener('contextmenu', this.onContextMenu);
		this.canvas.removeEventListener('wheel', this.onWheel);
		window.document.removeEventListener('pointerlockchange', this.onPointerLockChange);
	}

	public selectHotbar(index: number): void {
		this.hotbarIndex = index;
		this.listeners.hotbarChange?.(index);
	}

	public toggleFly(): void {
		this.player.flying = !this.player.flying;
		if (this.player.flying) this.player.vy = 0;
		this.listeners.flyChange?.(this.player.flying);
	}

	// ----- ブロック操作 -----

	private breakBlock(): void {
		if (!this.canBuild || this.target == null) return;
		const { x, y, z } = this.target;
		if (y === WORLD.minY) return; // 最下層は壊せない
		this.localEdit(x, y, z, BLOCK.air);
	}

	private localEdit(x: number, y: number, z: number, id: number): void {
		const key = `${x},${y},${z}`;
		const prev = this.world.getBlock(x, y, z);
		if (this.world.setBlock(x, y, z, id)) {
			if (!this.pendingEdits.has(key)) this.pendingEdits.set(key, prev);
			this.listeners.setBlock?.(x, y, z, id);
		}
	}

	private placeBlock(): void {
		if (!this.canBuild || this.target == null) return;
		const x = this.target.x + this.target.nx;
		const y = this.target.y + this.target.ny;
		const z = this.target.z + this.target.nz;
		if (!this.world.inBounds(x, y, z)) return;
		const current = this.world.getBlock(x, y, z);
		if (current !== BLOCK.air && current !== BLOCK.water) return;
		const id = this.selectedBlock;
		if (id !== BLOCK.water && this.player.overlapsBlock(x, y, z)) return;
		for (const p of this.remotePlayers.values()) {
			if (x + 1 > p.x - 0.3 && x < p.x + 0.3 && y + 1 > p.y && y < p.y + 1.8 && z + 1 > p.z - 0.3 && z < p.z + 0.3) return;
		}
		this.localEdit(x, y, z, id);
	}

	/** サーバーから届いたブロック変更を反映する */
	public applyRemoteBlock(x: number, y: number, z: number, type: number): void {
		this.pendingEdits.delete(`${x},${y},${z}`);
		this.world.setBlock(x, y, z, type);
	}

	/** サーバーに拒否された自分の変更を元に戻す */
	public revertLocalEdit(x: number, y: number, z: number): void {
		const key = `${x},${y},${z}`;
		const prev = this.pendingEdits.get(key);
		if (prev == null) return;
		this.pendingEdits.delete(key);
		this.world.setBlock(x, y, z, prev);
	}

	public applyRemotePlayer(p: { userId: string; username: string; name: string | null; avatarUrl: string | null; x: number; y: number; z: number; yaw: number; pitch: number }): void {
		const existing = this.remotePlayers.get(p.userId);
		if (existing) {
			existing.tx = p.x; existing.ty = p.y; existing.tz = p.z;
			existing.yaw = p.yaw; existing.pitch = p.pitch;
			existing.username = p.username; existing.name = p.name; existing.avatarUrl = p.avatarUrl;
			existing.lastSeen = performance.now();
			return;
		}
		this.remotePlayers.set(p.userId, {
			...p,
			tx: p.x, ty: p.y, tz: p.z,
			lastSeen: performance.now(),
			color: colorFromId(p.userId),
		});
	}

	public removeRemotePlayer(userId: string): void {
		this.remotePlayers.delete(userId);
	}

	/** 他プレイヤーのラベル表示位置 (canvas 内の px)。画面外・背後なら含めない */
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
				dist: Math.hypot(p.x - this.player.x, p.y - this.player.y, p.z - this.player.z),
			});
		}
		return out;
	}

	// ----- ループ -----

	private loop = (now: number) => {
		if (this.disposed) return;
		this.raf = window.requestAnimationFrame(this.loop);
		const dt = Math.min(0.1, (now - this.lastTime) / 1000);
		this.lastTime = now;

		this.player.update(dt, this.input);
		this.target = this.player.raycast(6);

		// 他プレイヤーの補間と掃除
		for (const [id, p] of this.remotePlayers) {
			if (now - p.lastSeen > REMOTE_TIMEOUT) {
				this.remotePlayers.delete(id);
				continue;
			}
			const k = Math.min(1, dt * 12);
			p.x += (p.tx - p.x) * k;
			p.y += (p.ty - p.y) * k;
			p.z += (p.tz - p.z) * k;
		}

		this.renderer.updateChunks(this.player.x, this.player.z);
		const players: RemotePlayerDraw[] = [];
		for (const p of this.remotePlayers.values()) {
			players.push({ x: p.x, y: p.y, z: p.z, yaw: p.yaw, color: p.color });
		}
		this.renderer.render({
			eyeX: this.player.x, eyeY: this.player.eyeY, eyeZ: this.player.z,
			yaw: this.player.yaw, pitch: this.player.pitch,
			target: this.target,
			players,
		});

		if (now - this.lastMoveSent >= MOVE_SEND_INTERVAL) {
			const p = this.player;
			const s = this.lastSent;
			const changed = Math.abs(p.x - s.x) > 0.01 || Math.abs(p.y - s.y) > 0.01 || Math.abs(p.z - s.z) > 0.01 || Math.abs(p.yaw - s.yaw) > 0.01 || Math.abs(p.pitch - s.pitch) > 0.01;
			if (changed || now - this.lastMoveSent >= MOVE_HEARTBEAT_INTERVAL) {
				this.lastSent = { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch };
				this.lastMoveSent = now;
				this.listeners.move?.(
					Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, Math.round(p.z * 100) / 100,
					Math.round(p.yaw * 1000) / 1000, Math.round(p.pitch * 1000) / 1000,
				);
			}
		}
	};

	public dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		window.cancelAnimationFrame(this.raf);
		this.unbind();
		if (this.isLocked) window.document.exitPointerLock();
		this.renderer.dispose();
	}
}
