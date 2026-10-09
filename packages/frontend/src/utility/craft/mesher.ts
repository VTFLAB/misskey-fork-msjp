/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ATLAS_TILE_COUNT, BLOCK, BLOCK_DEFS, WORLD, isTransparent } from './constants.js';
import type { CraftWorld } from './world.js';

const CS = WORLD.chunkSize;

/**
 * 頂点レイアウト: x, y, z, u, v, light (6 floats)
 */
export const VERTEX_FLOATS = 6;

export type ChunkMesh = {
	opaque: Float32Array;
	translucent: Float32Array;
};

// 面ごとの 4 頂点 (単位立方体) と法線方向、陰影
// 順: +x, -x, +y, -y, +z, -z
const FACES: { dir: [number, number, number]; corners: [number, number, number][]; shade: number; tileIndex: 0 | 1 | 2 }[] = [
	{ dir: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.8, tileIndex: 1 },
	{ dir: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.8, tileIndex: 1 },
	{ dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0, tileIndex: 0 },
	{ dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5, tileIndex: 2 },
	{ dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.7, tileIndex: 1 },
	{ dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.7, tileIndex: 1 },
];

const UVS: [number, number][] = [[0, 1], [1, 1], [1, 0], [0, 0]];

class GrowBuffer {
	public data = new Float32Array(1024 * VERTEX_FLOATS);
	public length = 0;

	public push(...values: number[]) {
		if (this.length + values.length > this.data.length) {
			const next = new Float32Array(this.data.length * 2);
			next.set(this.data);
			this.data = next;
		}
		for (const v of values) this.data[this.length++] = v;
	}

	public result(): Float32Array {
		return this.data.slice(0, this.length);
	}
}

function shouldDrawFace(self: number, neighbor: number): boolean {
	if (neighbor === BLOCK.air) return true;
	if (!isTransparent(neighbor)) return false;
	// 同じ透過ブロック同士 (水と水、ガラスとガラス) の内側の面は描かない
	if (neighbor === self) return false;
	// 葉は隣が何であれ描く
	return true;
}

/** 光を放つブロックの light 値。シェーダーはこの値を昼夜の減衰なしの全明るさとして扱う */
export const EMISSIVE_LIGHT = 2.0;

export function buildChunkMesh(world: CraftWorld, cx: number, cz: number): ChunkMesh | null {
	const chunk = world.getChunk(cx, cz);
	if (chunk == null) return null;
	const baseX = cx * CS;
	const baseZ = cz * CS;
	const opaque = new GrowBuffer();
	const translucent = new GrowBuffer();
	const tileW = 1 / ATLAS_TILE_COUNT;

	// 自 chunk 内は配列を直接読み、外側 (隣の chunk と高さの範囲外) だけ world 経由にする
	const blockAt = (x: number, y: number, z: number): number => {
		if (y < WORLD.minY || y > WORLD.maxY) return BLOCK.air;
		const lx = x - baseX;
		const lz = z - baseZ;
		if (lx >= 0 && lx < CS && lz >= 0 && lz < CS) return chunk[(y * CS + lz) * CS + lx];
		return world.getBlock(x, y, z);
	};

	// 空の上にある列ほど明るく、埋まった場所は少し暗くする簡易の環境光
	const skyLight = (x: number, y: number, z: number): number => {
		let covered = 0;
		for (let yy = y + 1; yy <= Math.min(WORLD.maxY, y + 12); yy++) {
			const id = blockAt(x, yy, z);
			if (id !== BLOCK.air && id !== BLOCK.water && id !== BLOCK.glass) {
				covered++;
				if (covered >= 3) break;
			}
		}
		return 1 - covered * 0.12;
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
				const emissive = def.emissive;
				for (const face of FACES) {
					const nx = x + face.dir[0];
					const ny = y + face.dir[1];
					const nz = z + face.dir[2];
					if (ny < WORLD.minY) continue; // 底面は描かない
					const neighbor = blockAt(nx, ny, nz);
					if (!shouldDrawFace(id, neighbor)) continue;
					const tile = def.tiles[face.tileIndex];
					const u0 = tile * tileW;
					const light = emissive ? EMISSIVE_LIGHT : face.shade * (face.dir[1] === 1 ? skyLight(x, y, z) : skyLight(nx, ny, nz));
					// 水面は少し下げる
					const topOffset = (id === BLOCK.water && face.dir[1] === 1) ? -0.125 : 0;
					const c = face.corners;
					const v = (i: number) => {
						const [ox, oy, oz] = c[i];
						const [u, vv] = UVS[i];
						target.push(x + ox, y + oy + (oy === 1 ? topOffset : 0), z + oz, u0 + u * tileW, vv, light);
					};
					v(0); v(1); v(2);
					v(0); v(2); v(3);
				}
			}
		}
	}

	return { opaque: opaque.result(), translucent: translucent.result() };
}
