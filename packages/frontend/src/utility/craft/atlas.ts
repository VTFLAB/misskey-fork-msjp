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
const SNOW: Rgb = [244, 247, 250];
const CACTUS: Rgb = [76, 140, 60];
const COAL: Rgb = [28, 28, 30];
const IRON: Rgb = [214, 190, 160];
const BEDROCK: Rgb = [48, 48, 50];
const GRAVEL: Rgb = [128, 122, 116];

/** タイル内の座標から決まる 0..1 の擬似乱数 (鉱石の塊の位置用) */
function hash2(px: number, py: number, salt: number): number {
	let h = Math.imul(px + 31, 374761393) ^ Math.imul(py + 17, 668265263) ^ Math.imul(salt, 2147483647);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 石の地に 2x2 前後の塊を散らす */
function orePainter(lump: Rgb, salt: number): TilePainter {
	return (px, py, r) => {
		// 4x4 の区画ごとに塊を 1 つ置く (置かない区画もある)
		const gx = Math.floor(px / 4);
		const gy = Math.floor(py / 4);
		if (hash2(gx, gy, salt) < 0.55) {
			const ox = gx * 4 + 1 + Math.floor(hash2(gx, gy, salt + 1) * 2);
			const oy = gy * 4 + 1 + Math.floor(hash2(gx, gy, salt + 2) * 2);
			if (px >= ox && px < ox + 2 && py >= oy && py < oy + 2) return [vary(lump, 14, r()), 255];
		}
		return [vary(STONE, 26, r()), 255];
	};
}

/** 小麦の成長段階 (透明な十字テクスチャ) */
function wheatPainter(stage: number): TilePainter {
	const heights = [3, 7, 11, 14];
	const cols = stage === 0 ? [4, 8, 12] : [2, 5, 8, 11, 14];
	const h = heights[stage];
	return (px, py, r) => {
		const top = 16 - h;
		const stalk = cols.includes(px) && py >= top - (px % 3);
		if (stalk && py < 16) {
			if (stage === 3) return [vary(py <= top + 2 ? [214, 180, 64] : [176, 150, 56], 16, r()), 255];
			return [vary(stage === 2 ? [128, 176, 60] : [90, 176, 62], 20, r()), 255];
		}
		if (stage === 3 && py >= top && py <= top + 2 && cols.some(c => Math.abs(c - px) === 1)) return [vary([226, 196, 80], 14, r()), 255];
		return [[0, 0, 0], 0];
	};
}

const crackMasks: (Uint8Array | null)[] = new Array(10).fill(null);

/** 中心から伸びる亀裂。段階が進むほど本数と長さが増える (同じ種から作るので段階をまたいで同じ形で育つ) */
function crackMask(stage: number): Uint8Array {
	const cached = crackMasks[stage];
	if (cached != null) return cached;
	const mask = new Uint8Array(ATLAS_TILE_PX * ATLAS_TILE_PX);
	const r = rand(7001);
	const mark = (x: number, y: number) => {
		const ix = Math.round(x);
		const iy = Math.round(y);
		if (ix >= 0 && ix < ATLAS_TILE_PX && iy >= 0 && iy < ATLAS_TILE_PX) mask[iy * ATLAS_TILE_PX + ix] = 1;
	};
	const walk = (x0: number, y0: number, angle0: number, len: number, branch: boolean) => {
		let x = x0;
		let y = y0;
		let a = angle0;
		for (let t = 0; t < len; t += 0.5) {
			mark(x, y);
			if (stage >= 6) mark(x + 1, y);
			x += Math.cos(a) * 0.5;
			y += Math.sin(a) * 0.5;
			a += (r() - 0.5) * 0.6;
			if (branch === false && stage >= 4 && Math.abs(t - len * 0.5) < 0.25) walk(x, y, a + (r() < 0.5 ? 0.9 : -0.9), len * 0.45, true);
		}
	};
	const rays = 12;
	for (let k = 0; k < rays; k++) {
		const angle = (k / rays) * Math.PI * 2 + (r() - 0.5) * 0.5;
		const lenFactor = 0.6 + r() * 0.4;
		const branchSeed = r();
		if (k >= 3 + stage) continue;
		const len = Math.min(10, (2 + stage * 0.9) * lenFactor + 0.5 * branchSeed);
		walk(7.5, 7.5, angle, len, false);
	}
	mark(7.5, 7.5);
	crackMasks[stage] = mask;
	return mask;
}

function crackPainter(stage: number): TilePainter {
	return (px, py) => {
		if (crackMask(stage)[py * ATLAS_TILE_PX + px] === 0) return [[0, 0, 0], 0];
		return [[0, 0, 0], 120 + Math.floor(hash2(px, py, 70 + stage) * 80)];
	};
}

/** 地色に明暗の斑点を散らす (安山岩・花崗岩・閃緑岩) */
function speckled(base: Rgb, dark: Rgb, light: Rgb, salt: number): TilePainter {
	return (px, py, r) => {
		const h = hash2(px, py, salt);
		if (h < 0.14) return [vary(dark, 8, r()), 255];
		if (h > 0.88) return [vary(light, 8, r()), 255];
		return [vary(base, 8, r()), 255];
	};
}

/** 磨いた石 (1px の暗い縁と明るい内側) */
function polished(base: Rgb): TilePainter {
	return (px, py, r) => {
		const edge = px === 0 || py === 0 || px === 15 || py === 15;
		const k = edge ? 0.82 : (px === 1 || py === 1) ? 1.06 : 1;
		return [vary([base[0] * k, base[1] * k, base[2] * k], 4, r()), 255];
	};
}

function brickPainter(brick: Rgb, mortar: Rgb, amount: number): TilePainter {
	return (px, py, r) => {
		const row = Math.floor(py / 4);
		const shifted = (px + (row % 2 === 0 ? 0 : 4)) % 8;
		const isMortar = py % 4 === 3 || shifted === 7;
		return [isMortar ? vary(mortar, 8, r()) : vary(brick, amount, r()), 255];
	};
}

function woolPainter(c: Rgb): TilePainter {
	return (px, py, r) => {
		const k = (px + py) % 3 === 0 ? 1.06 : 0.94;
		return [vary([c[0] * k, c[1] * k, c[2] * k], 10, r()), 255];
	};
}

function concretePainter(c: Rgb): TilePainter {
	return (_px, _py, r) => [vary(c, 4, r()), 255];
}

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
	// 14: snow top
	(_px, _py, r) => [vary(SNOW, 6, r()), 255],
	// 15: snow side (上端 3 行だけ雪、下は土)
	(_px, py, r) => [py < 3 ? vary(SNOW, 6, r()) : vary(DIRT, 24, r()), 255],
	// 16: cactus top
	(px, py, r) => {
		const edge = px === 0 || py === 0 || px === 15 || py === 15;
		return [edge ? vary([40, 96, 36], 8, r()) : vary(CACTUS, 14, r()), 255];
	},
	// 17: cactus side (縦のリブ)
	(px, _py, r) => [px % 4 === 0 ? vary([38, 92, 34], 8, r()) : vary(CACTUS, 14, r()), 255],
	// 18: coal ore
	orePainter(COAL, 18),
	// 19: iron ore
	orePainter(IRON, 19),
	// 20: bedrock
	(_px, _py, r) => [vary(BEDROCK, 22, r()), 255],
	// 21: crafting table top (板に 3x3 の格子)
	(px, py, r) => {
		const grid = px === 0 || py === 0 || px === 15 || py === 15 || px % 5 === 0 || py % 5 === 0;
		return [grid ? vary([84, 58, 32], 8, r()) : vary(PLANKS, 16, r()), 255];
	},
	// 22: crafting table side (板に道具のシルエット)
	(px, py, r) => {
		const border = py < 2 || px === 0 || px === 15;
		if (border) return [vary([96, 68, 38], 8, r()), 255];
		// 左: 斧の頭と柄、右: のこぎり状の縞
		const saw = px >= 9 && px <= 13 && py >= 5 && py <= 11 && (px + py) % 2 === 0;
		const axeHead = px >= 2 && px <= 5 && py >= 4 && py <= 7;
		const handle = px === 4 && py >= 7 && py <= 13;
		if (saw || axeHead || handle) return [vary([60, 60, 66], 8, r()), 255];
		return [vary(PLANKS, 16, r()), 255];
	},
	// 23: gravel
	(px, py, r) => {
		const cell = (Math.floor(px / 3) * 5 + Math.floor(py / 3) * 3) % 4;
		const base: Rgb = cell === 0 ? [150, 140, 130] : cell === 1 ? [108, 100, 94] : cell === 2 ? [136, 124, 110] : GRAVEL;
		return [vary(base, 20, r()), 255];
	},
	// 24: gold ore
	orePainter([244, 204, 64], 24),
	// 25: diamond ore
	orePainter([92, 232, 228], 25),
	// 26: lapis ore
	orePainter([40, 70, 190], 26),
	// 27: torch (透明タイル。柱 + 炎)
	(px, py, r) => {
		if ((px === 7 || px === 8) && py >= 6) return [vary(px === 7 ? [120, 86, 44] : [96, 66, 34], 8, r()), 255];
		if ((px === 7 || px === 8) && py === 4) return [[255, 232, 96], 255];
		if ((px === 7 || px === 8) && py === 5) return [[255, 160, 40], 255];
		return [[0, 0, 0], 0];
	},
	// 28: ladder (透明タイル。縦の桟 2 本と横木 3 本)
	(px, py, r) => {
		const rail = px === 1 || px === 2 || px === 13 || px === 14;
		const rung = px >= 3 && px <= 12 && ((py >= 2 && py <= 3) || (py >= 7 && py <= 8) || (py >= 12 && py <= 13));
		if (rail || rung) return [vary([142, 104, 56], 16, r()), 255];
		return [[0, 0, 0], 0];
	},
	// 29: stone bricks
	(px, py, r) => {
		const row = Math.floor(py / 4);
		const shifted = (px + (row % 2 === 0 ? 0 : 4)) % 8;
		const mortar = py % 4 === 3 || shifted === 7;
		return [mortar ? vary([88, 88, 90], 8, r()) : vary([136, 136, 138], 14, r()), 255];
	},
	// 30: wool
	(px, py, r) => [vary((px + py) % 3 === 0 ? [248, 248, 248] : [228, 228, 230], 12, r()), 255],
	// 31: furnace top
	(px, py, r) => {
		const rim = px < 2 || py < 2 || px > 13 || py > 13;
		return [rim ? vary([74, 74, 76], 8, r()) : vary([112, 112, 114], 14, r()), 255];
	},
	// 32: furnace side
	(px, py, r) => {
		const mouth = px >= 4 && px <= 11 && py >= 6 && py <= 13;
		if (mouth) {
			if (py >= 11 && px >= 5 && px <= 10) return [vary(py === 11 ? [255, 190, 60] : [240, 120, 30], 20, r()), 255];
			return [vary([28, 28, 30], 6, r()), 255];
		}
		const edge = px === 0 || px === 15 || py === 0;
		return [edge ? vary([92, 92, 94], 8, r()) : vary(STONE, 22, r()), 255];
	},
	// 33: enchanting table top
	(px, py, r) => {
		const border = px === 0 || py === 0 || px === 15 || py === 15;
		const book = px >= 5 && px <= 10 && py >= 5 && py <= 10;
		if (book) return [px === 7 || px === 8 ? vary([230, 220, 200], 8, r()) : vary([176, 34, 44], 12, r()), 255];
		return [border ? vary([40, 16, 56], 6, r()) : vary([76, 34, 98], 14, r()), 255];
	},
	// 34: enchanting table side
	(px, py, r) => {
		if (py < 4) return [vary([76, 34, 98], 12, r()), 255];
		if (py < 6) return [(px + 1) % 4 === 0 ? vary([60, 200, 200], 10, r()) : vary([96, 232, 228], 14, r()), 255];
		return [vary([22, 14, 34], 8, r()), 255];
	},
	// 35: bed top
	(px, py, r) => {
		const pillow = py < 5 && px >= 2 && px <= 13;
		if (pillow) return [vary([238, 238, 238], 8, r()), 255];
		return [py === 5 ? vary([140, 24, 24], 8, r()) : vary([190, 40, 40], 12, r()), 255];
	},
	// 36: bed side
	(_px, py, r) => [py >= 13 ? vary([122, 90, 50], 14, r()) : vary(py === 0 ? [150, 30, 30] : [190, 40, 40], 10, r()), 255],
	// 37: farmland top
	(_px, py, r) => [py % 4 === 1 ? vary([54, 34, 18], 8, r()) : vary([88, 58, 32], 14, r()), 255],
	// 38, 39: unused
	(_px, _py, r) => [vary(STONE, 26, r()), 255],
	(_px, _py, r) => [vary(STONE, 26, r()), 255],
	// 40: obsidian-like dark
	(_px, _py, r) => [vary([24, 16, 38], 8, r()), 255],
	// 41..44: wheat stages 0..3
	wheatPainter(0), wheatPainter(1), wheatPainter(2), wheatPainter(3),
	// 45: sapling
	(px, py, r) => {
		if ((px === 7 || px === 8) && py >= 9) return [vary([100, 72, 40], 10, r()), 255];
		const d = Math.hypot(px - 7.5, py - 6);
		if (d < 4.2 && r() > 0.2) return [vary([62, 140, 50], 30, r()), 255];
		return [[0, 0, 0], 0];
	},
	// 46: tall grass
	(px, py, r) => {
		const h = hash2(px, 0, 46);
		if (h < 0.3) return [[0, 0, 0], 0];
		const height = 4 + Math.floor(h * 10);
		if (py >= 16 - height) return [vary([88, 160, 52], 30, r()), 255];
		return [[0, 0, 0], 0];
	},
	// 47: flower (poppy)
	(px, py, r) => {
		if (px === 7 && py >= 7) return [vary([60, 130, 40], 10, r()), 255];
		if ((px === 8 || px === 9) && py === 11 + (px - 8)) return [vary([60, 130, 40], 10, r()), 255];
		const d = Math.hypot(px - 7.5, py - 4.5);
		if (d < 1.2) return [[40, 20, 20], 255];
		if (d < 3.2) return [vary([212, 36, 36], 20, r()), 255];
		return [[0, 0, 0], 0];
	},
	// 48: bookshelf side
	(px, py, r) => {
		if (py < 2 || (py >= 7 && py <= 8) || py >= 14) return [vary(PLANKS, 14, r()), 255];
		const pal: Rgb[] = [[168, 48, 48], [48, 90, 160], [60, 130, 60], [190, 150, 50], [110, 60, 140], [150, 100, 60]];
		const book = pal[Math.floor(hash2(Math.floor((px + 1) / 2), py < 7 ? 0 : 1, 48) * pal.length)];
		return [px % 2 === 0 ? vary(book, 10, r()) : vary([book[0] * 0.75, book[1] * 0.75, book[2] * 0.75], 8, r()), 255];
	},
	// 49: glowstone
	(px, py, r) => {
		const n = hash2(Math.floor(px / 3), Math.floor(py / 3), 49);
		const base: Rgb = n < 0.35 ? [200, 130, 48] : n < 0.7 ? [246, 190, 80] : [255, 226, 140];
		return [vary(base, 18, r()), 255];
	},
	// 50: obsidian
	(px, py, r) => [hash2(px, py, 50) < 0.06 ? vary([70, 40, 110], 10, r()) : vary([18, 10, 28], 8, r()), 255],
	// 51: mossy cobblestone
	(px, py, r) => {
		if (hash2(Math.floor(px / 3), Math.floor(py / 3), 51) < 0.4 && r() > 0.15) return [vary([68, 120, 50], 22, r()), 255];
		const cell = ((px * 7 + py * 13) % 5 === 0);
		return [cell ? vary([80, 80, 80], 10, r()) : vary(COBBLE, 30, r()), 255];
	},
	// 52: hay bale top
	(px, py, r) => {
		const d = Math.max(Math.abs(px - 7.5), Math.abs(py - 7.5));
		return [Math.floor(d + (px > py ? 0.5 : 0)) % 2 === 0 ? vary([218, 184, 64], 16, r()) : vary([190, 152, 44], 16, r()), 255];
	},
	// 53: hay bale side
	(_px, py, r) => {
		if (py >= 6 && py <= 9) return [vary([150, 112, 34], 10, r()), 255];
		return [py % 2 === 0 ? vary([214, 178, 60], 18, r()) : vary([196, 160, 48], 18, r()), 255];
	},
	// 54: sandstone top
	(_px, _py, r) => [vary([222, 208, 160], 8, r()), 255],
	// 55: sandstone side
	(_px, py, r) => [py === 0 || py === 15 ? vary([236, 224, 178], 6, r()) : py % 5 === 0 ? vary([190, 174, 126], 8, r()) : vary([218, 204, 156], 10, r()), 255],
	// 56: clay
	(_px, _py, r) => [vary([160, 166, 180], 10, r()), 255],
	// 57: ice
	(px, py, r) => [(px + py) % 7 === 0 ? vary([210, 232, 252], 8, r()) : vary([160, 206, 246], 12, r()), 190],
	// 58: pumpkin top
	(px, py, r) => {
		if (px >= 7 && px <= 8 && py >= 6 && py <= 9) return [vary([84, 112, 40], 10, r()), 255];
		const d = Math.max(Math.abs(px - 7.5), Math.abs(py - 7.5));
		return [Math.floor(d) % 3 === 0 ? vary([190, 100, 14], 10, r()) : vary([226, 128, 24], 14, r()), 255];
	},
	// 59: pumpkin side
	(px, _py, r) => [px % 4 === 0 ? vary([164, 84, 10], 8, r()) : vary([224, 126, 24], 14, r()), 255],
	// 60: melon top
	(px, py, r) => {
		if (px >= 7 && px <= 8 && py >= 7 && py <= 8) return [vary([150, 160, 70], 8, r()), 255];
		return [Math.floor((px + py) / 3) % 2 === 0 ? vary([104, 170, 56], 12, r()) : vary([62, 120, 40], 12, r()), 255];
	},
	// 61: melon side
	(px, _py, r) => [Math.floor(px / 2) % 2 === 0 ? vary([120, 188, 64], 12, r()) : vary([62, 120, 40], 12, r()), 255],
	// 62: birch log end
	(px, py, r) => {
		const d = Math.max(Math.abs(px - 7.5), Math.abs(py - 7.5));
		return [Math.floor(d) % 2 === 0 ? vary([222, 206, 160], 12, r()) : vary([192, 172, 122], 12, r()), 255];
	},
	// 63: birch log side
	(px, py, r) => {
		if (hash2(Math.floor(px / 3), py, 63) < 0.13) return [vary([40, 40, 40], 10, r()), 255];
		return [vary([226, 226, 216], 14, r()), 255];
	},
	// 64: birch planks
	(px, py, r) => {
		const line = py % 4 === 0 || (py >= 4 && py < 8 && px === 8) || (py >= 12 && px === 3);
		return [line ? vary([170, 150, 104], 8, r()) : vary([212, 194, 144], 14, r()), 255];
	},
	// 65..69: spare
	...[0, 1, 2, 3, 4].map((): TilePainter => (_px, _py, r) => [vary(STONE, 26, r()), 255]),
	// 70..79: crack stages
	...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(crackPainter),
	// 80: smooth stone
	(_px, _py, r) => [vary([168, 168, 170], 6, r()), 255],
	// 81..83: andesite / granite / diorite
	speckled([138, 138, 134], [104, 104, 100], [168, 168, 164], 81),
	speckled([160, 110, 96], [120, 80, 70], [200, 150, 130], 82),
	speckled([200, 200, 196], [128, 128, 128], [240, 240, 238], 83),
	// 84..86: polished (縁取りあり)
	polished([148, 148, 144]), polished([170, 118, 104]), polished([212, 212, 208]),
	// 87: deepslate top
	(_px, _py, r) => [vary([76, 76, 86], 12, r()), 255],
	// 88: deepslate side (縦の筋)
	(px, _py, r) => [vary(hash2(px, 0, 88) < 0.35 ? [56, 56, 66] : [78, 78, 88], 10, r()), 255],
	// 89: deepslate bricks
	brickPainter([84, 84, 94], [38, 38, 46], 10),
	// 90: terracotta
	(_px, _py, r) => [vary([154, 92, 60], 8, r()), 255],
	// 91: dandelion
	(px, py, r) => {
		if (px === 7 && py >= 8) return [vary([60, 130, 40], 10, r()), 255];
		if (px === 8 && (py === 11 || py === 12)) return [vary([60, 130, 40], 10, r()), 255];
		if (px === 6 && py === 12) return [vary([60, 130, 40], 10, r()), 255];
		const d = Math.hypot(px - 7.5, py - 5.5);
		if (d < 1.3) return [[226, 150, 20], 255];
		if (d < 3.4) return [vary([244, 208, 40], 16, r()), 255];
		return [[0, 0, 0], 0];
	},
	// 92: chiseled stone bricks
	(px, py, r) => {
		const outer = px === 0 || py === 0 || px === 15 || py === 15;
		const frame = (px === 2 || px === 13) && py >= 2 && py <= 13 || (py === 2 || py === 13) && px >= 2 && px <= 13;
		if (outer || frame) return [vary([92, 92, 94], 8, r()), 255];
		const inner = px >= 5 && px <= 10 && py >= 5 && py <= 10;
		return [inner ? vary([150, 150, 152], 8, r()) : vary([128, 128, 130], 10, r()), 255];
	},
	// 93: mossy stone bricks
	(px, py, r) => {
		if (hash2(Math.floor(px / 3), Math.floor(py / 3), 93) < 0.4 && r() > 0.15) return [vary([72, 122, 52], 22, r()), 255];
		return brickPainter([136, 136, 138], [88, 88, 90], 14)(px, py, r);
	},
	// 94: smooth sandstone
	(_px, _py, r) => [vary([226, 212, 164], 6, r()), 255],
	// 95: spruce log end
	(px, py, r) => {
		const d = Math.max(Math.abs(px - 7.5), Math.abs(py - 7.5));
		return [Math.floor(d) % 2 === 0 ? vary([124, 92, 56], 12, r()) : vary([86, 62, 36], 12, r()), 255];
	},
	// 96: spruce log side
	(px, _py, r) => [px % 4 === 0 ? vary([50, 34, 20], 8, r()) : vary([76, 54, 32], 16, r()), 255],
	// 97: spruce planks
	(px, py, r) => {
		const line = py % 4 === 0 || (py >= 4 && py < 8 && px === 8) || (py >= 12 && px === 3);
		return [line ? vary([86, 60, 32], 8, r()) : vary([122, 90, 52], 14, r()), 255];
	},
	// 98: barrel top
	(px, py, r) => {
		const d = Math.max(Math.abs(px - 7.5), Math.abs(py - 7.5));
		if (d > 6.5) return [vary([84, 60, 32], 8, r()), 255];
		return [d < 4.5 ? vary([104, 76, 42], 12, r()) : vary([152, 114, 68], 14, r()), 255];
	},
	// 99: barrel side (縦の板 + 金具 2 本)
	(px, py, r) => {
		if (py === 3 || py === 4 || py === 11 || py === 12) return [vary([92, 92, 98], 8, r()), 255];
		return [px % 4 === 0 ? vary([100, 72, 40], 8, r()) : vary([152, 114, 68], 14, r()), 255];
	},
	// 100: chest top
	(px, py, r) => {
		const edge = px === 0 || py === 0 || px === 15 || py === 15;
		if (edge) return [vary([86, 56, 26], 8, r()), 255];
		if (px >= 7 && px <= 8 && py >= 13) return [vary([200, 200, 210], 8, r()), 255];
		return [vary([146, 100, 50], 14, r()), 255];
	},
	// 101: chest side
	(px, py, r) => {
		const frame = px === 0 || px === 15 || py === 0 || py === 15 || py === 6 || py === 7;
		if (px >= 7 && px <= 8 && py >= 5 && py <= 9) return [vary([200, 200, 210], 8, r()), 255];
		if (frame) return [vary([86, 56, 26], 8, r()), 255];
		return [vary([156, 108, 58], 14, r()), 255];
	},
	// 102: lantern (外側は透明。フラットな見た目でも形が分かる)
	(px, py, r) => {
		const iron: Rgb = [58, 58, 64];
		if ((px === 7 || px === 8) && py >= 2 && py <= 4) return [vary(iron, 6, r()), 255];
		if (py >= 5 && py <= 8 && px >= 5 && px <= 10) return [vary(iron, 8, r()), 255];
		if (py >= 9 && py <= 15 && px >= 5 && px <= 10) {
			const frame = px === 5 || px === 10 || py === 9 || py === 15;
			return [frame ? vary(iron, 8, r()) : vary([252, 222, 110], 16, r()), 255];
		}
		return [[0, 0, 0], 0];
	},
	// 103: iron bars (2px の棒が 4px おき。間は透明)
	(px, _py, r) => (px % 4 === 3 || px % 4 === 0 ? [vary([150, 150, 156], 12, r()), 255] : [[0, 0, 0], 0]),
	// 104: unused
	(_px, _py, r) => [vary(STONE, 26, r()), 255],
	// 105..115: wool
	...([[176, 58, 46], [230, 196, 58], [53, 71, 155], [79, 122, 42], [32, 32, 32], [110, 110, 110], [224, 121, 42], [122, 58, 160], [232, 160, 184], [116, 182, 224], [128, 197, 53]] as Rgb[]).map(woolPainter),
	// 116..123: concrete (つや消しで平ら)
	...([[216, 216, 216], [90, 90, 90], [20, 20, 20], [156, 42, 38], [44, 63, 143], [76, 107, 35], [229, 181, 58], [217, 115, 30]] as Rgb[]).map(concretePainter),
	// 124: door lower
	(px, py, r) => {
		const frame = px <= 1 || px >= 14 || py >= 14 || py === 0;
		if (px >= 11 && px <= 12 && py >= 7 && py <= 8) return [vary([220, 190, 90], 8, r()), 255];
		if (frame) return [vary([108, 78, 40], 8, r()), 255];
		const panel = (px === 3 || px === 12) && py >= 2 && py <= 12 || (py === 2 || py === 12) && px >= 3 && px <= 12;
		return [panel ? vary([120, 88, 48], 8, r()) : vary([170, 130, 78], 14, r()), 255];
	},
	// 125: door upper
	(px, py, r) => {
		const frame = px <= 1 || px >= 14 || py === 0 || py === 15;
		if (px >= 5 && px <= 10 && py >= 3 && py <= 8) {
			const rim = px === 5 || px === 10 || py === 3 || py === 8;
			return [rim ? vary([108, 78, 40], 8, r()) : vary([186, 224, 238], 10, r()), 255];
		}
		if (frame) return [vary([108, 78, 40], 8, r()), 255];
		return [vary([170, 130, 78], 14, r()), 255];
	},
	// 126: flower pot (箱は x5..10, 下から 6/16 の部分を使う)
	(px, py, r) => [py === 10 || py === 11 ? (px >= 4 && px <= 11 ? vary([186, 104, 72], 8, r()) : vary([150, 80, 54], 8, r())) : vary([156, 82, 54], 10, r()), 255],
	// 127: spare
	(_px, _py, r) => [vary(STONE, 26, r()), 255],
];

const tileAverages: Rgb[] = [];

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
		let sr = 0, sg = 0, sb = 0, sa = 0;
		for (let py = 0; py < size; py++) {
			for (let px = 0; px < size; px++) {
				const [c, a] = painter(px, py, r);
				put(image.data, ((py * canvas.width) + tile * size + px) * 4, c, a);
				sr += c[0] * a; sg += c[1] * a; sb += c[2] * a; sa += a;
			}
		}
		tileAverages[tile] = sa > 0 ? [Math.round(sr / sa), Math.round(sg / sa), Math.round(sb / sa)] : [128, 128, 128];
	}
	ctx.putImageData(image, 0, 0);
	return canvas;
}

let atlasCache: HTMLCanvasElement | null = null;

/** buildAtlas() の結果を使い回す (アイコン描画など他モジュールが共有する) */
export function getAtlasCanvas(): HTMLCanvasElement {
	atlasCache ??= buildAtlas();
	return atlasCache;
}

/** タイルの不透明部分の平均色 (パーティクル用)。atlas を作ってから返す */
export function tileAverageColor(tile: number): [number, number, number] {
	getAtlasCanvas();
	const c = tileAverages[tile] ?? [128, 128, 128];
	return [c[0], c[1], c[2]];
}
