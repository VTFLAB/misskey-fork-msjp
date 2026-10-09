/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BIOME_DEFS, BLOCK, BLOCK_DEFS, WORLD } from './constants.js';
import type { BiomeId } from './constants.js';
import { computeChunkLight, emissionOf, isOpaqueForLight, opacityOf } from './lighting.js';
import { biomeAt, generateChunk, terrainHeight } from './terrain.js';

const CS = WORLD.chunkSize;
const CH = WORLD.sizeY;

/**
 * 無限ワールドのブロック格納。chunk (16 x 96 x 16) の Uint8Array を必要時に生成する。
 * 編集 (サーバーの差分と自分の操作) は `edits` に座標ごとに持ち、chunk を破棄しても
 * 再生成時に適用し直せる。
 * index = (y * CS + z) * CS + x (chunk ローカル座標)
 */
export class CraftWorld {
	private chunks = new Map<string, Uint8Array>();
	/** 生成地形からの差分 (key "x,y,z" → type) */
	public edits = new Map<string, number>();
	/** 再メッシュが必要な chunk の key */
	public dirty = new Set<string>();

	/** chunk key → 光 (上位 4 bit が空光、下位 4 bit が block 光)。添字は chunk と同じ */
	private lightCache = new Map<string, Uint8Array>();
	/** 再計算が必要な光の key。lightCache に値が残っていても、ensureLight まで古い値を返す */
	private lightDirty = new Set<string>();
	private memoLightCx = Number.NaN;
	private memoLightCz = Number.NaN;
	private memoLight: Uint8Array | null = null;
	/** chunk key → 列ごとのバイオーム (255 は未計算) */
	private biomeCache = new Map<string, Uint8Array>();
	private scratchSky = new Uint8Array(WORLD.chunkSize * WORLD.chunkSize * WORLD.sizeY);
	private scratchBlock = new Uint8Array(WORLD.chunkSize * WORLD.chunkSize * WORLD.sizeY);

	constructor(public readonly seed: number) {
	}

	public static chunkKey(cx: number, cz: number): string {
		return `${cx},${cz}`;
	}

	public static blockKey(x: number, y: number, z: number): string {
		return `${x},${y},${z}`;
	}

	public static toChunk(v: number): number {
		return Math.floor(v / CS);
	}

	public inBounds(x: number, y: number, z: number): boolean {
		return Math.abs(x) <= WORLD.maxCoord && Math.abs(z) <= WORLD.maxCoord && y >= WORLD.minY && y <= WORLD.maxY;
	}

	public hasChunk(cx: number, cz: number): boolean {
		return this.chunks.has(CraftWorld.chunkKey(cx, cz));
	}

	public getChunk(cx: number, cz: number): Uint8Array {
		const key = CraftWorld.chunkKey(cx, cz);
		let chunk = this.chunks.get(key);
		if (chunk == null) {
			chunk = new Uint8Array(CS * CS * CH);
			generateChunk(this.seed, cx, cz, chunk);
			this.applyEditsToChunk(cx, cz, chunk);
			this.chunks.set(key, chunk);
		}
		return chunk;
	}

	private applyEditsToChunk(cx: number, cz: number, chunk: Uint8Array): void {
		// 編集は全体で最大 20 万件。chunk 生成のたびに全走査すると重いので、chunk ごとの索引を持つ
		const map = this.editsByChunk.get(CraftWorld.chunkKey(cx, cz));
		if (map == null) return;
		for (const [index, id] of map) chunk[index] = id;
	}

	/** chunk key → (chunk 内 index → type) */
	private editsByChunk = new Map<string, Map<number, number>>();

	private indexEdit(x: number, y: number, z: number, id: number): void {
		const cx = CraftWorld.toChunk(x);
		const cz = CraftWorld.toChunk(z);
		const key = CraftWorld.chunkKey(cx, cz);
		let map = this.editsByChunk.get(key);
		if (map == null) {
			map = new Map();
			this.editsByChunk.set(key, map);
		}
		map.set((y * CS + (z - cz * CS)) * CS + (x - cx * CS), id);
	}

	public getBlock(x: number, y: number, z: number): number {
		if (!this.inBounds(x, y, z)) return BLOCK.air;
		const cx = CraftWorld.toChunk(x);
		const cz = CraftWorld.toChunk(z);
		const chunk = this.getChunk(cx, cz);
		return chunk[(y * CS + (z - cz * CS)) * CS + (x - cx * CS)];
	}

