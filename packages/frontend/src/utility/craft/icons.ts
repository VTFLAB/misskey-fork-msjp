/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ATLAS_TILE_PX, BLOCK_DEFS, ITEM, ITEM_DEFS } from './constants.js';
import { getAtlasCanvas } from './atlas.js';
import type { BlockDef } from './constants.js';

const SIZE = 32;
const cache = new Map<string, string>();
const canvasCache = new Map<number, HTMLCanvasElement>();
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
	if (def.shape === 'cross' || def.shape === 'torch' || def.shape === 'ladder') {
		// 平らなタイルをそのまま拡大して描く
		ctx.drawImage(getAtlas(), top * ATLAS_TILE_PX, 0, ATLAS_TILE_PX, ATLAS_TILE_PX, 2, 2, 28, 28);
		return;
	}
	if (def.shape === 'boxes') {
		drawBoxesBlock(ctx, def);
		return;
	}
	// 等角立方体。中心 (16, 16)、頂点は上 (16,2) 右上 (28,9) 右下 (28,23) 下 (16,30) 左下 (4,23) 左上 (4,9)
	// 上面: 基底 u=(12,7) v=(-12,7)、原点 (16,2)の左 (4,9)
	drawFace(ctx, top, [12, -7, 12, 7, 4, 9], -0.12);
	// 左面: 基底 u=(12,7) v=(0,14)、原点 (4,9)
	drawFace(ctx, side, [12, 7, 0, 14, 4, 9], 0.35);
	// 右面: 基底 u=(12,-7) v=(0,14)、原点 (16,16)
	drawFace(ctx, side, [12, -7, 0, 14, 16, 16], 0.2);
}

type IsoBox = [number, number, number, number, number, number];

/** 等角投影。ブロック座標 (0..16) を 32x32 のアイコン座標へ */
function proj(x: number, y: number, z: number): [number, number] {
	return [16 + (x - z) * 0.75, 2 + (x + z) * (7 / 16) + (16 - y) * 0.875];
}

/** タイルの一部 (u0..u1, v0..v1 は 0..1) を、原点 o とベクトル U, V で張る平行四辺形に描く */
function drawTileQuad(ctx: CanvasRenderingContext2D, tile: number, u0: number, u1: number, v0: number, v1: number, o: [number, number], pu: [number, number], pv: [number, number], shade: number): void {
	if (u1 <= u0 || v1 <= v0) return;
	const T = ATLAS_TILE_PX;
	ctx.save();
	ctx.setTransform(pu[0] - o[0], pu[1] - o[1], pv[0] - o[0], pv[1] - o[1], o[0], o[1]);
	ctx.drawImage(getAtlas(), tile * T + u0 * T, v0 * T, (u1 - u0) * T, (v1 - v0) * T, 0, 0, 1, 1);
	if (shade > 0) {
		ctx.fillStyle = `rgba(0,0,0,${shade})`;
		ctx.fillRect(0, 0, 1, 1);
	} else if (shade < 0) {
		ctx.fillStyle = `rgba(255,255,255,${-shade})`;
		ctx.fillRect(0, 0, 1, 1);
	}
	ctx.restore();
}

/** 箱 1 つを等角で描く (上面・+z 面・+x 面。タイルは箱の範囲に合わせて切り出す) */
function drawIsoBox(ctx: CanvasRenderingContext2D, tiles: [number, number, number], box: IsoBox): void {
	const [x0, y0, z0, x1, y1, z1] = box;
	const [top, side] = tiles;
	// 上面: u は -z 方向、v は +x 方向
	let o = proj(x0, y1, z1);
	drawTileQuad(ctx, top, (16 - z1) / 16, (16 - z0) / 16, x0 / 16, x1 / 16, o, proj(x0, y1, z0), proj(x1, y1, z1), -0.12);
	// +z 面 (左): u は +x 方向、v は下方向
	o = proj(x0, y1, z1);
	drawTileQuad(ctx, side, x0 / 16, x1 / 16, (16 - y1) / 16, (16 - y0) / 16, o, proj(x1, y1, z1), proj(x0, y0, z1), 0.35);
	// +x 面 (右): u は -z 方向
	o = proj(x1, y1, z1);
	drawTileQuad(ctx, side, (16 - z1) / 16, (16 - z0) / 16, (16 - y1) / 16, (16 - y0) / 16, o, proj(x1, y1, z0), proj(x1, y0, z1), 0.2);
}

