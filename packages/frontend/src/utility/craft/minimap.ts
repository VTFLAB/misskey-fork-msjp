/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * ミニマップ。北 (-z) を上にした円形の俯瞰図を 2D canvas に描く。
 * chunk ごとに 16x16 のタイルをキャッシュし、1 回の render で作るタイルは数を絞る。
 */

import { BIOME_DEFS, BLOCK, BLOCK_DEFS, MOB_DEFS, WORLD } from './constants.js';
import { CraftWorld } from './world.js';
import type { MobType } from './constants.js';

const CS = WORLD.chunkSize;
const MAX_BUILD_PER_RENDER = 6;
const MAX_CANVAS_PX = 512;
const DEFAULT_RADIUS = 48;
const SHADE_RANGE = 0.15;

type Rgb = [number, number, number];

type Tile = {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	/** 実ブロックから作ったタイルなら true。false はバイオーム色の仮タイル */
	built: boolean;
};

const rgbCache = new Map<string, Rgb>();

function parseColor(hex: string): Rgb {
	let c = rgbCache.get(hex);
	if (c == null) {
		const n = parseInt(hex.slice(1), 16);
		c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
		rgbCache.set(hex, c);
	}
	return c;
}

function clamp255(v: number): number {
	return v < 0 ? 0 : v > 255 ? 255 : v;
}

export class Minimap {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D | null;
	private world: CraftWorld;
	private tiles = new Map<string, Tile>();
	/** 高さ計算用の使い回しバッファ。(CS + 1) 行 x CS 列。0 行目が北隣 */
	private heights = new Int16Array((CS + 1) * CS);
	private image: ImageData | null = null;

	constructor(canvas: HTMLCanvasElement, world: CraftWorld) {
		this.canvas = canvas;
		this.world = world;
		this.ctx = canvas.getContext('2d');
	}

	public invalidate(chunkKey: string): void {
		this.tiles.delete(chunkKey);
	}

	public dispose(): void {
		this.tiles.clear();
		this.image = null;
	}

