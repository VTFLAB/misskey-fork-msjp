/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ATLAS_TILE_PX, BLOCK_DEFS, ITEM, ITEM_DEFS } from './constants.js';
import { getAtlasCanvas } from './atlas.js';

const SIZE = 32;
const cache = new Map<number, string>();
let atlas: HTMLCanvasElement | null = null;

function getAtlas(): HTMLCanvasElement {
	atlas ??= getAtlasCanvas();
	return atlas;
}

function newCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
	const canvas = window.document.createElement('canvas');
	canvas.width = SIZE;
	canvas.height = SIZE;
	const ctx = canvas.getContext('2d')!;
	ctx.imageSmoothingEnabled = false;
	return { canvas, ctx };
}

/** タイルを平行四辺形に変形して描き、明るさを重ねる */
function drawFace(ctx: CanvasRenderingContext2D, tile: number, m: [number, number, number, number, number, number], shade: number): void {
	const T = ATLAS_TILE_PX;
	ctx.save();
	ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
	ctx.drawImage(getAtlas(), tile * T, 0, T, T, 0, 0, 1, 1);
	if (shade > 0) {
		ctx.fillStyle = `rgba(0,0,0,${shade})`;
		ctx.fillRect(0, 0, 1, 1);
	} else if (shade < 0) {
		ctx.fillStyle = `rgba(255,255,255,${-shade})`;
		ctx.fillRect(0, 0, 1, 1);
	}
	ctx.restore();
}

function drawBlock(ctx: CanvasRenderingContext2D, id: number): void {
	const def = BLOCK_DEFS[id];
	if (def == null) return;
	const [top, side] = def.tiles;
	// 等角立方体。中心 (16, 16)、頂点は上 (16,2) 右上 (28,9) 右下 (28,23) 下 (16,30) 左下 (4,23) 左上 (4,9)
	// 上面: 基底 u=(12,7) v=(-12,7)、原点 (16,2)の左 (4,9)
	drawFace(ctx, top, [12, -7, 12, 7, 4, 9], -0.12);
	// 左面: 基底 u=(12,7) v=(0,14)、原点 (4,9)
	drawFace(ctx, side, [12, 7, 0, 14, 4, 9], 0.35);
	// 右面: 基底 u=(12,-7) v=(0,14)、原点 (16,16)
	drawFace(ctx, side, [12, -7, 0, 14, 16, 16], 0.2);
}

/** 斜め棒 (左下から右上) */
function bar(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, w: number, color: string): void {
	ctx.strokeStyle = color;
	ctx.lineWidth = w;
	ctx.lineCap = 'butt';
	ctx.beginPath();
	ctx.moveTo(x1, y1);
	ctx.lineTo(x2, y2);
	ctx.stroke();
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.arc(x, y, r, 0, Math.PI * 2);
	ctx.fill();
}

function drawPickaxe(ctx: CanvasRenderingContext2D, color: string): void {
	bar(ctx, 7, 27, 24, 10, 3, '#6b4a26');
	ctx.strokeStyle = color;
	ctx.lineWidth = 4;
	ctx.lineCap = 'round';
	ctx.beginPath();
	ctx.arc(14, 18, 11, Math.PI * 1.1, Math.PI * 1.9);
	ctx.stroke();
}

function drawSword(ctx: CanvasRenderingContext2D, color: string): void {
	bar(ctx, 6, 26, 10, 22, 4, '#6b4a26');
	bar(ctx, 8, 20, 12, 24, 3, '#4a3418');
	bar(ctx, 11, 21, 26, 6, 5, color);
	bar(ctx, 11, 21, 26, 6, 1.5, 'rgba(255,255,255,0.45)');
}

function drawItem(ctx: CanvasRenderingContext2D, id: number): void {
	const def = ITEM_DEFS[id];
	if (def == null) return;
	switch (id) {
		case ITEM.stick:
			bar(ctx, 8, 26, 24, 8, 3, '#8a6a3c');
			break;
		case ITEM.coal:
			blob(ctx, 12, 20, 6, '#2b2b2b');
			blob(ctx, 21, 16, 5, '#1c1c1c');
			blob(ctx, 17, 24, 4, '#3a3a3a');
			break;
		case ITEM.rawIron:
			blob(ctx, 12, 20, 6, '#c9a98a');
			blob(ctx, 21, 16, 5, '#d6b99c');
			blob(ctx, 17, 24, 4, '#bb9a7a');
			blob(ctx, 11, 19, 1.5, '#5a4a40');
			blob(ctx, 21, 15, 1.5, '#5a4a40');
			blob(ctx, 17, 25, 1.2, '#5a4a40');
			break;
		case ITEM.ironIngot:
			ctx.fillStyle = '#d8d8d8';
			ctx.beginPath();
			ctx.moveTo(8, 22);
			ctx.lineTo(12, 12);
			ctx.lineTo(26, 12);
			ctx.lineTo(23, 22);
			ctx.closePath();
			ctx.fill();
			ctx.fillStyle = '#a8a8a8';
			ctx.fillRect(8, 22, 15, 3);
			break;
		case ITEM.apple:
			bar(ctx, 16, 11, 18, 5, 2, '#5a3b22');
			blob(ctx, 16, 19, 8, '#d33a2f');
			blob(ctx, 13, 16, 2, 'rgba(255,255,255,0.4)');
			break;
		case ITEM.rawMeat:
			ctx.fillStyle = '#d9716a';
			ctx.beginPath();
			ctx.ellipse(16, 18, 11, 7, -0.3, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = '#f3c0b8';
			ctx.beginPath();
			ctx.ellipse(14, 16, 5, 2.5, -0.3, 0, Math.PI * 2);
			ctx.fill();
			break;
		case ITEM.cookedMeat:
			ctx.fillStyle = '#8c4a2b';
			ctx.beginPath();
			ctx.ellipse(16, 18, 11, 7, -0.3, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = '#5e2f1a';
			ctx.beginPath();
			ctx.ellipse(14, 16, 5, 2.5, -0.3, 0, Math.PI * 2);
			ctx.fill();
			break;
		case ITEM.woodenPickaxe:
		case ITEM.stonePickaxe:
		case ITEM.ironPickaxe:
			drawPickaxe(ctx, def.color);
			break;
		case ITEM.woodenSword:
		case ITEM.stoneSword:
		case ITEM.ironSword:
			drawSword(ctx, def.color);
			break;
		default:
			blob(ctx, 16, 16, 8, def.color);
	}
}

/** インベントリ UI 用の 32x32 PNG data URL (id ごとにキャッシュ) */
export function itemIcon(id: number): string {
	const cached = cache.get(id);
	if (cached != null) return cached;
	const { canvas, ctx } = newCanvas();
	if (BLOCK_DEFS[id] != null) drawBlock(ctx, id);
	else drawItem(ctx, id);
	const url = canvas.toDataURL('image/png');
	cache.set(id, url);
	return url;
}
