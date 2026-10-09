/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BLOCK, WORLD, isSolid } from './constants.js';
import { lookDir } from './math.js';
import type { BlockHit, Vec3 } from './types.js';
import type { CraftWorld } from './world.js';

export const GRAVITY = 28;
export const MAX_FALL_SPEED = 50;

/** 幅 w、高さ h の箱 (足元中心が pos) がブロックと重なるか */
export function collides(world: CraftWorld, x: number, y: number, z: number, w: number, h: number): boolean {
	const half = w / 2;
	const minX = Math.floor(x - half), maxX = Math.floor(x + half - 0.0001);
	const minY = Math.floor(y), maxY = Math.floor(y + h - 0.0001);
	const minZ = Math.floor(z - half), maxZ = Math.floor(z + half - 0.0001);
	for (let bx = minX; bx <= maxX; bx++) {
		for (let by = minY; by <= maxY; by++) {
			for (let bz = minZ; bz <= maxZ; bz++) {
				if (by < WORLD.minY) return true;
				if (isSolid(world.getBlock(bx, by, bz))) return true;
			}
		}
	}
	return false;
}

/** ブロック (bx, by, bz) が箱と重なるか (設置の可否判定) */
export function overlapsBlock(pos: Vec3, w: number, h: number, bx: number, by: number, bz: number): boolean {
	const half = w / 2;
	return bx + 1 > pos.x - half && bx < pos.x + half &&
		by + 1 > pos.y && by < pos.y + h &&
		bz + 1 > pos.z - half && bz < pos.z + half;
}

export type MoveResult = {
	onGround: boolean;
	/** 水平方向で壁に当たった */
	hitWall: boolean;
	/** 頭を打った */
	hitCeiling: boolean;
};

/**
 * 速度 vel で dt 秒ぶん動かす。1 軸ずつ動かし、ぶつかったら手前で止めて速度を 0 にする。
 * stepUp が true なら 1 ブロックの段差を自動で登る。
 */
export function moveEntity(world: CraftWorld, pos: Vec3, vel: Vec3, w: number, h: number, dt: number, opts: { stepUp?: boolean; onGround?: boolean } = {}): MoveResult {
	const result: MoveResult = { onGround: false, hitWall: false, hitCeiling: false };
	const axis = (dx: number, dy: number, dz: number): boolean => {
		if (dx === 0 && dy === 0 && dz === 0) return true;
		const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.25));
		const sx = dx / steps, sy = dy / steps, sz = dz / steps;
		for (let i = 0; i < steps; i++) {
			const nx = pos.x + sx, ny = pos.y + sy, nz = pos.z + sz;
			if (collides(world, nx, ny, nz, w, h)) {
				if (dy === 0 && opts.stepUp && opts.onGround && !collides(world, nx, pos.y + 1.001, nz, w, h)) {
					pos.y += 1.001;
					pos.x = nx; pos.z = nz;
					continue;
				}
				return false;
			}
			pos.x = nx; pos.y = ny; pos.z = nz;
		}
		return true;
	};

	if (!axis(vel.x * dt, 0, 0)) { vel.x = 0; result.hitWall = true; }
	if (!axis(0, 0, vel.z * dt)) { vel.z = 0; result.hitWall = true; }
	const vyBefore = vel.y;
	if (!axis(0, vel.y * dt, 0)) {
		result.onGround = vyBefore < 0;
		result.hitCeiling = vyBefore > 0;
		vel.y = 0;
	}
	// 落下の下限と上限
	if (pos.y > WORLD.maxY + 16) { pos.y = WORLD.maxY + 16; if (vel.y > 0) vel.y = 0; }
	pos.x = Math.max(-WORLD.maxCoord, Math.min(WORLD.maxCoord, pos.x));
	pos.z = Math.max(-WORLD.maxCoord, Math.min(WORLD.maxCoord, pos.z));
	return result;
}

/** 体の中心あたりが水に浸かっているか */
export function isInWater(world: CraftWorld, pos: Vec3, h: number): boolean {
	return world.getBlock(Math.floor(pos.x), Math.floor(pos.y + h * 0.35), Math.floor(pos.z)) === BLOCK.water;
}

/** 頭 (目の高さ) が水に浸かっているか */
export function isHeadInWater(world: CraftWorld, pos: Vec3, eyeHeight: number): boolean {
	return world.getBlock(Math.floor(pos.x), Math.floor(pos.y + eyeHeight), Math.floor(pos.z)) === BLOCK.water;
}

/** 視線上のブロックを DDA で探す */
export function raycastBlocks(world: CraftWorld, ox: number, oy: number, oz: number, yaw: number, pitch: number, maxDist: number): BlockHit | null {
	const [dx, dy, dz] = lookDir(yaw, pitch);
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
		const id = world.getBlock(x, y, z);
		if (isSolid(id)) return { x, y, z, nx, ny, nz, dist: t };
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

/**
 * 光線と箱 (足元中心 pos、幅 w、高さ h) の交差距離。当たらなければ null
 */
export function rayHitsBox(ox: number, oy: number, oz: number, dir: [number, number, number], pos: Vec3, w: number, h: number, maxDist: number): number | null {
	const half = w / 2;
	const minX = pos.x - half, maxX = pos.x + half;
	const minY = pos.y, maxY = pos.y + h;
	const minZ = pos.z - half, maxZ = pos.z + half;
	let tmin = 0, tmax = maxDist;
	const slab = (o: number, d: number, lo: number, hi: number): boolean => {
		if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
		let t1 = (lo - o) / d, t2 = (hi - o) / d;
		if (t1 > t2) [t1, t2] = [t2, t1];
		tmin = Math.max(tmin, t1);
		tmax = Math.min(tmax, t2);
		return tmin <= tmax;
	};
	if (!slab(ox, dir[0], minX, maxX)) return null;
	if (!slab(oy, dir[1], minY, maxY)) return null;
	if (!slab(oz, dir[2], minZ, maxZ)) return null;
	return tmin;
}
