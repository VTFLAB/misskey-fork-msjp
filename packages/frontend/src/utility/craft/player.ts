/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BLOCK, WORLD, isSolid } from './constants.js';
import { lookDir } from './math.js';
import type { CraftWorld } from './world.js';

export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;

const GRAVITY = 28;
const JUMP_SPEED = 9;
const WALK_SPEED = 4.5;
const SPRINT_SPEED = 7;
const SNEAK_SPEED = 2;
const FLY_SPEED = 12;
const MAX_FALL = 50;

export type Input = {
	forward: boolean;
	back: boolean;
	left: boolean;
	right: boolean;
	jump: boolean;
	sneak: boolean;
	sprint: boolean;
	flyUp: boolean;
	flyDown: boolean;
};

export class Player {
	public x = 0;
	public y = 0;
	public z = 0;
	public vx = 0;
	public vy = 0;
	public vz = 0;
	public yaw = 0;
	public pitch = 0;
	public onGround = false;
	public flying = false;

	constructor(private world: CraftWorld) {
	}

	public get eyeY(): number {
		return this.y + EYE_HEIGHT;
	}

	public spawn(x: number, z: number): void {
		this.x = x + 0.5;
		this.z = z + 0.5;
		this.y = this.world.surfaceY(x, z);
		this.vx = 0; this.vy = 0; this.vz = 0;
	}

	private collides(x: number, y: number, z: number): boolean {
		const half = PLAYER_WIDTH / 2;
		const minX = Math.floor(x - half), maxX = Math.floor(x + half - 0.0001);
		const minY = Math.floor(y), maxY = Math.floor(y + PLAYER_HEIGHT - 0.0001);
		const minZ = Math.floor(z - half), maxZ = Math.floor(z + half - 0.0001);
		for (let bx = minX; bx <= maxX; bx++) {
			for (let by = minY; by <= maxY; by++) {
				for (let bz = minZ; bz <= maxZ; bz++) {
					if (by < WORLD.minY) return true;
					if (isSolid(this.world.getBlock(bx, by, bz))) return true;
				}
			}
		}
		return false;
	}

	/** 指定ブロックがプレイヤーの体と重なるか (設置の可否判定) */
	public overlapsBlock(bx: number, by: number, bz: number): boolean {
		const half = PLAYER_WIDTH / 2;
		return bx + 1 > this.x - half && bx < this.x + half &&
			by + 1 > this.y && by < this.y + PLAYER_HEIGHT &&
			bz + 1 > this.z - half && bz < this.z + half;
	}