function drawFlatTile(ctx: CanvasRenderingContext2D, tile: number, x = 2, y = 2, w = 28, h = 28): void {
	ctx.drawImage(getAtlas(), tile * ATLAS_TILE_PX, 0, ATLAS_TILE_PX, ATLAS_TILE_PX, x, y, w, h);
}

function drawBoxesBlock(ctx: CanvasRenderingContext2D, def: BlockDef): void {
	const tiles = def.tiles;
	if (def.door != null) {
		// 下半分と上半分を縦に並べる (扉 1 枚ぶん)
		drawFlatTile(ctx, tiles[2] + 1, 9, 1, 14, 15);
		drawFlatTile(ctx, tiles[2], 9, 16, 14, 15);
		return;
	}
	if (def.connect === 'pane' || def.key === 'lantern' || def.key === 'flowerPot') {
		drawFlatTile(ctx, tiles[0]);
		return;
	}
	let boxes: IsoBox[] = (def.boxes ?? []).map(b => [b[0], b[1], b[2], b[3], b[4], b[5]]);
	if (def.connect === 'fence') {
		boxes = [...boxes, [10, 6, 7, 16, 9, 9], [10, 12, 7, 16, 15, 9], [7, 6, 10, 9, 9, 16], [7, 12, 10, 9, 15, 16]];
	} else if (def.connect === 'wall') {
		boxes = [...boxes, [12, 0, 5, 16, 14, 11], [5, 0, 12, 11, 14, 16]];
	}
	// 低い箱から、奥から手前の順に描く (上の箱が下の箱の上面を隠す)
	boxes.sort((a, b) => a[1] - b[1] || (a[0] + a[2]) - (b[0] + b[2]));
	for (const box of boxes) drawIsoBox(ctx, tiles, box);
}

function drawDye(ctx: CanvasRenderingContext2D, color: string): void {
	const dark = mix(color, 0.55);
	ellipse(ctx, 16, 23, 11, 5.5, 0, mix(color, 0.8), dark);
	ellipse(ctx, 16, 19, 8.5, 6.5, 0, color, dark);
	ellipse(ctx, 16, 14, 5, 4.5, 0, mix(color, 1.1), dark);
	ellipse(ctx, 14, 12.5, 2.2, 1.5, -0.4, mix(color, 1.6));
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

/** #rrggbb を明るさ倍率 f で暗く (f<1) / 明るく (f>1) する */
function mix(hex: string, f: number): string {
	const n = parseInt(hex.slice(1), 16);
	const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f <= 1 ? v * f : v + (255 - v) * (f - 1))));
	return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

function poly(ctx: CanvasRenderingContext2D, pts: [number, number][], fill: string, stroke?: string): void {
	ctx.beginPath();
	ctx.moveTo(pts[0][0], pts[0][1]);
	for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
	ctx.closePath();
	ctx.fillStyle = fill;
	ctx.fill();
	if (stroke != null) {
		ctx.strokeStyle = stroke;
		ctx.lineWidth = 1.5;
		ctx.lineJoin = 'round';
		ctx.stroke();
	}
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot: number, fill: string, stroke?: string): void {
	ctx.beginPath();
	ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
	ctx.fillStyle = fill;
	ctx.fill();
	if (stroke != null) {
		ctx.strokeStyle = stroke;
		ctx.lineWidth = 1.5;
		ctx.stroke();
	}
}

const HANDLE = '#6b4a26';

function drawPickaxe(ctx: CanvasRenderingContext2D, color: string): void {
	bar(ctx, 7, 27, 24, 10, 3, HANDLE);
	ctx.strokeStyle = color;
	ctx.lineWidth = 4;
	ctx.lineCap = 'round';
	ctx.beginPath();
	ctx.arc(14, 18, 11, Math.PI * 1.1, Math.PI * 1.9);
	ctx.stroke();
}

function drawSword(ctx: CanvasRenderingContext2D, color: string): void {
	bar(ctx, 6, 26, 10, 22, 4, HANDLE);
	bar(ctx, 8, 20, 12, 24, 3, '#4a3418');
	bar(ctx, 11, 21, 26, 6, 5, color);
	bar(ctx, 11, 21, 26, 6, 1.5, 'rgba(255,255,255,0.45)');
}

function drawAxe(ctx: CanvasRenderingContext2D, color: string): void {
	bar(ctx, 7, 27, 21, 9, 3, HANDLE);
	poly(ctx, [[15, 5], [27, 7], [26, 17], [20, 13], [17, 15]], color, mix(color, 0.6));
	bar(ctx, 19, 8, 25, 9, 1.2, 'rgba(255,255,255,0.4)');
}