	/** 生成済み chunk にあるブロックだけ返す (未生成なら null)。描画や MOB の軽い判定用 */
	public peekBlock(x: number, y: number, z: number): number | null {
		if (!this.inBounds(x, y, z)) return BLOCK.air;
		const cx = CraftWorld.toChunk(x);
		const cz = CraftWorld.toChunk(z);
		const chunk = this.chunks.get(CraftWorld.chunkKey(cx, cz));
		if (chunk == null) return null;
		return chunk[(y * CS + (z - cz * CS)) * CS + (x - cx * CS)];
	}

	/**
	 * ブロックを書き換え、編集として記録する。
	 * @returns 変化があれば true
	 */
	public setBlock(x: number, y: number, z: number, id: number): boolean {
		if (!this.inBounds(x, y, z)) return false;
		this.edits.set(CraftWorld.blockKey(x, y, z), id);
		this.indexEdit(x, y, z, id);
		const cx = CraftWorld.toChunk(x);
		const cz = CraftWorld.toChunk(z);
		const chunk = this.chunks.get(CraftWorld.chunkKey(cx, cz));
		if (chunk == null) {
			// 未生成の chunk は生成時に反映される。破棄済みの chunk なら、周りの光の計算結果が古くなりうる
			if (this.lightCache.size > 0) this.markLightDirty(x, z);
			return true;
		}
		const lx = x - cx * CS;
		const lz = z - cz * CS;
		const i = (y * CS + lz) * CS + lx;
		const old = chunk[i];
		if (old === id) return false;
		chunk[i] = id;
		this.markDirty(cx, cz, lx, lz);
		if (opacityOf(old) !== opacityOf(id) || emissionOf(old) !== emissionOf(id)) this.markLightDirty(x, z);
		return true;
	}

	/** (x, z) のブロックの光の変化が届く範囲 (15 マス) の chunk で、光を再計算し、メッシュも作り直す */
	private markLightDirty(x: number, z: number): void {
		const cx0 = CraftWorld.toChunk(x - 15);
		const cx1 = CraftWorld.toChunk(x + 15);
		const cz0 = CraftWorld.toChunk(z - 15);
		const cz1 = CraftWorld.toChunk(z + 15);
		for (let cz = cz0; cz <= cz1; cz++) {
			for (let cx = cx0; cx <= cx1; cx++) {
				const key = CraftWorld.chunkKey(cx, cz);
				if (!this.lightCache.has(key)) continue;
				this.lightDirty.add(key);
				this.dirty.add(key);
			}
		}
	}

	/**
	 * chunk の光を (必要なら) 計算して返す。上位 4 bit が空光、下位 4 bit が block 光。
	 * 周囲 8 chunk のブロックが必要なので、未生成なら生成する。
	 */
	public getLight(cx: number, cz: number): Uint8Array {
		const key = CraftWorld.chunkKey(cx, cz);
		let arr = this.lightCache.get(key);
		if (arr != null && !this.lightDirty.has(key)) return arr;
		const fresh = arr == null;
		if (arr == null) arr = new Uint8Array(CS * CS * CH);
		computeChunkLight(this, cx, cz, this.scratchSky, this.scratchBlock);
		const sky = this.scratchSky;
		const blk = this.scratchBlock;
		for (let i = 0; i < arr.length; i++) arr[i] = (sky[i] << 4) | blk[i];
		if (fresh) {
			this.lightCache.set(key, arr);
			this.memoLightCx = Number.NaN;
		}
		this.lightDirty.delete(key);
		return arr;
	}

	/** メッシュを作る前に呼ぶ。光が未計算か古ければ計算する */
	public ensureLight(cx: number, cz: number): void {
		this.getLight(cx, cz);
	}

	private lightArrayIfCached(cx: number, cz: number): Uint8Array | null {
		if (cx === this.memoLightCx && cz === this.memoLightCz) return this.memoLight;
		const arr = this.lightCache.get(CraftWorld.chunkKey(cx, cz)) ?? null;
		this.memoLightCx = cx;
		this.memoLightCz = cz;
		this.memoLight = arr;
		return arr;
	}

	/**
	 * (空光 << 4) | block 光。キャッシュを読むだけで計算はしない (古い値を返すことがある)。
	 * 光が未計算の chunk と範囲外は空光 15、block 光 0。
	 */
	public lightAt(x: number, y: number, z: number): number {
		if (y > WORLD.maxY) return 0xf0;
		if (y < WORLD.minY) return 0;
		const cx = CraftWorld.toChunk(x);
		const cz = CraftWorld.toChunk(z);
		const arr = this.lightArrayIfCached(cx, cz);
		if (arr == null) return 0xf0;
		return arr[(y * CS + (z - cz * CS)) * CS + (x - cx * CS)];
	}

