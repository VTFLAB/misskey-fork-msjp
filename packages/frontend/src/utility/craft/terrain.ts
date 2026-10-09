/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BIOME, BLOCK, WORLD } from './constants.js';
import type { BiomeId } from './constants.js';

/**
 * seed から決定論的に地形を生成する。
 * サーバーは地形を持たず、どのクライアントでも同じ seed から同じ地形ができることを前提にしている。
 * Math.imul / Math.floor / 四則演算だけを使い、超越関数 (sin など) は使わない。
 * 生成アルゴリズムを変えると既存ワールドの差分ブロックが浮いたり埋まったりするので、変更時は注意。
 */

const CS = WORLD.chunkSize;

export function hash2(seed: number, x: number, y: number): number {
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

export function valueNoise(seed: number, x: number, y: number): number {
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

export function fbm(seed: number, x: number, y: number, octaves: number): number {
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

// ----- バイオームと高さ -----
// 大陸性 (continentalness)・気温・湿度の 3 つの低周波 fbm から決める。
// 高さは大陸性と細かい起伏ノイズから連続的に作るので、バイオーム境界で段差は出ない。
// バイオームは表面の素材と地物だけを変える。

const C_OCEAN = 0.39;
const C_MOUNTAIN = 0.63;
const STONE_LINE = 60;
const SNOW_LINE = 72;

function continent(seed: number, x: number, z: number): number {
	return fbm(seed + 1001, x / 256, z / 256, 4);
}

function temperature(seed: number, x: number, z: number): number {
	return fbm(seed + 2003, x / 192, z / 192, 3);
}

function humidity(seed: number, x: number, z: number): number {
	return fbm(seed + 3011, x / 160, z / 160, 3);
}

function smoothstep(a: number, b: number, v: number): number {
	const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
	return t * t * (3 - 2 * t);
}

function heightFrom(seed: number, x: number, z: number, c: number): number {
	const detail = fbm(seed + 7, x / 28, z / 28, 4);
	const mount = smoothstep(C_MOUNTAIN - 0.02, C_MOUNTAIN + 0.1, c);
	const base = WORLD.seaLevel + 2 + (c - 0.5) * 90 + mount * 45;
	const rough = 4 + mount * 14;
	const h = base + (detail - 0.5) * 2 * rough;
	return Math.max(WORLD.minY + 2, Math.min(WORLD.maxY - 6, Math.floor(h)));
}

function pickBiome(c: number, t: number, hm: number): BiomeId {
	if (c < C_OCEAN) return BIOME.ocean;
	if (c > C_MOUNTAIN) return BIOME.mountains;
	if (t > 0.56 && hm < 0.45) return BIOME.desert;
	if (t < 0.42) return BIOME.taiga;
	if (hm > 0.54) return BIOME.forest;
	return BIOME.plains;
}

export function biomeAt(seed: number, x: number, z: number): BiomeId {
	const c = continent(seed, x, z);
	if (c < C_OCEAN) return BIOME.ocean;
	if (c > C_MOUNTAIN) return BIOME.mountains;
	return pickBiome(c, temperature(seed, x, z), humidity(seed, x, z));
}

export function terrainHeight(seed: number, x: number, z: number): number {
	return heightFrom(seed, x, z, continent(seed, x, z));
}

// ----- chunk 生成 -----

const MARGIN = 3;
const SPAN = CS + MARGIN * 2;
const colH = new Int32Array(SPAN * SPAN);
const colB = new Uint8Array(SPAN * SPAN);

const SY = WORLD.sizeY;

function putLeaf(out: Uint8Array, lx: number, y: number, lz: number): void {
	if (lx < 0 || lx >= CS || lz < 0 || lz >= CS || y < 0 || y >= SY) return;
	const i = (y * CS + lz) * CS + lx;
	if (out[i] === BLOCK.air) out[i] = BLOCK.leaves;
}

function putLog(out: Uint8Array, lx: number, y: number, lz: number): void {
	if (lx < 0 || lx >= CS || lz < 0 || lz >= CS || y < 0 || y >= SY) return;
	const i = (y * CS + lz) * CS + lx;
	const b = out[i];
	if (b === BLOCK.air || b === BLOCK.leaves) out[i] = BLOCK.log;
}

function leafDisc(out: Uint8Array, lx: number, y: number, lz: number, r: number, cut: boolean): void {
	for (let dz = -r; dz <= r; dz++) {
		for (let dx = -r; dx <= r; dx++) {
			if (cut && r > 0 && Math.abs(dx) === r && Math.abs(dz) === r) continue;
			putLeaf(out, lx + dx, y, lz + dz);
		}
	}
}

function drawOak(out: Uint8Array, lx: number, lz: number, h: number, th: number): void {
	const top = h + th;
	for (let y = h + 1; y <= top; y++) putLog(out, lx, y, lz);
	leafDisc(out, lx, top - 2, lz, 2, true);
	leafDisc(out, lx, top - 1, lz, 2, true);
	leafDisc(out, lx, top, lz, 1, false);
	leafDisc(out, lx, top + 1, lz, 1, true);
}

function drawSpruce(out: Uint8Array, lx: number, lz: number, h: number, th: number): void {
	const top = h + th;
	for (let y = h + 1; y <= top; y++) putLog(out, lx, y, lz);
	// 上から下へ半径 0,1,1,2,1,2,... の円錐。幹の下 2 マスは葉をつけない
	let k = 0;
	for (let y = top + 1; y >= h + 3; y--, k++) {
		const r = k === 0 ? 0 : (k % 2 === 1 ? 1 : 2);
		leafDisc(out, lx, y, lz, r, true);
	}
}

/**
 * chunk (cx, cz) の全ブロックを out に書き込む。
 * index = (y * CS + z) * CS + x (chunk ローカル座標)
 */
export function generateChunk(seed: number, cx: number, cz: number, out: Uint8Array): void {
	const baseX = cx * CS;
	const baseZ = cz * CS;
	out.fill(BLOCK.air);

	// 1. 余白付きで列ごとの高さとバイオームを求める
	for (let mz = 0; mz < SPAN; mz++) {
		for (let mx = 0; mx < SPAN; mx++) {
			const x = baseX + mx - MARGIN;
			const z = baseZ + mz - MARGIN;
			const c = continent(seed, x, z);
			const i = mz * SPAN + mx;
			colH[i] = heightFrom(seed, x, z, c);
			if (c < C_OCEAN) colB[i] = BIOME.ocean;
			else if (c > C_MOUNTAIN) colB[i] = BIOME.mountains;
			else colB[i] = pickBiome(c, temperature(seed, x, z), humidity(seed, x, z));
		}
	}

	// 2. 地形本体
	for (let lz = 0; lz < CS; lz++) {
		for (let lx = 0; lx < CS; lx++) {
			const x = baseX + lx;
			const z = baseZ + lz;
			const ci = (lz + MARGIN) * SPAN + lx + MARGIN;
			const h = colH[ci];
			const biome = colB[ci];
			const beach = h <= WORLD.seaLevel + 1;

			let top: number = BLOCK.grass;
			let sub: number = BLOCK.dirt;
			if (biome === BIOME.ocean || beach) {
				const gravelPatch = valueNoise(seed + 411, x / 14, z / 14) > 0.7;
				top = biome === BIOME.ocean && gravelPatch ? BLOCK.gravel : BLOCK.sand;
				sub = top === BLOCK.gravel ? BLOCK.gravel : BLOCK.sand;
			} else if (biome === BIOME.desert) {
				top = BLOCK.sand;
				sub = BLOCK.sand;
			} else if (biome === BIOME.taiga) {
				top = BLOCK.snow;
			} else if (biome === BIOME.mountains) {
				const j = Math.floor(hash2(seed + 31, x, z) * 5) - 2;
				if (h >= SNOW_LINE + j) {
					top = BLOCK.snow;
					sub = BLOCK.stone;
				} else if (h >= STONE_LINE + j) {
					top = BLOCK.stone;
					sub = BLOCK.stone;
				}
			}

			const stoneTop = h - 4;
			for (let y = 0; y <= h; y++) {
				const idx = (y * CS + lz) * CS + lx;
				if (y === 0) {
					out[idx] = BLOCK.bedrock;
				} else if (y === h) {
					out[idx] = top;
				} else if (y > stoneTop) {
					out[idx] = sub;
				} else {
					let id: number = BLOCK.stone;
					const r = hash2(seed ^ Math.imul(y, 0x9e3779b1), x, z);
					if (r < 0.015 && y < 48) id = BLOCK.coalOre;
					else if (r > 0.992 && y < 28) id = BLOCK.ironOre;
					else if (y > 2 && valueNoise(seed + 503, (x + y * 3) / 7, (z - y * 2) / 7) > 0.8) id = BLOCK.gravel;
					out[idx] = id;
				}
			}
			for (let y = h + 1; y <= WORLD.seaLevel; y++) {
				out[(y * CS + lz) * CS + lx] = BLOCK.water;
			}
		}
	}

	// 3. 地物。余白の列も走査し、隣の chunk の木の葉がこの chunk にはみ出す分を描く
	for (let mz = 0; mz < SPAN; mz++) {
		for (let mx = 0; mx < SPAN; mx++) {
			const i = mz * SPAN + mx;
			const h = colH[i];
			if (h <= WORLD.seaLevel + 1) continue;
			const biome = colB[i];
			const x = baseX + mx - MARGIN;
			const z = baseZ + mz - MARGIN;
			let p = 0;
			if (biome === BIOME.forest) p = 1 / 22;
			else if (biome === BIOME.plains) p = 1 / 150;
			else if (biome === BIOME.taiga) p = 1 / 30;
			if (p === 0) continue;
			const r = hash2(seed + 777, x, z);
			if (r >= p) continue;
			const r2 = hash2(seed + 778, x, z);
			const lx = mx - MARGIN;
			const lz = mz - MARGIN;
			if (biome === BIOME.taiga) drawSpruce(out, lx, lz, h, 6 + Math.floor(r2 * 3));
			else drawOak(out, lx, lz, h, 4 + Math.floor(r2 * 3));
		}
	}

	// サボテン (chunk 内の列だけ。隣接 8 列に候補があれば置かない)
	for (let lz = 0; lz < CS; lz++) {
		for (let lx = 0; lx < CS; lx++) {
			const ci = (lz + MARGIN) * SPAN + lx + MARGIN;
			if (colB[ci] !== BIOME.desert) continue;
			const h = colH[ci];
			if (h <= WORLD.seaLevel + 1) continue;
			const x = baseX + lx;
			const z = baseZ + lz;
			if (hash2(seed + 909, x, z) >= 1 / 120) continue;
			let lonely = true;
			for (let dz = -1; dz <= 1 && lonely; dz++) {
				for (let dx = -1; dx <= 1; dx++) {
					if (dx === 0 && dz === 0) continue;
					if (hash2(seed + 909, x + dx, z + dz) < 1 / 120) {
						lonely = false;
						break;
					}
				}
			}
			if (!lonely) continue;
			const ch = 1 + Math.floor(hash2(seed + 910, x, z) * 3);
			for (let k = 1; k <= ch; k++) {
				const idx = ((h + k) * CS + lz) * CS + lx;
				if (out[idx] === BLOCK.air) out[idx] = BLOCK.cactus;
			}
		}
	}
}