function drawShovel(ctx: CanvasRenderingContext2D, color: string): void {
	bar(ctx, 6, 27, 20, 13, 3, HANDLE);
	ellipse(ctx, 23, 9, 4.5, 6, 0.8, color, mix(color, 0.6));
	bar(ctx, 21, 8, 24, 5, 1.2, 'rgba(255,255,255,0.4)');
}

function drawHoe(ctx: CanvasRenderingContext2D, color: string): void {
	bar(ctx, 7, 27, 21, 9, 3, HANDLE);
	poly(ctx, [[14, 6], [26, 5], [27, 10], [22, 10], [22, 14], [18, 12], [14, 10]], color, mix(color, 0.6));
}

function drawHelmet(ctx: CanvasRenderingContext2D, color: string): void {
	const dark = mix(color, 0.6);
	ctx.beginPath();
	ctx.moveTo(5, 24);
	ctx.lineTo(5, 15);
	ctx.arc(16, 15, 11, Math.PI, 0);
	ctx.lineTo(27, 24);
	ctx.lineTo(21, 24);
	ctx.lineTo(21, 17);
	ctx.lineTo(11, 17);
	ctx.lineTo(11, 24);
	ctx.closePath();
	ctx.fillStyle = color;
	ctx.fill();
	ctx.strokeStyle = dark;
	ctx.lineWidth = 1.5;
	ctx.stroke();
	bar(ctx, 9, 9, 15, 6, 1.5, 'rgba(255,255,255,0.4)');
}

function drawChestplate(ctx: CanvasRenderingContext2D, color: string): void {
	const dark = mix(color, 0.6);
	poly(ctx, [[3, 8], [11, 5], [14, 8], [18, 8], [21, 5], [29, 8], [29, 16], [24, 16], [24, 28], [8, 28], [8, 16], [3, 16]], color, dark);
	bar(ctx, 16, 10, 16, 27, 1, dark);
	bar(ctx, 10, 11, 12, 11, 1.5, 'rgba(255,255,255,0.35)');
}

function drawLeggings(ctx: CanvasRenderingContext2D, color: string): void {
	const dark = mix(color, 0.6);
	poly(ctx, [[7, 5], [25, 5], [26, 28], [18, 28], [16, 14], [14, 28], [6, 28]], color, dark);
	bar(ctx, 7, 8, 25, 8, 2, dark);
	bar(ctx, 9, 13, 9, 22, 1.5, 'rgba(255,255,255,0.3)');
}

function drawBoots(ctx: CanvasRenderingContext2D, color: string): void {
	const dark = mix(color, 0.6);
	poly(ctx, [[5, 8], [13, 8], [13, 19], [17, 23], [17, 27], [4, 27], [4, 22], [5, 22]], color, dark);
	poly(ctx, [[19, 8], [27, 8], [27, 22], [28, 22], [28, 27], [15, 27], [15, 23], [19, 19]], color, dark);
	bar(ctx, 5, 9, 12, 9, 1.5, 'rgba(255,255,255,0.35)');
}

function drawGem(ctx: CanvasRenderingContext2D, color: string): void {
	poly(ctx, [[16, 4], [26, 12], [16, 28], [6, 12]], color, mix(color, 0.55));
	poly(ctx, [[16, 4], [26, 12], [6, 12]], mix(color, 1.5));
	bar(ctx, 16, 12, 16, 27, 1, mix(color, 0.75));
	bar(ctx, 11, 9, 14, 7, 1.5, 'rgba(255,255,255,0.7)');
}

function drawLapis(ctx: CanvasRenderingContext2D, color: string): void {
	ellipse(ctx, 12, 20, 6, 5, 0.3, color, mix(color, 0.55));
	ellipse(ctx, 21, 16, 5.5, 5, -0.4, mix(color, 1.2), mix(color, 0.55));
	ellipse(ctx, 16, 11, 4, 3.5, 0, mix(color, 0.85), mix(color, 0.55));
	blob(ctx, 12, 19, 1, '#d8c040');
	blob(ctx, 21, 15, 1, '#d8c040');
}

function drawIngot(ctx: CanvasRenderingContext2D, color: string): void {
	poly(ctx, [[7, 22], [11, 12], [26, 12], [23, 22]], mix(color, 1.2), mix(color, 0.6));
	poly(ctx, [[7, 22], [23, 22], [23, 26], [7, 26]], mix(color, 0.75), mix(color, 0.55));
	bar(ctx, 12, 15, 22, 15, 1.5, 'rgba(255,255,255,0.45)');
}

