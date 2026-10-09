/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BLOCK, WORLD } from './constants.js';

/**
 * seed から決定論的に地形を生成する。
 * サーバーは地形を持たず、どのクライアントでも同じ seed から同じ地形ができることを前提にしている。
 * 生成アルゴリズムを変えると既存ワールドの差分ブロックが浮いたり埋まったりするので、変更時は注意。
 */

function hash2(seed: number, x: number, y: number): number {
	let h = (seed ^ 0x9e3779b9) >>> 0;
	h = Math.imul(h ^ (x | 0), 0x85ebca6b) >>> 0;
	h = Math.imul(h ^ (y | 0), 0xc2b2ae35) >>> 0;
	h ^= h >>> 15;
	h = Math.imul(h, 0x27d4eb2f) >>> 0;
	h ^= h >>> 13;
	return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
	return t * t * (3 - 2 * t);
}

/** 2D value noise (0..1) */
function valueNoise(seed: number, x: number, y: number): number {
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const tx = smooth(x - x0);
	const ty = smooth(y - y0);
	const a = hash2(seed, x0, y0);
	const b = hash2(seed, x0 + 1, y0);
	const c = hash2(seed, x0, y0 + 1);
	const d = hash2(seed, x0 + 1, y0 + 1);
	return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

function fbm(seed: number, x: number, y: number, octaves: number): number {
	let amp = 1;
	let freq = 1;
	let sum = 0;
	let norm = 0;
	for (let i = 0; i < octaves; i++) {
		sum += valueNoise(seed + i * 131, x * freq, y * freq) * amp;
		norm += amp;
		amp *= 0.5;
		freq *= 2;
	}
	return sum / norm;
}

export function terrainHeight(seed: number, x: number, z: number): number {
	const continent = fbm(seed, x / 96, z / 96, 3);
	const detail = fbm(seed + 7, x / 24, z / 24, 4);
	const h = 21 + continent * 24 + (detail - 0.5) * 10;
	return Math.max(WORLD.minY + 1, Math.min(WORLD.maxY - 8, Math.floor(h)));
}

export function isTreeAt(seed: number, x: number, z: number): boolean {
	// 木の密度: 約 1/90 の柱に木を置く。水面付近と砂地には置かない
	const r = hash2(seed + 999, x, z);
	if (r > 1 / 90) return false;
	const h = terrainHeight(seed, x, z);
	if (h <= WORLD.seaLevel + 1) return false;
	// 隣接 2 マス以内に別の木があれば置かない (生成順に依らず対称にする)
	for (let dx = -2; dx <= 2; dx++) {
		for (let dz = -2; dz <= 2; dz++) {
			if (dx === 0 && dz === 0) continue;
			const r2 = hash2(seed + 999, x + dx, z + dz);
			if (r2 <= 1 / 90 && r2 < r) return false;
		}
	}
	return true;
}

/**
 * 1 列 (x, z) を生成し、columns[y] に書き込む。木は別パス (fillTrees) で足す。
 */
export function fillColumn(seed: number, x: number, z: number, out: Uint8Array, stride: number, offset: number): void {
	const h = terrainHeight(seed, x, z);
	const beach = h <= WORLD.seaLevel + 1;
	for (let y = WORLD.minY; y <= WORLD.maxY; y++) {
		let id: number = BLOCK.air;
		if (y === 0) {
			id = BLOCK.stone;
		} else if (y < h - 3) {
			id = BLOCK.stone;
		} else if (y < h) {
			id = beach ? BLOCK.sand : BLOCK.dirt;
		} else if (y === h) {
			id = beach ? BLOCK.sand : BLOCK.grass;
		} else if (y <= WORLD.seaLevel) {
			id = BLOCK.water;
		}
		out[offset + y * stride] = id;
	}
}

export type TreeBlock = { x: number; y: number; z: number; id: number };

/** (x, z) に木があればそのブロック群を返す */
export function treeBlocks(seed: number, x: number, z: number): TreeBlock[] {
	if (!isTreeAt(seed, x, z)) return [];
	const base = terrainHeight(seed, x, z) + 1;
	const height = 4 + Math.floor(hash2(seed + 17, x, z) * 2);
	const blocks: TreeBlock[] = [];
	for (let i = 0; i < height; i++) {
		blocks.push({ x, y: base + i, z, id: BLOCK.log });
	}
	const top = base + height - 1;
	for (let dy = -2; dy <= 1; dy++) {
		const radius = dy >= 0 ? 1 : 2;
		for (let dx = -radius; dx <= radius; dx++) {
			for (let dz = -radius; dz <= radius; dz++) {
				if (dx === 0 && dz === 0 && dy <= 0) continue;
				if (Math.abs(dx) === radius && Math.abs(dz) === radius && dy !== 0 && hash2(seed + 31, x + dx + dy * 7, z + dz) < 0.5) continue;
				const y = top + dy;
				if (y > WORLD.maxY) continue;
				blocks.push({ x: x + dx, y, z: z + dz, id: BLOCK.leaves });
			}
		}
	}
	blocks.push({ x, y: top + 1, z, id: BLOCK.leaves });
	return blocks;
}
