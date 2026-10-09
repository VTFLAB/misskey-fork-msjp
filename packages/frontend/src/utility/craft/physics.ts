/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BLOCK, BLOCK_DEFS, PLAYER, WORLD } from './constants.js';
import { lookDir } from './math.js';
import { collisionBoxes, renderBoxes } from './shapes.js';
import type { Box, NeighborFn } from './shapes.js';
import type { BlockHit, Vec3 } from './types.js';
import type { CraftWorld } from './world.js';

export const GRAVITY = PLAYER.gravity;
export const MAX_FALL_SPEED = PLAYER.maxFallSpeed;

const EPS = 1e-4;

function neighborFn(world: CraftWorld, x: number, y: number, z: number): NeighborFn {
	return (dx, dy, dz) => world.getBlock(x + dx, y + dy, z + dz);
}

/** (x, y, z) にあるブロック (id を渡せばそのブロックだったとして) の当たり判定の箱を、ワールド座標で返す */
export function boxesAt(world: CraftWorld, x: number, y: number, z: number, id: number = world.getBlock(x, y, z)): Box[] {
	const def = BLOCK_DEFS[id];
	if (def == null || !def.solid) return [];
	if (def.shape === 'cube') return [[x, y, z, x + 1, y + 1, z + 1]];
	return collisionBoxes(id, neighborFn(world, x, y, z)).map(b => [x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]] as Box);
}

/** 幅 w、高さ h の箱 (足元中心が pos) がブロックと重なるか。cube 以外は箱ごとに調べる */
export function collides(world: CraftWorld, x: number, y: number, z: number, w: number, h: number): boolean {
	const half = w / 2;
	const minX = Math.floor(x - half), maxX = Math.floor(x + half - 0.0001);
	const minY = Math.floor(y), maxY = Math.floor(y + h - 0.0001);
	const minZ = Math.floor(z - half), maxZ = Math.floor(z + half - 0.0001);
	const ex0 = x - half, ex1 = x + half, ez0 = z - half, ez1 = z + half, ey1 = y + h;
	for (let bx = minX; bx <= maxX; bx++) {
		// 1 段下は柵・塀 (高さ 1.5) のために調べる
		for (let by = minY - 1; by <= maxY; by++) {
			for (let bz = minZ; bz <= maxZ; bz++) {
				if (by < WORLD.minY) {
					if (by >= minY) return true;
					continue;
				}
				const id = world.getBlock(bx, by, bz);
				if (id === BLOCK.air) continue;
				const def = BLOCK_DEFS[id];
				if (def == null || !def.solid) continue;
				if (def.shape === 'cube') {
					if (by >= minY) return true;
					continue;
				}
				for (const b of collisionBoxes(id, neighborFn(world, bx, by, bz))) {
					if (bx + b[3] > ex0 + EPS && bx + b[0] < ex1 - EPS &&
						by + b[4] > y + EPS && by + b[1] < ey1 - EPS &&
						bz + b[5] > ez0 + EPS && bz + b[2] < ez1 - EPS) return true;
				}
			}
		}
	}
	return false;
}

/** ブロック (bx, by, bz) のセル全体が箱と重なるか (設置の可否判定) */
export function overlapsBlock(pos: Vec3, w: number, h: number, bx: number, by: number, bz: number): boolean {
	const half = w / 2;
	return bx + 1 > pos.x - half && bx < pos.x + half &&
		by + 1 > pos.y && by < pos.y + h &&
		bz + 1 > pos.z - half && bz < pos.z + half;
}

/**
 * ブロック (bx, by, bz) の当たり判定の箱が、箱 (足元中心 pos) と重なるか。
 * 半ブロックの空いている側には立てる。id を渡すと、そこに置くブロックとして調べる
 */