function drawRawOre(ctx: CanvasRenderingContext2D, color: string, speck: string): void {
	blob(ctx, 12, 20, 6, color);
	blob(ctx, 21, 16, 5, mix(color, 1.15));
	blob(ctx, 17, 24, 4, mix(color, 0.85));
	blob(ctx, 11, 19, 1.5, speck);
	blob(ctx, 21, 15, 1.5, speck);
	blob(ctx, 17, 25, 1.2, speck);
}

function drawMeat(ctx: CanvasRenderingContext2D, color: string, cooked: boolean): void {
	ellipse(ctx, 16, 18, 11, 7, -0.3, color, cooked ? mix(color, 0.5) : undefined);
	ellipse(ctx, 14, 16, 5, 2.5, -0.3, cooked ? mix(color, 0.7) : mix(color, 1.4));
}

function drawDrumstick(ctx: CanvasRenderingContext2D, color: string, cooked: boolean): void {
	bar(ctx, 18, 16, 26, 7, 3, '#efe8d4');
	blob(ctx, 27, 6, 2, '#efe8d4');
	ellipse(ctx, 13, 19, 8, 7, -0.6, color, cooked ? mix(color, 0.5) : undefined);
	ellipse(ctx, 11, 17, 3.5, 2.5, -0.6, cooked ? mix(color, 0.7) : mix(color, 1.4));
}

function drawChop(ctx: CanvasRenderingContext2D, color: string, cooked: boolean): void {
	poly(ctx, [[5, 17], [10, 8], [22, 8], [28, 16], [24, 25], [11, 26]], color, cooked ? mix(color, 0.5) : mix(color, 0.8));
	ellipse(ctx, 20, 16, 3, 2.5, 0, cooked ? mix(color, 0.7) : '#f2e8e0');
}

