/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { isSolid } from './constants.js';
import type { EntityDraw } from './models.js';
import type { MobSystem } from './mobs.js';
import type { CraftWorld } from './world.js';

export type ShootOptions = {
	x: number;
	y: number;
	z: number;
	/** 向き (正規化されていなくてよい) */
	dx: number;
	dy: number;
	dz: number;
	/** ブロック/秒 */
	speed: number;
	damage: number;
	knockback: number;
	ownerId: string | null;
	/** true なら見た目だけ (MOB に当たらず、ダメージも返さない) */
	visualOnly?: boolean;
	/** true なら自分のプレイヤーに当たる (MOB には当たらない)。スケルトンの矢用 */
	hitsPlayer?: boolean;
};

export type PlayerBox = { x: number; y: number; z: number; w: number; h: number };
export type ProjectilePlayerHit = { damage: number; kx: number; kz: number; knockback: number };

export type ProjectileMobHit = { id: string; damage: number; kx: number; kz: number; knockback: number };

type Projectile = {
	x: number; y: number; z: number;
	vx: number; vy: number; vz: number;
	damage: number;
	knockback: number;
	ownerId: string | null;
	visualOnly: boolean;
	hitsPlayer: boolean;
	age: number;
	yaw: number;
	pitch: number;
	/** 刺さってからの経過秒。null なら飛行中 */
	stuck: number | null;
};

const GRAVITY = 20;
/** 50 ms あたり 1% の空気抵抗 */
const DRAG_PER_SEC = 0.99 ** 20;
const LIFETIME = 5;
const STUCK_TIME = 1;
const MAX_PROJECTILES = 64;
const MAX_STEP = 0.25;

/** 線分 (o + t*m, t は 0..1) がプレイヤーの箱 (足元中心 w×h×w) に最初に入る t。当たらなければ null */
function segmentHitsBox(ox: number, oy: number, oz: number, mx: number, my: number, mz: number, b: PlayerBox): number | null {
	const half = b.w / 2;
	let tmin = 0, tmax = 1;
	const slab = (o: number, d: number, lo: number, hi: number): boolean => {
		if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
		let t1 = (lo - o) / d, t2 = (hi - o) / d;
		if (t1 > t2) [t1, t2] = [t2, t1];
		tmin = Math.max(tmin, t1);
		tmax = Math.min(tmax, t2);
		return tmin <= tmax;
	};
	if (!slab(ox, mx, b.x - half, b.x + half)) return null;
	if (!slab(oy, my, b.y, b.y + b.h)) return null;
	if (!slab(oz, mz, b.z - half, b.z + half)) return null;
	return tmin;
}

export class ProjectileSystem {
	private list: Projectile[] = [];

	public get count(): number {
		return this.list.length;
	}

	public clear(): void {
		this.list = [];
	}

	public shoot(o: ShootOptions): void {
		const len = Math.hypot(o.dx, o.dy, o.dz);
		if (len < 1e-9) return;
		if (this.list.length >= MAX_PROJECTILES) this.list.shift();
		this.list.push({
			x: o.x, y: o.y, z: o.z,
			vx: o.dx / len * o.speed, vy: o.dy / len * o.speed, vz: o.dz / len * o.speed,
			damage: o.damage, knockback: o.knockback, ownerId: o.ownerId,
			visualOnly: o.visualOnly === true, hitsPlayer: o.hitsPlayer === true, age: 0, stuck: null,
			yaw: Math.atan2(-o.dx, -o.dz), pitch: Math.atan2(o.dy, Math.hypot(o.dx, o.dz)),
		});
	}

	/** 各矢を前回位置から新位置まで刻んで進め、ブロックと MOB への当たりを調べる */
	public update(dt: number, world: CraftWorld, mobs: MobSystem, localPlayer?: PlayerBox): { mobHits: ProjectileMobHit[]; blockHits: number; playerHits: ProjectilePlayerHit[] } {
		const mobHits: ProjectileMobHit[] = [];
		const playerHits: ProjectilePlayerHit[] = [];
		let blockHits = 0;
		const drag = DRAG_PER_SEC ** dt;
		const alive: Projectile[] = [];
		for (const p of this.list) {
			p.age += dt;
			if (p.stuck != null) {
				p.stuck += dt;
				if (p.stuck < STUCK_TIME) alive.push(p);
				continue;
			}
			if (p.age >= LIFETIME) continue;

			p.vy -= GRAVITY * dt;
			p.vx *= drag; p.vy *= drag; p.vz *= drag;
			p.yaw = Math.atan2(-p.vx, -p.vz);
			p.pitch = Math.atan2(p.vy, Math.hypot(p.vx, p.vz));
			const mx = p.vx * dt, my = p.vy * dt, mz = p.vz * dt;
			const total = Math.hypot(mx, my, mz);
			const steps = Math.max(1, Math.ceil(total / MAX_STEP));
			let consumed = false;

			if (p.hitsPlayer && localPlayer != null && total > 1e-9) {
				const d = segmentHitsBox(p.x, p.y, p.z, mx, my, mz, localPlayer);
				const blockT = this.firstSolid(world, p, mx, my, mz, steps);
				if (d != null && (blockT == null || d <= blockT)) {
					const h = Math.hypot(p.vx, p.vz) || 1;
					playerHits.push({ damage: p.damage, kx: p.vx / h, kz: p.vz / h, knockback: p.knockback });
					continue;
				}
			}
			if (!p.visualOnly && !p.hitsPlayer && total > 1e-9) {
				const hit = mobs.hitTest(p.x, p.y, p.z, mx, my, mz, total);
				// ブロックより手前の MOB だけ当たりとする
				const blockT = this.firstSolid(world, p, mx, my, mz, steps);
				if (hit != null && (blockT == null || hit.dist / total <= blockT)) {
					const h = Math.hypot(p.vx, p.vz) || 1;
					mobHits.push({ id: hit.id, damage: p.damage, kx: p.vx / h, kz: p.vz / h, knockback: p.knockback });
					consumed = true;
				}
			}
			if (consumed) continue;

			const t = this.firstSolid(world, p, mx, my, mz, steps);
			if (t != null) {
				// 手前の空間まで進めて刺さる
				const back = Math.max(0, t - 1 / steps);
				p.x += mx * back; p.y += my * back; p.z += mz * back;
				p.vx = p.vy = p.vz = 0;
				p.stuck = 0;
				blockHits++;
				alive.push(p);
				continue;
			}
			p.x += mx; p.y += my; p.z += mz;
			alive.push(p);
		}
		this.list = alive;
		return { mobHits, blockHits, playerHits };
	}

	/** 移動量 (mx, my, mz) の線分上で最初に固体ブロックへ入る位置 (0..1)。無ければ null */
	private firstSolid(world: CraftWorld, p: Projectile, mx: number, my: number, mz: number, steps: number): number | null {
		for (let i = 1; i <= steps; i++) {
			const t = i / steps;
			const x = Math.floor(p.x + mx * t), y = Math.floor(p.y + my * t), z = Math.floor(p.z + mz * t);
			if (isSolid(world.getBlock(x, y, z))) return t;
		}
		return null;
	}

	public drawList(): EntityDraw[] {
		return this.list.map(p => ({ kind: 'arrow', x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch }));
	}
}