export function entityOverlapsBlock(pos: Vec3, w: number, h: number, world: CraftWorld, bx: number, by: number, bz: number, id?: number): boolean {
	const half = w / 2;
	for (const b of boxesAt(world, bx, by, bz, id)) {
		if (b[3] > pos.x - half && b[0] < pos.x + half &&
			b[4] > pos.y && b[1] < pos.y + h &&
			b[5] > pos.z - half && b[2] < pos.z + half) return true;
	}
	return false;
}

export type MoveResult = {
	onGround: boolean;
	/** 水平方向で壁に当たった */
	hitWall: boolean;
	/** 頭を打った */
	hitCeiling: boolean;
};

export type MoveOptions = {
	/** 段差を自動で登る (高さは stepHeight、既定 PLAYER.stepHeight) */
	stepUp?: boolean;
	stepHeight?: number;
	onGround?: boolean;
	/** 地面にいるとき、足場が無くなる方向へ水平に動かない (スニーク) */
	edgeSafe?: boolean;
};

/** 足元のすぐ下に固体があるか (スニークの縁止め) */
function hasSupport(world: CraftWorld, x: number, y: number, z: number, w: number): boolean {
	return collides(world, x, y - 0.1, z, w, 0.05);
}

/**
 * 速度 vel で dt 秒ぶん動かす。1 軸ずつ動かし、ぶつかったら手前で止めて速度を 0 にする。
 * stepUp が true なら stepHeight までの段差を自動で登る。
 */