function drawItem(ctx: CanvasRenderingContext2D, id: number): void {
	const def = ITEM_DEFS[id];
	if (def == null) return;
	const color = def.color;
	if (def.tool != null) {
		const tcolor = def.tool.material === 'wood' ? '#a8814a' : color;
		switch (def.tool.kind) {
			case 'pickaxe': drawPickaxe(ctx, tcolor); return;
			case 'sword': drawSword(ctx, tcolor); return;
			case 'axe': drawAxe(ctx, tcolor); return;
			case 'shovel': drawShovel(ctx, tcolor); return;
			case 'hoe': drawHoe(ctx, tcolor); return;
			default: break;
		}
	}
	if (def.armor != null) {
		switch (def.armor.slot) {
			case 'helmet': drawHelmet(ctx, color); return;
			case 'chestplate': drawChestplate(ctx, color); return;
			case 'leggings': drawLeggings(ctx, color); return;
			case 'boots': drawBoots(ctx, color); return;
		}
	}
	if (id >= ITEM.redDye && id <= ITEM.limeDye) {
		drawDye(ctx, color);
		return;
	}
	switch (id) {
		case ITEM.stick:
			bar(ctx, 8, 26, 24, 8, 3, color);
			break;
		case ITEM.coal:
			blob(ctx, 12, 20, 6, '#2b2b2b');
			blob(ctx, 21, 16, 5, '#1c1c1c');
			blob(ctx, 17, 24, 4, '#3a3a3a');
			break;
		case ITEM.charcoal:
			blob(ctx, 12, 20, 6, '#3a3a3a');
			blob(ctx, 21, 16, 5, '#2c2c2c');
			blob(ctx, 17, 24, 4, '#4a4440');
			blob(ctx, 13, 18, 1.5, '#6a5a50');
			break;
		case ITEM.rawIron: drawRawOre(ctx, '#c9a98a', '#5a4a40'); break;
		case ITEM.rawGold: drawRawOre(ctx, '#e0c070', '#8a6a20'); break;
		case ITEM.ironIngot:
		case ITEM.goldIngot:
			drawIngot(ctx, color);
			break;
		case ITEM.diamond: drawGem(ctx, color); break;
		case ITEM.lapis: drawLapis(ctx, color); break;
		case ITEM.leather:
			poly(ctx, [[6, 9], [12, 6], [20, 6], [26, 9], [24, 15], [26, 24], [20, 27], [12, 27], [6, 24], [8, 15]], color, mix(color, 0.55));
			blob(ctx, 13, 14, 2, mix(color, 0.8));
			blob(ctx, 20, 20, 2.5, mix(color, 1.2));
			break;
		case ITEM.feather:
			bar(ctx, 7, 27, 24, 7, 1.5, '#cfcfcf');
			ellipse(ctx, 17, 16, 10, 4.5, -0.75, '#f4f4f4', '#c8c8c8');
			break;
		case ITEM.bone:
			bar(ctx, 9, 23, 23, 9, 4, color);
			blob(ctx, 7, 22, 2.5, color);
			blob(ctx, 10, 26, 2.5, color);
			blob(ctx, 22, 6, 2.5, color);
			blob(ctx, 25, 10, 2.5, color);
			break;
		case ITEM.string:
			ctx.strokeStyle = '#eeeeee';
			ctx.lineWidth = 2;
			ctx.lineCap = 'round';
			ctx.beginPath();
			ctx.moveTo(6, 24);
			ctx.bezierCurveTo(10, 8, 16, 28, 20, 14);
			ctx.bezierCurveTo(22, 8, 25, 10, 26, 7);
			ctx.stroke();
			break;
		case ITEM.rottenFlesh:
			poly(ctx, [[5, 14], [11, 7], [22, 8], [28, 15], [24, 24], [12, 26], [6, 22]], color, mix(color, 0.55));
			blob(ctx, 13, 15, 2.5, '#6a7a3a');
			blob(ctx, 21, 19, 2, '#5a6a30');
			break;
		case ITEM.wheatSeeds:
			for (const [x, y] of [[10, 12], [18, 9], [22, 17], [13, 21], [19, 24]] as const) ellipse(ctx, x, y, 2.2, 1.4, 0.6, color, '#3f5a22');
			break;
		case ITEM.wheat:
			bar(ctx, 9, 28, 20, 8, 1.5, '#b09030');
			bar(ctx, 14, 28, 24, 12, 1.5, '#b09030');
			for (let i = 0; i < 4; i++) {
				ellipse(ctx, 18 + i * 1.8, 8 + i * 2.5, 2.6, 1.6, -0.6, color, '#a08024');
				ellipse(ctx, 21 + i * 1.8, 11 + i * 2.5, 2.6, 1.6, 0.6, mix(color, 1.1), '#a08024');
			}
			break;
		case ITEM.bread:
			ellipse(ctx, 16, 19, 12, 7, 0, color, mix(color, 0.55));
			ellipse(ctx, 16, 17, 10, 4, 0, mix(color, 1.2));
			for (const x of [11, 16, 21]) bar(ctx, x - 1, 20, x + 1, 15, 1.2, mix(color, 0.6));
			break;
		case ITEM.apple:
			bar(ctx, 16, 11, 18, 5, 2, '#5a3b22');
			blob(ctx, 16, 19, 8, '#d33a2f');
			blob(ctx, 13, 16, 2, 'rgba(255,255,255,0.4)');
			ellipse(ctx, 21, 8, 3.5, 1.8, -0.5, '#4f9a3a');
			break;
		case ITEM.goldenApple:
			bar(ctx, 16, 11, 18, 5, 2, '#5a3b22');
			blob(ctx, 16, 19, 8, '#f1d04a');
			blob(ctx, 16, 19, 8, 'rgba(255,255,255,0.0)');
			blob(ctx, 13, 16, 2.5, 'rgba(255,255,255,0.6)');
			ctx.strokeStyle = '#b8901e';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.arc(16, 19, 8, 0, Math.PI * 2);
			ctx.stroke();
			break;
		case ITEM.rawMeat: case ITEM.rawBeef: case ITEM.rawMutton:
			drawMeat(ctx, color, false);
			break;
		case ITEM.cookedMeat: case ITEM.cookedBeef: case ITEM.cookedMutton:
			drawMeat(ctx, color, true);
			break;
		case ITEM.rawPorkchop: drawChop(ctx, color, false); break;
		case ITEM.cookedPorkchop: drawChop(ctx, color, true); break;
		case ITEM.rawChicken: drawDrumstick(ctx, color, false); break;
		case ITEM.cookedChicken: drawDrumstick(ctx, color, true); break;
		case ITEM.arrow:
			bar(ctx, 6, 26, 24, 8, 2, '#8a6a3c');
			poly(ctx, [[27, 5], [26, 12], [20, 6]], '#9a9a9a', '#5a5a5a');
			poly(ctx, [[4, 28], [5, 22], [10, 27]], '#f4f4f4', '#c0c0c0');
			poly(ctx, [[8, 24], [9, 18], [14, 23]], '#f4f4f4', '#c0c0c0');
			break;
		case ITEM.bow:
			ctx.strokeStyle = '#8a6a3c';
			ctx.lineWidth = 3;
			ctx.lineCap = 'round';
			ctx.beginPath();
			ctx.arc(5, 27, 22, -Math.PI * 0.5, 0);
			ctx.stroke();
			bar(ctx, 27, 27, 5, 5, 1, '#eeeeee');
			break;
		case ITEM.egg:
			ellipse(ctx, 16, 17, 7, 9, 0, color, '#b8a888');
			blob(ctx, 13, 13, 2, 'rgba(255,255,255,0.6)');
			break;
		case ITEM.brick:
			poly(ctx, [[5, 21], [9, 11], [27, 11], [24, 21]], mix(color, 1.2), mix(color, 0.55));
			poly(ctx, [[5, 21], [24, 21], [24, 26], [5, 26]], mix(color, 0.8), mix(color, 0.55));
			break;
		case ITEM.book:
			poly(ctx, [[6, 6], [24, 6], [26, 8], [26, 26], [8, 26], [6, 24]], color, '#3a2214');
			poly(ctx, [[9, 9], [23, 9], [23, 23], [9, 23]], '#efe6cc');
			bar(ctx, 9, 24, 23, 24, 1.5, '#a09070');
			bar(ctx, 6, 8, 6, 24, 3, mix(color, 0.7));
			break;
		case ITEM.paper:
			poly(ctx, [[7, 5], [25, 5], [25, 27], [7, 27]], color, '#b8b09a');
			for (const y of [10, 14, 18, 22]) bar(ctx, 10, y, 22, y, 1, '#c8c0aa');
			break;
		case ITEM.melonSlice:
			ctx.fillStyle = '#4a9a3a';
			ctx.beginPath();
			ctx.arc(16, 8, 18, Math.PI * 0.2, Math.PI * 0.8);
			ctx.closePath();
			ctx.fill();
			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.arc(16, 8, 15, Math.PI * 0.2, Math.PI * 0.8);
			ctx.closePath();
			ctx.fill();
			for (const [x, y] of [[13, 16], [17, 19], [20, 15], [16, 14]] as const) blob(ctx, x, y, 1, '#1c1c1c');
			break;
		case ITEM.pumpkinPie:
			ellipse(ctx, 16, 19, 12, 7, 0, '#c8903f', '#7a5020');
			ellipse(ctx, 16, 17, 10, 5, 0, color, '#a0702a');
			ellipse(ctx, 16, 17, 4, 2, 0, mix(color, 1.3));
			break;
		default:
			blob(ctx, 16, 16, 8, color);
	}
}

