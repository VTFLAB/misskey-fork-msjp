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
};

export type ProjectileMobHit = { id: string; damage: number; kx: number; kz: number; knockback: number };

type Projectile = {
	x: number; y: number; z: number;
	vx: number; vy: number; vz: number;
	damage: number;
	knockback: number;
	ownerId: string | null;
	visualOnly: boolean;
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
			visualOnly: o.visualOnly === true, age: 0, stuck: null,
			yaw: Math.atan2(-o.dx, -o.dz), pitch: Math.atan2(o.dy, Math.hypot(o.dx, o.dz)),
		});
	}

	/** 各矢を前回位置から新位置まで刻んで進め、ブロックと MOB への当たりを調べる */
	public update(dt: number, world: CraftWorld, mobs: MobSystem): { mobHits: ProjectileMobHit[]; blockHits: number } {
		const mobHits: ProjectileMobHit[] = [];
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

			if (!p.visualOnly && total > 1e-9) {
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
		return { mobHits, blockHits };
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
