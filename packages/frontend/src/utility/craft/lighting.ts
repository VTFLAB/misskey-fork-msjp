/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BLOCK_DEFS, WORLD } from './constants.js';

/**
 * chunk 単位の空光と block 光 (どちらも 0..15) の計算。
 *
 * 対象 chunk を中心に 3x3 chunk の窓 (48 x 96 x 48) を作り、窓の中だけで計算して中央の chunk を書き出す。
 * 光は 15 マスで 0 になるので、窓の外から来る光が中央に届くことはなく、結果は窓の外を見ても変わらない。
 *
 * 空光: 列ごとに上から走査し、不透明度の分だけ減らす (空気 0、葉 1、水 2、不透明ブロックで 0)。
 *       そのあと BFS で横と下へ (1 マスごとに -max(1, 不透明度)) 広げ、洞窟や庇の下へ光を入れる。
 * block 光: light > 0 のブロックから同じ BFS で広げる。
 */

const CS = WORLD.chunkSize;
const SY = WORLD.sizeY;
const WIN = CS * 3;

// 窓の添字は (y << 12) | (z << 6) | x。x, z は 0..47 だけを使う
const STRIDE_Y = 4096;
const STRIDE_Z = 64;

const OPACITY = new Uint8Array(256);
const EMIT = new Uint8Array(256);
for (const key of Object.keys(BLOCK_DEFS)) {
	const def = BLOCK_DEFS[Number(key)];
	OPACITY[def.id] = def.opacity;
	EMIT[def.id] = def.light;
}

/** 光を完全に遮る (opacity >= 15) か。未知の id は遮らない */
export function isOpaqueForLight(id: number): boolean {
	return OPACITY[id & 255] >= 15;
}

export function opacityOf(id: number): number {
	return OPACITY[id & 255];
}

export function emissionOf(id: number): number {
	return EMIT[id & 255];
}

const win = {
	op: new Uint8Array(SY * STRIDE_Y),
	sky: new Uint8Array(SY * STRIDE_Y),
	blk: new Uint8Array(SY * STRIDE_Y),
};
const srcList = new Int32Array(1 << 17);
const srcLevel = new Uint8Array(1 << 17);
const QMASK = (1 << 20) - 1;
const queue = new Int32Array(QMASK + 1);
/** 列ごとの「ここから下は空光が 15 でなくなる」y (窓 48x48) */
const colFirstAtten = new Int16Array(WIN * WIN);
/** 列ごとの空光が 0 でない最下段の y */
const colLowestLit = new Int16Array(WIN * WIN);

const DIRS = [1, -1, STRIDE_Z, -STRIDE_Z, STRIDE_Y, -STRIDE_Y];

/** BFS で level を広げる。queue[head..tail) に初期の格子を入れて呼ぶ */
function spread(light: Uint8Array, op: Uint8Array, head: number, tail: number): void {
	while (head !== tail) {
		const idx = queue[head & QMASK];
		head++;
		const level = light[idx];
		if (level <= 1) continue;
		const x = idx & 63;
		const z = (idx >> 6) & 63;
		const y = idx >> 12;
		for (let d = 0; d < 6; d++) {
			switch (d) {
				case 0: if (x >= WIN - 1) continue; break;
				case 1: if (x <= 0) continue; break;
				case 2: if (z >= WIN - 1) continue; break;
				case 3: if (z <= 0) continue; break;
				case 4: if (y >= SY - 1) continue; break;
				default: if (y <= 0) continue;
			}
			const n = idx + DIRS[d];
			const o = op[n];
			if (o >= 15) continue;
			const nl = level - (o > 1 ? o : 1);
			if (nl > light[n]) {
				light[n] = nl;
				if (nl > 1 && tail - head < QMASK) {
					queue[tail & QMASK] = n;
					tail++;
				}
			}
		}
	}
}

/**
 * chunk (cx, cz) の空光と block 光を outSky / outBlock (どちらも 16*96*16、添字は (y*16+z)*16+x) に書く。
 * 周囲 8 chunk のブロックは world.getChunk() で読む (未生成なら生成される)。
 */
