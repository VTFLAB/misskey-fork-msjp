/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BLOCK, WORLD } from './constants.js';
import { fillColumn, treeBlocks } from './terrain.js';

const CS = WORLD.chunkSize;
const CH = WORLD.sizeY;

/**
 * ワールド全体のブロック格納。chunk (16 x 64 x 16) の Uint8Array を遅延生成する。
 * index = (y * CS + z) * CS + x (chunk ローカル座標)
 */
export class CraftWorld {
	private chunks = new Map<string, Uint8Array>();
	/** 再メッシュが必要な chunk の key */
	public dirty = new Set<string>();

	constructor(public readonly seed: number) {
	}

	public static chunkKey(cx: number, cz: number): string {
		return `${cx},${cz}`;
	}

	public static toChunk(v: number): number {
		return Math.floor(v / CS);
	}

	public inBounds(x: number, y: number, z: number): boolean {
		return x >= WORLD.minX && x <= WORLD.maxX && y >= WORLD.minY && y <= WORLD.maxY && z >= WORLD.minZ && z <= WORLD.maxZ;
	}

	public getChunk(cx: number, cz: number): Uint8Array | null {
		if (cx < WORLD.minX / CS || cx > WORLD.maxX / CS || cz < WORLD.minZ / CS || cz > WORLD.maxZ / CS) return null;
		const key = CraftWorld.chunkKey(cx, cz);
		let chunk = this.chunks.get(key);
		if (chunk == null) {
			chunk = this.generateChunk(cx, cz);
			this.chunks.set(key, chunk);
		}
		return chunk;
	}

	private generateChunk(cx: number, cz: number): Uint8Array {
		const data = new Uint8Array(CS * CS * CH);
		const baseX = cx * CS;
		const baseZ = cz * CS;
		for (let lz = 0; lz < CS; lz++) {
			for (let lx = 0; lx < CS; lx++) {
				fillColumn(this.seed, baseX + lx, baseZ + lz, data, CS * CS, lz * CS + lx);
			}
		}
		// 木は chunk 境界をまたぐので、周囲 2 マスの柱も見る
		for (let lz = -2; lz < CS + 2; lz++) {
			for (let lx = -2; lx < CS + 2; lx++) {
				const blocks = treeBlocks(this.seed, baseX + lx, baseZ + lz);
				for (const b of blocks) {
					const bx = b.x - baseX;
					const bz = b.z - baseZ;
					if (bx < 0 || bx >= CS || bz < 0 || bz >= CS || b.y < 0 || b.y >= CH) continue;
					const i = (b.y * CS + bz) * CS + bx;
					if (data[i] === BLOCK.air || (data[i] === BLOCK.leaves && b.id === BLOCK.log)) data[i] = b.id;
				}
			}
		}
		return data;
	}

	public getBlock(x: number, y: number, z: number): number {
		if (!this.inBounds(x, y, z)) return BLOCK.air;
		const chunk = this.getChunk(CraftWorld.toChunk(x), CraftWorld.toChunk(z));
		if (chunk == null) return BLOCK.air;
		const lx = x - CraftWorld.toChunk(x) * CS;
		const lz = z - CraftWorld.toChunk(z) * CS;
		return chunk[(y * CS + lz) * CS + lx];
	}

	/**
	 * @returns 変化があれば true
	 */
	public setBlock(x: number, y: number, z: number, id: number): boolean {
		if (!this.inBounds(x, y, z)) return false;
		const cx = CraftWorld.toChunk(x);
		const cz = CraftWorld.toChunk(z);
		const chunk = this.getChunk(cx, cz);
		if (chunk == null) return false;
		const lx = x - cx * CS;
		const lz = z - cz * CS;
		const i = (y * CS + lz) * CS + lx;
		if (chunk[i] === id) return false;
		chunk[i] = id;
		this.dirty.add(CraftWorld.chunkKey(cx, cz));
		if (lx === 0) this.dirty.add(CraftWorld.chunkKey(cx - 1, cz));
		if (lx === CS - 1) this.dirty.add(CraftWorld.chunkKey(cx + 1, cz));
		if (lz === 0) this.dirty.add(CraftWorld.chunkKey(cx, cz - 1));
		if (lz === CS - 1) this.dirty.add(CraftWorld.chunkKey(cx, cz + 1));
		return true;
	}

	/** サーバーの差分 [x, y, z, type, ...] をまとめて適用する */
	public applyFlat(flat: number[]): void {
		for (let i = 0; i + 3 < flat.length; i += 4) {
			this.setBlock(flat[i], flat[i + 1], flat[i + 2], flat[i + 3]);
		}
	}

	/** (x, z) の地表の 1 つ上の y (スポーン位置用) */
	public surfaceY(x: number, z: number): number {
		for (let y = WORLD.maxY; y >= WORLD.minY; y--) {
			const id = this.getBlock(x, y, z);
			if (id !== BLOCK.air && id !== BLOCK.water) return y + 1;
		}
		return WORLD.seaLevel + 1;
	}
}