	public render(opts: {
		x: number; z: number; yaw: number;
		radius?: number;
		players: { x: number; z: number; color: string }[];
		mobs: { x: number; z: number; type: MobType }[];
		daylight: number;
	}): void {
		const ctx = this.ctx;
		if (ctx == null) return;

		const dpr = window.devicePixelRatio || 1;
		const size = Math.max(16, Math.min(MAX_CANVAS_PX, Math.round(this.canvas.clientWidth * dpr)));
		if (this.canvas.width !== size || this.canvas.height !== size) {
			this.canvas.width = size;
			this.canvas.height = size;
		}

		const radius = opts.radius ?? DEFAULT_RADIUS;
		const half = size / 2;
		const scale = half / radius; // px / block
		const px = opts.x;
		const pz = opts.z;

		ctx.save();
		ctx.clearRect(0, 0, size, size);
		ctx.beginPath();
		ctx.arc(half, half, half - 1, 0, Math.PI * 2);
		ctx.clip();
		ctx.fillStyle = '#101820';
		ctx.fillRect(0, 0, size, size);
		ctx.imageSmoothingEnabled = false;

		// 近い chunk から順にタイルを作る (予算内)
		const minCx = CraftWorld.toChunk(Math.floor(px - radius));
		const maxCx = CraftWorld.toChunk(Math.floor(px + radius));
		const minCz = CraftWorld.toChunk(Math.floor(pz - radius));
		const maxCz = CraftWorld.toChunk(Math.floor(pz + radius));
		const pcx = px / CS - 0.5;
		const pcz = pz / CS - 0.5;
		const wanted: { cx: number; cz: number; d: number }[] = [];
		for (let cz = minCz; cz <= maxCz; cz++) {
			for (let cx = minCx; cx <= maxCx; cx++) {
				wanted.push({ cx, cz, d: (cx - pcx) ** 2 + (cz - pcz) ** 2 });
			}
		}
		wanted.sort((a, b) => a.d - b.d);

		let budget = MAX_BUILD_PER_RENDER;
		for (const { cx, cz } of wanted) {
			const key = CraftWorld.chunkKey(cx, cz);
			let tile = this.tiles.get(key);
			const generated = this.world.hasChunk(cx, cz);
			if (tile == null || (!tile.built && generated)) {
				if (budget > 0) {
					budget--;
					tile = this.buildTile(key, cx, cz, generated);
				}
			}
			const x0 = Math.floor(half + (cx * CS - px) * scale);
			const y0 = Math.floor(half + (cz * CS - pz) * scale);
			const x1 = Math.ceil(half + ((cx + 1) * CS - px) * scale);
			const y1 = Math.ceil(half + ((cz + 1) * CS - pz) * scale);
			if (tile != null) {
				ctx.drawImage(tile.canvas, x0, y0, x1 - x0, y1 - y0);
			} else {
				// 予算切れ: バイオーム色で塗る
				const bx = cx * CS + CS / 2;
				const bz = cz * CS + CS / 2;
				ctx.fillStyle = BIOME_DEFS[this.world.biomeAt(bx, bz)].color;
				ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
			}
		}

		// 夜は暗いオーバーレイ (タイルは作り直さない)
		const dark = 1 - Math.max(0, Math.min(1, opts.daylight));
		if (dark > 0) {
			ctx.fillStyle = `rgba(4, 8, 28, ${(dark * 0.8).toFixed(3)})`;
			ctx.fillRect(0, 0, size, size);
		}

		// 他のプレイヤー
		const dotR = Math.max(2, size * 0.02);
		for (const p of opts.players) {
			const sx = half + (p.x - px) * scale;
			const sy = half + (p.z - pz) * scale;
			if ((sx - half) ** 2 + (sy - half) ** 2 > (half - dotR) ** 2) continue;
			ctx.beginPath();
			ctx.arc(sx, sy, dotR, 0, Math.PI * 2);
			ctx.fillStyle = p.color;
			ctx.fill();
			ctx.lineWidth = 1;
			ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
			ctx.stroke();
		}

		// MOB (ひし形)
		const mobR = Math.max(2.5, size * 0.025);
		for (const m of opts.mobs) {
			const sx = half + (m.x - px) * scale;
			const sy = half + (m.z - pz) * scale;
			if ((sx - half) ** 2 + (sy - half) ** 2 > (half - mobR) ** 2) continue;
			ctx.beginPath();
			ctx.moveTo(sx, sy - mobR);
			ctx.lineTo(sx + mobR, sy);
			ctx.lineTo(sx, sy + mobR);
			ctx.lineTo(sx - mobR, sy);
			ctx.closePath();
			ctx.fillStyle = MOB_DEFS[m.type].color;
			ctx.fill();
			ctx.lineWidth = 1;
			ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
			ctx.stroke();
		}

		// 自分 (白い三角形、向きは yaw。lookDir(0) が北)
		const triR = Math.max(4, size * 0.045);
		ctx.save();
		ctx.translate(half, half);
		ctx.rotate(-opts.yaw);
		ctx.beginPath();
		ctx.moveTo(0, -triR);
		ctx.lineTo(triR * 0.7, triR * 0.8);
		ctx.lineTo(0, triR * 0.4);
		ctx.lineTo(-triR * 0.7, triR * 0.8);
		ctx.closePath();
		ctx.fillStyle = '#ffffff';
		ctx.fill();
		ctx.lineWidth = 1;
		ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
		ctx.stroke();
		ctx.restore();

		// 方位 N
		const fontPx = Math.max(10, Math.round(size * 0.08));
		ctx.font = `bold ${fontPx}px sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		ctx.lineWidth = 3;
		ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
		ctx.strokeText('N', half, 3);
		ctx.fillStyle = '#ffffff';
		ctx.fillText('N', half, 3);

		ctx.restore();

		// 枠線
		ctx.beginPath();
		ctx.arc(half, half, half - 1, 0, Math.PI * 2);
		ctx.lineWidth = 2;
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
		ctx.stroke();
	}

	private getImage(): ImageData {
		this.image ??= new ImageData(CS, CS);
		return this.image;
	}

	private buildTile(key: string, cx: number, cz: number, generated: boolean): Tile {
		let tile = this.tiles.get(key);
		if (tile == null) {
			const canvas = window.document.createElement('canvas');
			canvas.width = CS;
			canvas.height = CS;
			const ctx = canvas.getContext('2d');
			if (ctx == null) throw new Error('2d context unavailable');
			tile = { canvas, ctx, built: false };
			this.tiles.set(key, tile);
		}
		const img = this.getImage();
		const data = img.data;
		const w = this.world;
		const x0 = cx * CS;
		const z0 = cz * CS;

		if (generated) {
			// 実ブロックの最上面。heights の 0 行目は北隣の列 (未生成なら同じ高さ扱い)
			const h = this.heights;
			const colors: Rgb[] = new Array((CS + 1) * CS);
			for (let r = 0; r <= CS; r++) {
				const z = z0 + r - 1;
				for (let i = 0; i < CS; i++) {
					const x = x0 + i;
					let top = -1;
					let id: number = BLOCK.air;
					if (r > 0 || w.hasChunk(cx, cz - 1)) {
						for (let y: number = WORLD.maxY; y >= 0; y--) {
							const b = w.peekBlock(x, y, z);
							if (b == null) break;
							if (b !== BLOCK.air) {
								top = y;
								id = b;
								break;
							}
						}
					}
					const idx = r * CS + i;
					h[idx] = top;
					colors[idx] = top >= 0 ? parseColor(BLOCK_DEFS[id]?.color ?? '#000000') : [0, 0, 0];
				}
			}
			for (let j = 0; j < CS; j++) {
				for (let i = 0; i < CS; i++) {
					const idx = (j + 1) * CS + i;
					const top = h[idx];
					const o = (j * CS + i) * 4;
					if (top < 0) {
						// 空洞 (岩盤まで空気): 仮色
						const c = parseColor(BIOME_DEFS[w.biomeAt(x0 + i, z0 + j)].color);
						data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
						continue;
					}
					const north = h[idx - CS];
					const diff = north < 0 ? 0 : top - north;
					const shade = 1 + Math.max(-1, Math.min(1, diff / 3)) * SHADE_RANGE;
					const c = colors[idx];
					data[o] = clamp255(c[0] * shade);
					data[o + 1] = clamp255(c[1] * shade);
					data[o + 2] = clamp255(c[2] * shade);
					data[o + 3] = 255;
				}
			}
			tile.built = true;
		} else {
			// 未生成: バイオーム色を地形の高さで陰影。海面より下は水色
			const water = parseColor(BLOCK_DEFS[BLOCK.water].color);
			for (let j = 0; j < CS; j++) {
				for (let i = 0; i < CS; i++) {
					const x = x0 + i;
					const z = z0 + j;
					const hgt = w.terrainHeightAt(x, z);
					const o = (j * CS + i) * 4;
					let c: Rgb;
					let shade = 1;
					if (hgt <= WORLD.seaLevel) {
						c = water;
						shade = 1 - Math.min(0.3, (WORLD.seaLevel - hgt) * 0.02);
					} else {
						c = parseColor(BIOME_DEFS[w.biomeAt(x, z)].color);
						shade = 1 + Math.max(-1, Math.min(1, (w.terrainHeightAt(x, z) - w.terrainHeightAt(x, z - 1)) / 3)) * SHADE_RANGE;
					}
					data[o] = clamp255(c[0] * shade);
					data[o + 1] = clamp255(c[1] * shade);
					data[o + 2] = clamp255(c[2] * shade);
					data[o + 3] = 255;
				}
			}
			tile.built = false;
		}
		tile.ctx.putImageData(img, 0, 0);
		return tile;
	}
}