	public update(dt: number, input: Input): void {
		dt = Math.min(dt, 0.05);
		const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
		let mx = 0, mz = 0;
		if (input.forward) { mx -= sin; mz -= cos; }
		if (input.back) { mx += sin; mz += cos; }
		if (input.left) { mx -= cos; mz += sin; }
		if (input.right) { mx += cos; mz -= sin; }
		const len = Math.hypot(mx, mz);
		if (len > 0) { mx /= len; mz /= len; }

		if (this.flying) {
			const speed = input.sprint ? FLY_SPEED * 2 : FLY_SPEED;
			this.vx = mx * speed;
			this.vz = mz * speed;
			this.vy = (input.flyUp ? speed : 0) - (input.flyDown ? speed : 0);
		} else if (this.inWater()) {
			const speed = WALK_SPEED * 0.6;
			this.vx += (mx * speed - this.vx) * Math.min(1, dt * 6);
			this.vz += (mz * speed - this.vz) * Math.min(1, dt * 6);
			this.vy -= GRAVITY * 0.2 * dt;
			if (this.vy < -3) this.vy = -3;
			if (input.jump) this.vy = Math.min(4, this.vy + 30 * dt);
		} else {
			const speed = input.sneak ? SNEAK_SPEED : input.sprint ? SPRINT_SPEED : WALK_SPEED;
			// 空中では操作を効きにくくする
			const control = this.onGround ? 1 : 0.6;
			this.vx += (mx * speed - this.vx) * Math.min(1, dt * 12 * control);
			this.vz += (mz * speed - this.vz) * Math.min(1, dt * 12 * control);
			this.vy -= GRAVITY * dt;
			if (this.vy < -MAX_FALL) this.vy = -MAX_FALL;
			if (input.jump && this.onGround) {
				this.vy = JUMP_SPEED;
				this.onGround = false;
			}
		}

		this.moveAxis(this.vx * dt, 0, 0);
		this.moveAxis(0, 0, this.vz * dt);
		const before = this.vy;
		const movedY = this.moveAxis(0, this.vy * dt, 0);
		if (!movedY) {
			this.onGround = before < 0;
			this.vy = 0;
		} else {
			this.onGround = false;
		}
		// ワールドの外に出ない
		this.x = Math.max(WORLD.minX + 0.3, Math.min(WORLD.maxX + 0.7, this.x));
		this.z = Math.max(WORLD.minZ + 0.3, Math.min(WORLD.maxZ + 0.7, this.z));
		if (this.y > WORLD.maxY + 8) { this.y = WORLD.maxY + 8; if (this.vy > 0) this.vy = 0; }
		if (this.y < WORLD.minY - 20) {
			this.spawn(Math.floor(this.x), Math.floor(this.z));
		}
	}

	private inWater(): boolean {
		return this.world.getBlock(Math.floor(this.x), Math.floor(this.y + 0.6), Math.floor(this.z)) === BLOCK.water;
	}

	/** 1 軸ずつ動かし、ぶつかったら手前で止める。@returns 動けたか */
	private moveAxis(dx: number, dy: number, dz: number): boolean {
		if (dx === 0 && dy === 0 && dz === 0) return true;
		const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.25));
		const sx = dx / steps, sy = dy / steps, sz = dz / steps;
		for (let i = 0; i < steps; i++) {
			const nx = this.x + sx, ny = this.y + sy, nz = this.z + sz;
			if (this.collides(nx, ny, nz)) {
				// 低い段差 (1 ブロック以下) は自動で登る
				if (dy === 0 && this.onGround && !this.collides(nx, this.y + 1.001, nz) && !this.flying) {
					this.y += 1.001;
					this.x = nx; this.z = nz;
					continue;
				}
				if (dx !== 0) this.vx = 0;
				if (dz !== 0) this.vz = 0;
				return false;
			}
			this.x = nx; this.y = ny; this.z = nz;
		}
		return true;
	}

	/** 視線上のブロックを DDA で探す */
	public raycast(maxDist = 6): { x: number; y: number; z: number; nx: number; ny: number; nz: number } | null {
		const [dx, dy, dz] = lookDir(this.yaw, this.pitch);
		const ox = this.x, oy = this.eyeY, oz = this.z;
		let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
		const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
		const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
		const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
		const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
		let tMaxX = dx !== 0 ? ((dx > 0 ? x + 1 - ox : ox - x) * tDeltaX) : Infinity;
		let tMaxY = dy !== 0 ? ((dy > 0 ? y + 1 - oy : oy - y) * tDeltaY) : Infinity;
		let tMaxZ = dz !== 0 ? ((dz > 0 ? z + 1 - oz : oz - z) * tDeltaZ) : Infinity;
		let nx = 0, ny = 0, nz = 0;
		let t = 0;
		while (t <= maxDist) {
			const id = this.world.getBlock(x, y, z);
			if (isSolid(id)) return { x, y, z, nx, ny, nz };
			if (tMaxX < tMaxY && tMaxX < tMaxZ) {
				x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
			} else if (tMaxY < tMaxZ) {
				y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
			} else {
				z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
			}
			if (y < WORLD.minY - 1 || y > WORLD.maxY + 1) return null;
		}
		return null;
	}
}