function render(id: number, enchanted: boolean): HTMLCanvasElement {
	const { canvas, ctx } = newCanvas();
	if (BLOCK_DEFS[id] != null) drawBlock(ctx, id);
	else drawItem(ctx, id);
	if (enchanted) {
		// 描いた部分にだけ紫の光沢を重ねる
		ctx.save();
		ctx.globalCompositeOperation = 'source-atop';
		ctx.fillStyle = 'rgba(150,70,255,0.28)';
		ctx.fillRect(0, 0, SIZE, SIZE);
		ctx.strokeStyle = 'rgba(230,190,255,0.35)';
		ctx.lineWidth = 3;
		for (let k = -SIZE; k < SIZE; k += 10) {
			ctx.beginPath();
			ctx.moveTo(k, SIZE);
			ctx.lineTo(k + SIZE, 0);
			ctx.stroke();
		}
		ctx.restore();
	}
	return canvas;
}

/** 手に持った見た目用のテクスチャ (32x32、id ごとにキャッシュ) */
export function itemIconCanvas(id: number): HTMLCanvasElement {
	let canvas = canvasCache.get(id);
	if (canvas == null) {
		canvas = render(id, false);
		canvasCache.set(id, canvas);
	}
	return canvas;
}

/** インベントリ UI 用の 32x32 PNG data URL (id と enchanted ごとにキャッシュ) */
export function itemIcon(id: number, opts?: { enchanted?: boolean }): string {
	const enchanted = opts?.enchanted === true;
	const key = `${id}:${enchanted ? 1 : 0}`;
	const cached = cache.get(key);
	if (cached != null) return cached;
	const url = (enchanted ? render(id, true) : itemIconCanvas(id)).toDataURL('image/png');
	cache.set(key, url);
	return url;
}
