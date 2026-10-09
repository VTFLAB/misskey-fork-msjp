/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ATLAS_TILE_COUNT, ATLAS_TILE_PX } from './constants.js';

/**
 * 画像ファイルを持たず、ブロックのテクスチャを canvas で手続き的に描く。
 * タイル番号は constants.ts の BLOCK_DEFS.tiles と対応する。
 */

type Rgb = [number, number, number];

function rand(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

function put(data: Uint8ClampedArray, i: number, c: Rgb, a = 255) {
	data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = a;
}

function vary(c: Rgb, amount: number, r: number): Rgb {
	const d = (r - 0.5) * 2 * amount;
	return [
		Math.max(0, Math.min(255, c[0] + d)),
		Math.max(0, Math.min(255, c[1] + d)),
		Math.max(0, Math.min(255, c[2] + d)),
	];
}

type TilePainter = (px: number, py: number, r: () => number) => [Rgb, number];

const GRASS: Rgb = [104, 170, 58];
const DIRT: Rgb = [134, 92, 52];
const STONE: Rgb = [130, 130, 130];
const SAND: Rgb = [220, 210, 160];
const WATER: Rgb = [52, 104, 210];
const LOG: Rgb = [112, 84, 48];
const LOG_END: Rgb = [170, 140, 90];
const LEAVES: Rgb = [58, 130, 46];
const PLANKS: Rgb = [178, 140, 90];
const BRICK: Rgb = [160, 76, 58];
const MORTAR: Rgb = [190, 180, 170];
const COBBLE: Rgb = [112, 112, 112];
const GLASS: Rgb = [200, 232, 240];
const LAMP: Rgb = [246, 215, 107];

const painters: TilePainter[] = [
	// 0: grass top
	(_px, _py, r) => [vary(GRASS, 24, r()), 255],
	// 1: grass side (上端だけ草)
	(_px, py, r) => [py < 3 ? vary(GRASS, 20, r()) : vary(DIRT, 24, r()), 255],
	// 2: dirt
	(_px, _py, r) => [vary(DIRT, 28, r()), 255],
	// 3: stone
	(_px, _py, r) => [vary(STONE, 26, r()), 255],
	// 4: sand
	(_px, _py, r) => [vary(SAND, 14, r()), 255],
	// 5: water
	(px, py, r) => [vary(WATER, 18, r() * 0.5 + ((px + py) % 4 === 0 ? 0.6 : 0.4)), 170],
	// 6: log end (年輪)
	(px, py, r) => {
		const d = Math.max(Math.abs(px - 7.5), Math.abs(py - 7.5));
		return [Math.floor(d) % 2 === 0 ? vary(LOG_END, 16, r()) : vary(LOG, 16, r()), 255];
	},
	// 7: log side (縦縞)
	(px, _py, r) => [px % 4 === 0 ? vary(LOG, 10, r() * 0.3) : vary(LOG, 22, r()), 255],
	// 8: leaves (穴あき)
	(_px, _py, r) => {
		const v = r();
		return v < 0.12 ? [LEAVES, 0] : [vary(LEAVES, 36, v), 255];
	},
	// 9: planks (横板)
	(px, py, r) => {
		const line = py % 4 === 0 || (py >= 4 && py < 8 && px === 8) || (py >= 12 && px === 3);
		return [line ? vary([120, 90, 50], 8, r()) : vary(PLANKS, 18, r()), 255];
	},
	// 10: bricks
	(px, py, r) => {
		const row = Math.floor(py / 4);
		const shifted = (px + (row % 2 === 0 ? 0 : 4)) % 8;
		const mortar = py % 4 === 3 || shifted === 7;
		return [mortar ? vary(MORTAR, 10, r()) : vary(BRICK, 20, r()), 255];
	},
	// 11: cobblestone
	(px, py, r) => {
		const cell = ((px * 7 + py * 13) % 5 === 0);
		return [cell ? vary([80, 80, 80], 10, r()) : vary(COBBLE, 34, r()), 255];
	},
	// 12: glass (縁だけ不透明寄り)
	(px, py, r) => {
		const edge = px === 0 || py === 0 || px === 15 || py === 15;
		return [edge ? vary([230, 245, 250], 6, r()) : GLASS, edge ? 220 : 70];
	},
	// 13: lamp
	(px, py, r) => {
		const edge = px === 0 || py === 0 || px === 15 || py === 15;
		return [edge ? vary([120, 100, 60], 8, r()) : vary(LAMP, 20, r()), 255];
	},
];

export function buildAtlas(): HTMLCanvasElement {
	const size = ATLAS_TILE_PX;
	const canvas = window.document.createElement('canvas');
	canvas.width = size * ATLAS_TILE_COUNT;
	canvas.height = size;
	const ctx = canvas.getContext('2d')!;
	const image = ctx.createImageData(canvas.width, canvas.height);
	for (let tile = 0; tile < ATLAS_TILE_COUNT; tile++) {
		const painter = painters[tile] ?? painters[3];
		const r = rand(1234 + tile * 77);
		for (let py = 0; py < size; py++) {
			for (let px = 0; px < size; px++) {
				const [c, a] = painter(px, py, r);
				put(image.data, ((py * canvas.width) + tile * size + px) * 4, c, a);
			}
		}
	}
	ctx.putImageData(image, 0, 0);
	return canvas;
}
