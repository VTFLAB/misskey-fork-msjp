/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BLOCK_DEFS } from './constants.js';
import { tileAverageColor } from './atlas.js';
import type { ParticleKind } from './types.js';

/** パーティクルが読むワールドの最小限の面 (CraftWorld がそのまま渡せる) */
export type ParticleWorld = {
	getBlock(x: number, y: number, z: number): number;
	lightAt?(x: number, y: number, z: number): number;
};

export type Particle = {
	kind: ParticleKind;
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	vz: number;
	/** 残り時間 (秒) */
	life: number;
	maxLife: number;
	/** 一辺の長さ (ブロック) */
	size: number;
	/** 0..1 */
	r: number;
	g: number;
	b: number;
	/** 下向きの加速度 (ブロック/秒^2)。負なら浮く */
	gravity: number;
	/** 0..1 */
	sky: number;
	block: number;
};

export type SpawnOpts = {
	/** 0..1 の色。省略時は種類ごとの既定色 */
	color?: [number, number, number];
	/** 初速の倍率 */
	speed?: number;
	/** 大きさの倍率 */
	size?: number;
	/** 湧く範囲の半径 (ブロック) */
	spread?: number;
};

export const MAX_PARTICLES = 1500;
const GRAVITY = 16;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class ParticleSystem {
	public list: Particle[] = [];

	constructor(private world?: ParticleWorld) {}

	public get count(): number {
		return this.list.length;
	}

	public clear(): void {
		this.list.length = 0;
	}

	private push(p: Particle): void {
		this.list.push(p);
	}

	private trim(extra: number): void {
		const over = this.list.length + extra - MAX_PARTICLES;
		if (over > 0) this.list.splice(0, over);
	}

	private lightFor(x: number, y: number, z: number): [number, number] {
		const w = this.world;
		if (w?.lightAt == null) return [1, 0];
		const l = w.lightAt(Math.floor(x), Math.floor(y), Math.floor(z));
		return [((l >> 4) & 15) / 15, (l & 15) / 15];
	}

	private make(kind: ParticleKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, c: [number, number, number], gravity: number, light: [number, number]): Particle {
		return { kind, x, y, z, vx, vy, vz, life, maxLife: life, size, r: c[0], g: c[1], b: c[2], gravity, sky: light[0], block: light[1] };
	}

	/** ブロックを壊したとき、側面タイルの平均色の破片を飛ばす */
	public spawnBlock(x: number, y: number, z: number, blockId: number, count = 12): void {
		const def = BLOCK_DEFS[blockId];
		if (def == null) return;
		const [r8, g8, b8] = tileAverageColor(def.tiles[1]);
		this.trim(count);
		const light = this.lightFor(x, y, z);
		// 発光ブロックの破片は暗がりでも光る
		const glow = def.light > 0 ? Math.min(1, def.light / 15) : 0;
		for (let i = 0; i < count; i++) {
			const k = rnd(0.6, 1.0);
			const px = x + Math.random();
			const py = y + Math.random();
			const pz = z + Math.random();
			this.push(this.make('block', px, py, pz,
				rnd(-2.5, 2.5), rnd(0.5, 4), rnd(-2.5, 2.5),
				rnd(0.4, 1.2), rnd(0.08, 0.18),
				[r8 / 255 * k, g8 / 255 * k, b8 / 255 * k], GRAVITY,
				[light[0], Math.max(light[1], glow)]));
		}
	}

	public spawnCrit(x: number, y: number, z: number): void {
		this.spawn('crit', x, y, z, 10);
	}

	public spawn(kind: ParticleKind, x: number, y: number, z: number, n = 8, opts: SpawnOpts = {}): void {
		this.trim(n);
		const light = this.lightFor(x, y, z);
		const sp = opts.speed ?? 1;
		const sz = opts.size ?? 1;
		const spread = opts.spread ?? 0.3;
		for (let i = 0; i < n; i++) {
			const px = x + rnd(-spread, spread);
			const py = y + rnd(-spread, spread);
			const pz = z + rnd(-spread, spread);
			let p: Particle;
			switch (kind) {
				case 'crit': {
					const yellow = Math.random() < 0.5;
					p = this.make(kind, x, y, z, rnd(-3, 3) * sp, rnd(0.5, 4) * sp, rnd(-3, 3) * sp, rnd(0.3, 0.6), rnd(0.05, 0.1) * sz,
						opts.color ?? (yellow ? [1, 0.9, 0.4] : [1, 1, 1]), GRAVITY * 0.25, [Math.max(light[0], 0.8), light[1]]);
					break;
				}
				case 'smoke': {
					const g = rnd(0.25, 0.5);
					p = this.make(kind, px, py, pz, rnd(-0.2, 0.2), rnd(0.5, 1.2) * sp, rnd(-0.2, 0.2), rnd(0.8, 1.2), rnd(0.12, 0.2) * sz,
						opts.color ?? [g, g, g], -0.5, light);
					break;
				}
				case 'flame':
					p = this.make(kind, px, py, pz, rnd(-0.15, 0.15), rnd(0.4, 1) * sp, rnd(-0.15, 0.15), rnd(0.4, 0.8), rnd(0.07, 0.12) * sz,
						opts.color ?? [1, rnd(0.45, 0.8), 0.1], -0.2, [Math.max(light[0], 0.9), 1]);
					break;
				case 'splash':
					p = this.make(kind, px, py, pz, rnd(-1.5, 1.5) * sp, rnd(1.5, 4.5) * sp, rnd(-1.5, 1.5) * sp, rnd(0.5, 1.0), rnd(0.06, 0.12) * sz,
						opts.color ?? [0.3, 0.55, 0.95], GRAVITY, light);
					break;
				case 'bubble':
					p = this.make(kind, px, py, pz, rnd(-0.15, 0.15), rnd(0.6, 1.3) * sp, rnd(-0.15, 0.15), rnd(0.6, 1.2), rnd(0.05, 0.1) * sz,
						opts.color ?? [0.8, 0.92, 1], -0.2, light);
					break;
				case 'heart':
					p = this.make(kind, px, py, pz, rnd(-0.2, 0.2), rnd(0.5, 1) * sp, rnd(-0.2, 0.2), rnd(0.8, 1.2), rnd(0.15, 0.2) * sz,
						opts.color ?? [1, rnd(0.3, 0.5), rnd(0.5, 0.7)], -0.3, [1, light[1]]);
					break;
				case 'enchant': {
					// 周囲から立ち上り、らせんを描く: 初速に横向きの渦を与える
					const a = Math.random() * Math.PI * 2;
					const rad = rnd(0.4, 1.2);
					p = this.make(kind, x + Math.cos(a) * rad, y + rnd(0, 0.6), z + Math.sin(a) * rad, -Math.sin(a) * 1.2 * sp, rnd(0.8, 1.8) * sp, Math.cos(a) * 1.2 * sp, rnd(0.8, 1.2), rnd(0.05, 0.09) * sz,
						opts.color ?? [rnd(0.5, 0.75), rnd(0.25, 0.4), 1], -0.3, [1, 1]);
					break;
				}
				case 'explosion': {
					const g = rnd(0.35, 0.7);
					p = this.make(kind, px, py, pz, rnd(-3, 3) * sp, rnd(-1, 3) * sp, rnd(-3, 3) * sp, rnd(0.5, 1.0), rnd(0.3, 0.6) * sz,
						opts.color ?? [g, g, g], -0.3, [Math.max(light[0], 0.6), light[1]]);
					break;
				}
				case 'xp': {
					const green = Math.random() < 0.5;
					p = this.make(kind, px, py, pz, rnd(-0.8, 0.8) * sp, rnd(0.5, 2) * sp, rnd(-0.8, 0.8) * sp, rnd(0.6, 1.0), rnd(0.05, 0.09) * sz,
						opts.color ?? (green ? [0.45, 1, 0.2] : [0.9, 1, 0.3]), -0.2, [1, 1]);
					break;
				}
				case 'block':
				default:
					p = this.make('block', px, py, pz, rnd(-1.5, 1.5) * sp, rnd(0.5, 3) * sp, rnd(-1.5, 1.5) * sp, rnd(0.4, 1.2), rnd(0.08, 0.18) * sz,
						opts.color ?? [0.5, 0.5, 0.5], GRAVITY, light);
					break;
			}
			this.push(p);
		}
	}

	/** 重力・浮力と、固体ブロックへの簡易な衝突 (止まって vy = 0) */
	public update(dt: number, world: ParticleWorld = this.world!): void {
		const list = this.list;
		let w = 0;
		for (let i = 0; i < list.length; i++) {
			const p = list[i];
			p.life -= dt;
			if (p.life <= 0) continue;
			p.vy -= p.gravity * dt;
			if (p.kind === 'explosion' || p.kind === 'smoke') {
				// 広がりながら減速する
				const drag = Math.max(0, 1 - 2.5 * dt);
				p.vx *= drag; p.vz *= drag;
				if (p.kind === 'explosion') p.vy *= drag;
			}
			if (p.kind === 'enchant') {
				// 渦を巻かせる: 水平速度を中心方向へ回す
				const a = 3 * dt;
				const c = Math.cos(a), s = Math.sin(a);
				const nvx = p.vx * c - p.vz * s;
				p.vz = p.vx * s + p.vz * c;
				p.vx = nvx;
			}
			const nx = p.x + p.vx * dt;
			const ny = p.y + p.vy * dt;
			const nz = p.z + p.vz * dt;
			if (world != null && BLOCK_DEFS[world.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz))]?.solid === true) {
				p.vy = 0;
				p.vx *= 0.5;
				p.vz *= 0.5;
			} else {
				p.x = nx; p.y = ny; p.z = nz;
			}
			list[w++] = p;
		}
		list.length = w;
	}
}
