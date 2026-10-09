/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ATLAS_CRACK_TILE, ATLAS_TILE_COUNT, BLOCK, BLOCK_DEFS, WORLD, isTransparent } from './constants.js';
import type { BlockDef } from './constants.js';
import { isOpaqueForLight } from './lighting.js';
import type { CraftWorld } from './world.js';

const CS = WORLD.chunkSize;

/**
 * 頂点レイアウト: x, y, z, u, v, sky, block, r, g, b (10 floats)
 * sky / block は 0..1 の光量に面の陰影と AO を掛けたもの。r, g, b は頂点ごとの色の乗数。
 */
export const VERTEX_FLOATS = 10;

export type ChunkMesh = {
	opaque: Float32Array;
	translucent: Float32Array;
};

/** 破壊の進み具合 (0..1) に対応するひび割れのタイル */
export function crackTile(progress: number): number {
	return ATLAS_CRACK_TILE + Math.max(0, Math.min(9, Math.floor(progress * 10)));
}

// 面ごとの 4 頂点 (単位立方体) と法線方向、陰影
// 順: +x, -x, +y, -y, +z, -z。頂点は外から見て反時計回り
const FACES: { dir: [number, number, number]; corners: [number, number, number][]; shade: number; tileIndex: 0 | 1 | 2; axis: number; a1: number; a2: number }[] = [
	{ dir: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.6, tileIndex: 1, axis: 0, a1: 1, a2: 2 },
	{ dir: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.6, tileIndex: 1, axis: 0, a1: 1, a2: 2 },
	{ dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0, tileIndex: 0, axis: 1, a1: 0, a2: 2 },
	{ dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5, tileIndex: 2, axis: 1, a1: 0, a2: 2 },
	{ dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.8, tileIndex: 1, axis: 2, a1: 0, a2: 1 },
	{ dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.8, tileIndex: 1, axis: 2, a1: 0, a2: 1 },
];

const UVS: [number, number][] = [[0, 1], [1, 1], [1, 0], [0, 0]];
const AO_FACTOR = [1.0, 0.8, 0.6, 0.4];

class GrowBuffer {
	public data = new Float32Array(2048 * VERTEX_FLOATS);
	public length = 0;

	public vert(x: number, y: number, z: number, u: number, v: number, sky: number, block: number, r: number, g: number, b: number): void {
		if (this.length + VERTEX_FLOATS > this.data.length) {
			const next = new Float32Array(this.data.length * 2);
			next.set(this.data);
			this.data = next;
		}
		const d = this.data;
		let i = this.length;
		d[i++] = x; d[i++] = y; d[i++] = z; d[i++] = u; d[i++] = v;
		d[i++] = sky; d[i++] = block; d[i++] = r; d[i++] = g; d[i++] = b;
		this.length = i;
	}

	public result(): Float32Array {
		return this.data.slice(0, this.length);
	}
}

// 1 枚の四角形 (4 頂点) の作業用バッファ
const qx = new Float32Array(4);
const qy = new Float32Array(4);
const qz = new Float32Array(4);
const qu = new Float32Array(4);
const qv = new Float32Array(4);
const qs = new Float32Array(4);
const qb = new Float32Array(4);
const qao = new Float32Array(4);

function setQ(i: number, x: number, y: number, z: number, u: number, v: number, sky: number, block: number): void {
	qx[i] = x; qy[i] = y; qz[i] = z; qu[i] = u; qv[i] = v; qs[i] = sky; qb[i] = block;
}

function emitVert(t: GrowBuffer, i: number, r: number, g: number, b: number): void {
	t.vert(qx[i], qy[i], qz[i], qu[i], qv[i], qs[i], qb[i], r, g, b);
}

/** mode 0: 通常、1: 対角線を反転、2: 両面 (裏向きも出す) */
function emitQuad(t: GrowBuffer, mode: number, r: number, g: number, b: number): void {
	if (mode === 1) {
		emitVert(t, 1, r, g, b); emitVert(t, 2, r, g, b); emitVert(t, 3, r, g, b);
		emitVert(t, 1, r, g, b); emitVert(t, 3, r, g, b); emitVert(t, 0, r, g, b);
		return;
	}
	emitVert(t, 0, r, g, b); emitVert(t, 1, r, g, b); emitVert(t, 2, r, g, b);
	emitVert(t, 0, r, g, b); emitVert(t, 2, r, g, b); emitVert(t, 3, r, g, b);
	if (mode === 2) {
		emitVert(t, 0, r, g, b); emitVert(t, 2, r, g, b); emitVert(t, 1, r, g, b);
		emitVert(t, 0, r, g, b); emitVert(t, 3, r, g, b); emitVert(t, 2, r, g, b);
	}
}