export function moveEntity(world: CraftWorld, pos: Vec3, vel: Vec3, w: number, h: number, dt: number, opts: MoveOptions = {}): MoveResult {
	const result: MoveResult = { onGround: false, hitWall: false, hitCeiling: false };
	const stepHeight = opts.stepHeight ?? PLAYER.stepHeight;
	const axis = (dx: number, dy: number, dz: number): boolean => {
		if (dx === 0 && dy === 0 && dz === 0) return true;
		const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.25));
		const sx = dx / steps, sy = dy / steps, sz = dz / steps;
		const horizontal = dy === 0;
		for (let i = 0; i < steps; i++) {
			const nx = pos.x + sx, ny = pos.y + sy, nz = pos.z + sz;
			if (horizontal && opts.edgeSafe && opts.onGround && !hasSupport(world, nx, pos.y, nz, w) && hasSupport(world, pos.x, pos.y, pos.z, w)) {
				return false;
			}
			if (collides(world, nx, ny, nz, w, h)) {
				if (horizontal && opts.stepUp && opts.onGround) {
					let lifted = false;
					for (let lift = 0.1; lift <= stepHeight + 1e-6; lift += 0.1) {
						if (collides(world, pos.x, pos.y + lift, pos.z, w, h)) break;
						if (!collides(world, nx, pos.y + lift, nz, w, h)) {
							// 段の上に乗るよう、浮いた分だけ押し下げる
							let y = pos.y + lift;
							for (let k = 0; k < 10 && !collides(world, nx, y - 0.01, nz, w, h) && y - 0.01 >= pos.y; k++) y -= 0.01;
							pos.y = y;
							pos.x = nx; pos.z = nz;
							lifted = true;
							break;
						}
					}
					if (lifted) continue;
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

/** 箱 (足元中心 pos) と重なる範囲にはしごなど登れるブロックがあるか */
export function isOnLadder(world: CraftWorld, pos: Vec3, w: number, h: number): boolean {
	const half = w / 2;
	const minX = Math.floor(pos.x - half), maxX = Math.floor(pos.x + half - 0.0001);
	const minY = Math.floor(pos.y), maxY = Math.floor(pos.y + h - 0.0001);
	const minZ = Math.floor(pos.z - half), maxZ = Math.floor(pos.z + half - 0.0001);
	for (let x = minX; x <= maxX; x++) {
		for (let y = minY; y <= maxY; y++) {
			for (let z = minZ; z <= maxZ; z++) {
				if (BLOCK_DEFS[world.getBlock(x, y, z)]?.climbable === true) return true;
			}
		}
	}
	return false;
}

/** 足の真下 (4 隅と中心を y-0.05 で調べる) にあるブロック id。何も無ければ 0 */
export function blockBelow(world: CraftWorld, pos: Vec3, w: number): number {
	const half = w / 2 - 0.01;
	const y = Math.floor(pos.y - 0.05);
	const center = world.getBlock(Math.floor(pos.x), y, Math.floor(pos.z));
	if (center !== BLOCK.air && center !== BLOCK.water) return center;
	for (const [dx, dz] of [[-half, -half], [half, -half], [-half, half], [half, half]]) {
		const id = world.getBlock(Math.floor(pos.x + dx), y, Math.floor(pos.z + dz));
		if (id !== BLOCK.air && id !== BLOCK.water) return id;
	}
	return BLOCK.air;
}

export function isOnIce(world: CraftWorld, pos: Vec3, w: number): boolean {
	return BLOCK_DEFS[blockBelow(world, pos, w)]?.slippery === true;
}

/** セル内の描画用の箱のうち、光線が [tEnter, tExit] の間に最初に当たるもの */
function rayBoxesInCell(world: CraftWorld, id: number, x: number, y: number, z: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tEnter: number, tExit: number, pnx: number, pny: number, pnz: number): { nx: number; ny: number; nz: number; dist: number } | null {
	let best: { nx: number; ny: number; nz: number; dist: number } | null = null;
	const o = [ox, oy, oz], d = [dx, dy, dz], c = [x, y, z];
	for (const b of renderBoxes(id, neighborFn(world, x, y, z))) {
		let tNear = -Infinity, tFar = Infinity, axisN = -1, sign = 0, miss = false;
		for (let a = 0; a < 3; a++) {
			const lo = c[a] + b[a], hi = c[a] + b[a + 3];
			if (Math.abs(d[a]) < 1e-9) {
				if (o[a] < lo || o[a] > hi) { miss = true; break; }
				continue;
			}
			let t1 = (lo - o[a]) / d[a], t2 = (hi - o[a]) / d[a];
			if (t1 > t2) [t1, t2] = [t2, t1];
			if (t1 > tNear) { tNear = t1; axisN = a; sign = d[a] > 0 ? -1 : 1; }
			if (t2 < tFar) tFar = t2;
		}
		if (miss || tNear > tFar || tFar < tEnter - 1e-9 || tNear > tExit + 1e-9) continue;
		let hx = 0, hy = 0, hz = 0, dist = tNear;
		if (tNear >= tEnter - 1e-9) {
			if (axisN === 0) hx = sign; else if (axisN === 1) hy = sign; else if (axisN === 2) hz = sign;
		} else {
			// 光線が箱の内側から始まった
			dist = tEnter;
			hx = pnx; hy = pny; hz = pnz;
		}
		if (best == null || dist < best.dist) best = { nx: hx, ny: hy, nz: hz, dist };
	}
	return best;
}

/**
 * 視線上のブロックを DDA で探す。空気以外 (十字型・松明・はしごを含む) に当たる。
 * 水は opts.fluids が true のときだけ当たる
 */
export function raycastBlocks(world: CraftWorld, ox: number, oy: number, oz: number, yaw: number, pitch: number, maxDist: number, opts: { fluids?: boolean } = {}): BlockHit | null {
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
		if (id !== BLOCK.air && (id !== BLOCK.water || opts.fluids === true)) {
			const def = BLOCK_DEFS[id];
			if (def != null && (def.shape === 'boxes' || def.shape === 'bed' || def.shape === 'farmland')) {
				const tExit = Math.min(tMaxX, tMaxY, tMaxZ);
				const hit = rayBoxesInCell(world, id, x, y, z, ox, oy, oz, dx, dy, dz, t, tExit, nx, ny, nz);
				if (hit != null && hit.dist <= maxDist) return { x, y, z, ...hit };
			} else if (def != null && (def.shape !== 'cube' || def.solid || id === BLOCK.water)) {
				return { x, y, z, nx, ny, nz, dist: t };
			}
		}
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