export function computeChunkLight(world: { getChunk(cx: number, cz: number): Uint8Array }, cx: number, cz: number, outSky: Uint8Array, outBlock: Uint8Array): void {
	const { op, sky, blk } = win;
	sky.fill(0);
	blk.fill(0);

	// 1. 窓に不透明度を集め、光源を拾う
	let srcCount = 0;
	for (let wcz = 0; wcz < 3; wcz++) {
		for (let wcx = 0; wcx < 3; wcx++) {
			const chunk = world.getChunk(cx + wcx - 1, cz + wcz - 1);
			for (let y = 0; y < SY; y++) {
				for (let lz = 0; lz < CS; lz++) {
					const ci = (y * CS + lz) * CS;
					const wi = (y << 12) | ((wcz * CS + lz) << 6) | (wcx * CS);
					for (let lx = 0; lx < CS; lx++) {
						const id = chunk[ci + lx];
						op[wi + lx] = OPACITY[id];
						if (EMIT[id] > 0 && srcCount < srcList.length) {
							srcList[srcCount] = wi + lx;
							srcLevel[srcCount++] = EMIT[id];
						}
					}
				}
			}
		}
	}

	// 2. 空光の列走査
	for (let wz = 0; wz < WIN; wz++) {
		for (let wx = 0; wx < WIN; wx++) {
			const col = wz * WIN + wx;
			const base = (wz << 6) | wx;
			let level = 15;
			let firstAtten = -1;
			let lowest: number = SY;
			for (let y = SY - 1; y >= 0; y--) {
				const o = op[(y << 12) | base];
				if (o > 0) {
					if (firstAtten < 0) firstAtten = y;
					level -= o;
					if (level <= 0) break;
				}
				sky[(y << 12) | base] = level;
				lowest = y;
			}
			colFirstAtten[col] = firstAtten;
			colLowestLit[col] = lowest;
		}
	}

	// 3. 空光の横方向の種: 隣の列より明るい、光が漏れ出せるマス
	let tail = 0;
	for (let wz = 0; wz < WIN; wz++) {
		for (let wx = 0; wx < WIN; wx++) {
			const col = wz * WIN + wx;
			let top = -1;
			if (wx > 0 && colFirstAtten[col - 1] > top) top = colFirstAtten[col - 1];
			if (wx < WIN - 1 && colFirstAtten[col + 1] > top) top = colFirstAtten[col + 1];
			if (wz > 0 && colFirstAtten[col - WIN] > top) top = colFirstAtten[col - WIN];
			if (wz < WIN - 1 && colFirstAtten[col + WIN] > top) top = colFirstAtten[col + WIN];
			// 隣の列の最上端より上は、隣も空光 15 なので漏れ先がない
			if (top > SY - 1) top = SY - 1;
			const base = (wz << 6) | wx;
			for (let y = top; y >= colLowestLit[col]; y--) {
				const idx = (y << 12) | base;
				const level = sky[idx];
				if (level <= 1) continue;
				const lim = level - 1;
				let leak = false;
				if (wx > 0 && sky[idx - 1] < lim && op[idx - 1] < 15) leak = true;
				else if (wx < WIN - 1 && sky[idx + 1] < lim && op[idx + 1] < 15) leak = true;
				else if (wz > 0 && sky[idx - STRIDE_Z] < lim && op[idx - STRIDE_Z] < 15) leak = true;
				else if (wz < WIN - 1 && sky[idx + STRIDE_Z] < lim && op[idx + STRIDE_Z] < 15) leak = true;
				if (leak && tail < QMASK) queue[tail++] = idx;
			}
		}
	}
	spread(sky, op, 0, tail);

	// 4. block 光
	if (srcCount > 0) {
		tail = 0;
		for (let i = 0; i < srcCount; i++) {
			blk[srcList[i]] = srcLevel[i];
			queue[tail++] = srcList[i];
		}
		spread(blk, op, 0, tail);
	}

	// 5. 中央の chunk を書き出す
	for (let y = 0; y < SY; y++) {
		for (let lz = 0; lz < CS; lz++) {
			const wi = (y << 12) | ((CS + lz) << 6) | CS;
			const oi = (y * CS + lz) * CS;
			for (let lx = 0; lx < CS; lx++) {
				outSky[oi + lx] = sky[wi + lx];
				outBlock[oi + lx] = blk[wi + lx];
			}
		}
	}
}