	public skyLightAt(x: number, y: number, z: number): number {
		return this.lightAt(x, y, z) >> 4;
	}

	public blockLightAt(x: number, y: number, z: number): number {
		return this.lightAt(x, y, z) & 15;
	}

	/** 光を完全に遮る (opacity >= 15) ブロックか */
	public isOpaqueForLight(id: number): boolean {
		return isOpaqueForLight(id);
	}

	/** (x, z) の草・葉の色合い (BIOME_DEFS の grassTint) */
	public biomeTintAt(x: number, z: number): [number, number, number] {
		const cx = CraftWorld.toChunk(x);
		const cz = CraftWorld.toChunk(z);
		const key = CraftWorld.chunkKey(cx, cz);
		let cols = this.biomeCache.get(key);
		if (cols == null) {
			cols = new Uint8Array(CS * CS).fill(255);
			this.biomeCache.set(key, cols);
		}
		const i = (z - cz * CS) * CS + (x - cx * CS);
		let b = cols[i];
		if (b === 255) {
			b = biomeAt(this.seed, x, z);
			cols[i] = b;
		}
		return BIOME_DEFS[b].grassTint;
	}

	private markDirty(cx: number, cz: number, lx: number, lz: number): void {
		this.dirty.add(CraftWorld.chunkKey(cx, cz));
		if (lx === 0) this.dirty.add(CraftWorld.chunkKey(cx - 1, cz));
		if (lx === CS - 1) this.dirty.add(CraftWorld.chunkKey(cx + 1, cz));
		if (lz === 0) this.dirty.add(CraftWorld.chunkKey(cx, cz - 1));
		if (lz === CS - 1) this.dirty.add(CraftWorld.chunkKey(cx, cz + 1));
	}

	/** サーバーの差分 [x, y, z, type, ...] をまとめて適用する */
	public applyFlat(flat: number[]): void {
		for (let i = 0; i + 3 < flat.length; i += 4) {
			const id = flat[i + 3];
			// このクライアントが知らない id は空気として扱う
			this.setBlock(flat[i], flat[i + 1], flat[i + 2], id !== BLOCK.air && BLOCK_DEFS[id] == null ? BLOCK.air : id);
		}
	}

	/** 遠い chunk のブロックデータを破棄する (編集は edits に残る)。破棄した chunk の key を返す */
	public evictFar(cx: number, cz: number, keepDistance = WORLD.keepDistance): string[] {
		const removed: string[] = [];
		for (const key of this.chunks.keys()) {
			const [kx, kz] = key.split(',').map(Number);
			if (Math.abs(kx - cx) > keepDistance || Math.abs(kz - cz) > keepDistance) {
				this.chunks.delete(key);
				this.dirty.delete(key);
				this.lightCache.delete(key);
				this.lightDirty.delete(key);
				this.biomeCache.delete(key);
				removed.push(key);
			}
		}
		this.memoLightCx = Number.NaN;
		return removed;
	}

	public get loadedChunkCount(): number {
		return this.chunks.size;
	}

	/** (x, z) の地表 (空気でも水でもない一番上のブロック) の 1 つ上の y */
	public surfaceY(x: number, z: number): number {
		for (let y = WORLD.maxY; y >= WORLD.minY; y--) {
			const id = this.getBlock(x, y, z);
			if (id !== BLOCK.air && id !== BLOCK.water) return y + 1;
		}
		return WORLD.seaLevel + 1;
	}

	/** 生成地形の高さ (編集を含まない、ミニマップ・湧き判定用) */
	public terrainHeightAt(x: number, z: number): number {
		return terrainHeight(this.seed, x, z);
	}

	public biomeAt(x: number, z: number): BiomeId {
		return biomeAt(this.seed, x, z);
	}

	/** 原点付近で、水に浸かっておらず頭上が空いている柱を探す */
	public findSpawn(): { x: number; z: number } {
		for (let r = 0; r <= 96; r += 4) {
			for (let dz = -r; dz <= r; dz += 4) {
				for (let dx = -r; dx <= r; dx += 4) {
					if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
					const y = this.surfaceY(dx, dz);
					if (y <= WORLD.seaLevel) continue;
					if (this.getBlock(dx, y, dz) === BLOCK.air && this.getBlock(dx, y + 1, dz) === BLOCK.air) {
						return { x: dx, z: dz };
					}
				}
			}
		}
		return { x: 0, z: 0 };
	}
}