/** 立方体の面を描くか。self の面が neighbor に隠れるなら false */
function shouldDrawFace(self: number, neighbor: number): boolean {
	if (neighbor === BLOCK.air) return true;
	if (!isTransparent(neighbor)) return false;
	// 同じ透過ブロック同士 (水と水、ガラスとガラス) の内側の面は描かない
	if (neighbor === self) return false;
	// 水は水以外の透過ブロック (ガラス・氷・葉・十字型) の隣でも面を描く
	return true;
}

type Rect = [number, number, number, number]; // u0, u1, vTop, vBottom (タイル内の 0..1)
const FULL_RECT: Rect = [0, 1, 0, 1];

export function buildChunkMesh(world: CraftWorld, cx: number, cz: number): ChunkMesh | null {
	const chunk = world.getChunk(cx, cz);
	if (chunk == null) return null;
	const baseX = cx * CS;
	const baseZ = cz * CS;
	const opaque = new GrowBuffer();
	const translucent = new GrowBuffer();
	const tileW = 1 / ATLAS_TILE_COUNT;

	// 3x3 chunk のブロックと光
	const chunks: Uint8Array[] = [];
	const lights: Uint8Array[] = [];
	for (let dz = -1; dz <= 1; dz++) {
		for (let dx = -1; dx <= 1; dx++) {
			chunks.push(dx === 0 && dz === 0 ? chunk : world.getChunk(cx + dx, cz + dz));
			lights.push(world.getLight(cx + dx, cz + dz));
		}
	}

	const blockAt = (x: number, y: number, z: number): number => {
		if (y < WORLD.minY) return BLOCK.bedrock;
		if (y > WORLD.maxY) return BLOCK.air;
		const ix = x - baseX + CS;
		const iz = z - baseZ + CS;
		if (ix < 0 || ix >= CS * 3 || iz < 0 || iz >= CS * 3) return BLOCK.air;
		return chunks[(iz >> 4) * 3 + (ix >> 4)][(y * CS + (iz & 15)) * CS + (ix & 15)];
	};

	const lightAt = (x: number, y: number, z: number): number => {
		if (y > WORLD.maxY) return 0xf0;
		if (y < WORLD.minY) return 0;
		const ix = x - baseX + CS;
		const iz = z - baseZ + CS;
		if (ix < 0 || ix >= CS * 3 || iz < 0 || iz >= CS * 3) return 0xf0;
		return lights[(iz >> 4) * 3 + (ix >> 4)][(y * CS + (iz & 15)) * CS + (ix & 15)];
	};

	const opaqueAt = (x: number, y: number, z: number): number => isOpaqueForLight(blockAt(x, y, z)) ? 1 : 0;

	/** 面の色の乗数 (バイオームの色)。tint 対象でなければ 1 */
	let tr = 1;
	let tg = 1;
	let tb = 1;
	const setTint = (id: number, def: BlockDef, fi: number, x: number, z: number): void => {
		tr = 1; tg = 1; tb = 1;
		if (id === BLOCK.leaves || id === BLOCK.tallGrass || (fi === 2 && def.tiles[0] === 0)) {
			const t = world.biomeTintAt(x, z);
			tr = t[0]; tg = t[1]; tb = t[2];
		}
	};

	/** 立方体の 1 面。頂点ごとに AO と、周囲 4 マスの平均の光を求める */
	const cubeFace = (target: GrowBuffer, id: number, def: BlockDef, fi: number, x: number, y: number, z: number, lowerTop: boolean): void => {
		const face = FACES[fi];
		const tile = def.tiles[face.tileIndex];
		const u0 = tile * tileW;
		const fx = x + face.dir[0];
		const fy = y + face.dir[1];
		const fz = z + face.dir[2];
		const useAo = !def.translucent;
		const emit = def.light / 15;
		const a1 = face.a1;
		const a2 = face.a2;
		for (let i = 0; i < 4; i++) {
			const c = face.corners[i];
			const o1 = c[a1] === 1 ? 1 : -1;
			const o2 = c[a2] === 1 ? 1 : -1;
			const s1x = fx + (a1 === 0 ? o1 : 0);
			const s1y = fy + (a1 === 1 ? o1 : 0);
			const s1z = fz + (a1 === 2 ? o1 : 0);
			const s2x = fx + (a2 === 0 ? o2 : 0);
			const s2y = fy + (a2 === 1 ? o2 : 0);
			const s2z = fz + (a2 === 2 ? o2 : 0);
			const kx = s1x + s2x - fx;
			const ky = s1y + s2y - fy;
			const kz = s1z + s2z - fz;
			const side1 = opaqueAt(s1x, s1y, s1z);
			const side2 = opaqueAt(s2x, s2y, s2z);
			const corner = side1 && side2 ? 1 : opaqueAt(kx, ky, kz);
			const ao = useAo ? (side1 && side2 ? 3 : side1 + side2 + corner) : 0;
			// 光: 面の前のマスと、不透明でない隣 3 マスの平均
			const lf = lightAt(fx, fy, fz);
			let sSky = lf >> 4;
			let sBlk = lf & 15;
			let n = 1;
			if (!side1) { const l = lightAt(s1x, s1y, s1z); sSky += l >> 4; sBlk += l & 15; n++; }
			if (!side2) { const l = lightAt(s2x, s2y, s2z); sSky += l >> 4; sBlk += l & 15; n++; }
			if (!(side1 && side2) && !corner) { const l = lightAt(kx, ky, kz); sSky += l >> 4; sBlk += l & 15; n++; }
			const f = face.shade * AO_FACTOR[ao];
			let blockV = sBlk / n / 15 * f;
			if (emit > 0 && blockV < emit) blockV = emit;
			const uu = u0 + UVS[i][0] * tileW;
			const yy = y + c[1] + (lowerTop && c[1] === 1 ? -0.125 : 0);
			setQ(i, x + c[0], yy, z + c[2], uu, UVS[i][1], sSky / n / 15 * f, blockV);
			qao[i] = AO_FACTOR[ao];
		}
		setTint(id, def, fi, x, z);
		// 明るい対角線で分ける (AO の異方性対策)
		const flip = qao[0] + qao[2] < qao[1] + qao[3] ? 1 : 0;
		emitQuad(target, flip, tr, tg, tb);
	};

	/** 光を 1 マスから読んで、面の陰影を掛けた (sky, block) をセットする */
	let flatSky = 0;
	let flatBlk = 0;
	const flatLight = (def: BlockDef, lx: number, ly: number, lz: number, shade: number): void => {
		const l = lightAt(lx, ly, lz);
		flatSky = (l >> 4) / 15 * shade;
		flatBlk = (l & 15) / 15 * shade;
		const emit = def.light / 15;
		if (flatBlk < emit) flatBlk = emit;
	};

	/** 軸平行の箱。各面は faceRect (タイル内の範囲) で貼る。inner なら面の光は箱自身のマスから取る */
	const box = (
		target: GrowBuffer, def: BlockDef, x: number, y: number, z: number,
		x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
		sideRect: Rect, capRect: Rect, inner: boolean, skipBottom: boolean, cullByNeighbor: boolean,
	): void => {
		for (let fi = 0; fi < 6; fi++) {
			if (fi === 3 && skipBottom) continue;
			const face = FACES[fi];
			const nx = x + face.dir[0];
			const ny = y + face.dir[1];
			const nz = z + face.dir[2];
			if (cullByNeighbor) {
				if (ny < WORLD.minY) continue;
				// 箱の面がマスの境界にあるときだけ隣で隠れる
				const onEdge = fi === 2 ? y1 >= 1 : fi === 3 ? y0 <= 0 : true;
				if (onEdge && !isTransparent(blockAt(nx, ny, nz))) continue;
			}
			const rect = fi === 2 || fi === 3 ? capRect : sideRect;
			const u0 = def.tiles[face.tileIndex] * tileW;
			if (inner) flatLight(def, x, y, z, face.shade);
			else flatLight(def, nx, ny, nz, face.shade);
			for (let i = 0; i < 4; i++) {
				const c = face.corners[i];
				const uu = u0 + (rect[0] + UVS[i][0] * (rect[1] - rect[0])) * tileW;
				const vv = rect[2] + UVS[i][1] * (rect[3] - rect[2]);
				setQ(i, c[0] === 1 ? x + x1 : x + x0, c[1] === 1 ? y + y1 : y + y0, c[2] === 1 ? z + z1 : z + z0, uu, vv, flatSky, flatBlk);
			}
			emitQuad(target, 0, 1, 1, 1);
		}
	};

	/** 立っている四角形 (両面)。4 隅は UVS の順 (左下, 右下, 右上, 左上) */
	const standingQuad = (
		target: GrowBuffer, def: BlockDef, ax: number, az: number, bx: number, bz: number, y0: number, y1: number,
		u0: number, light: number, tr2: number, tg2: number, tb2: number,
	): void => {
		const sky = (light >> 4) / 15;
		let blk = (light & 15) / 15;
		const emit = def.light / 15;
		if (blk < emit) blk = emit;
		setQ(0, ax, y0, az, u0, 1, sky, blk);
		setQ(1, bx, y0, bz, u0 + tileW, 1, sky, blk);
		setQ(2, bx, y1, bz, u0 + tileW, 0, sky, blk);
		setQ(3, ax, y1, az, u0, 0, sky, blk);
		emitQuad(target, 2, tr2, tg2, tb2);
	};

	for (let y = 0; y < WORLD.sizeY; y++) {
		for (let lz = 0; lz < CS; lz++) {
			for (let lx = 0; lx < CS; lx++) {
				const id = chunk[(y * CS + lz) * CS + lx];
				if (id === BLOCK.air) continue;
				const def = BLOCK_DEFS[id];
				if (def == null) continue;
				const x = baseX + lx;
				const z = baseZ + lz;
				const target = def.translucent ? translucent : opaque;

				switch (def.shape) {
					case 'cube': {
						const lowerTop = id === BLOCK.water && blockAt(x, y + 1, z) !== BLOCK.water;
						for (let fi = 0; fi < 6; fi++) {
							const face = FACES[fi];
							const ny = y + face.dir[1];
							if (ny < WORLD.minY) continue; // 底面は描かない
							const neighbor = blockAt(x + face.dir[0], ny, z + face.dir[2]);
							if (!shouldDrawFace(id, neighbor)) continue;
							cubeFace(target, id, def, fi, x, y, z, lowerTop);
						}
						break;
					}
					case 'cross': {
						const light = lightAt(x, y, z);
						setTint(id, def, 1, x, z);
						const u0 = def.tiles[0] * tileW;
						standingQuad(target, def, x + 0.1, z + 0.1, x + 0.9, z + 0.9, y, y + 1, u0, light, tr, tg, tb);
						standingQuad(target, def, x + 0.9, z + 0.1, x + 0.1, z + 0.9, y, y + 1, u0, light, tr, tg, tb);
						break;
					}
					case 'torch': {
						const u0 = 7 / 16;
						const u1 = 9 / 16;
						// 4 側面は柱の下 10/16、上面は先端の 2x2
						box(target, def, x, y, z, 7 / 16, 0, 7 / 16, 9 / 16, 10 / 16, 9 / 16, [u0, u1, 6 / 16, 1], [u0, u1, 6 / 16, 8 / 16], true, true, false);
						break;
					}
					case 'ladder': {
						let wx = 0;
						let wz = -1;
						const around: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
						for (const [dx, dz] of around) {
							const nd = BLOCK_DEFS[blockAt(x + dx, y, z + dz)];
							if (nd != null && nd.solid && !nd.transparent) {
								wx = dx;
								wz = dz;
								break;
							}
						}
						const light = lightAt(x, y, z);
						const u0 = def.tiles[0] * tileW;
						const e = 0.02;
						if (wx !== 0) {
							const px = wx > 0 ? x + 1 - e : x + e;
							standingQuad(target, def, px, z, px, z + 1, y, y + 1, u0, light, 1, 1, 1);
						} else {
							const pz = wz > 0 ? z + 1 - e : z + e;
							standingQuad(target, def, x, pz, x + 1, pz, y, y + 1, u0, light, 1, 1, 1);
						}
						break;
					}
					case 'bed':
					case 'farmland': {
						const h = def.shape === 'bed' ? 9 / 16 : 15 / 16;
						box(target, def, x, y, z, 0, 0, 0, 1, h, 1, [0, 1, 1 - h, 1], FULL_RECT, false, false, true);
						break;
					}
				}
			}
		}
	}

	return { opaque: opaque.result(), translucent: translucent.result() };
}
