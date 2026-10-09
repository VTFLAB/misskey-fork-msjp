/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Misskey Craft (bsky-fork original) のワールド定数。
 * backend の `core/CraftService.ts` の CRAFT_WORLD と同じ値を持つ。
 */
export const WORLD = {
	minX: -128,
	maxX: 127,
	minY: 0,
	maxY: 63,
	minZ: -128,
	maxZ: 127,
	sizeX: 256,
	sizeY: 64,
	sizeZ: 256,
	chunkSize: 16,
	seaLevel: 24,
} as const;

export const BLOCK = {
	air: 0,
	grass: 1,
	dirt: 2,
	stone: 3,
	sand: 4,
	water: 5,
	log: 6,
	leaves: 7,
	planks: 8,
	bricks: 9,
	cobblestone: 10,
	glass: 11,
	lamp: 12,
} as const;

export type BlockId = typeof BLOCK[keyof typeof BLOCK];

export type BlockDef = {
	id: BlockId;
	key: 'grass' | 'dirt' | 'stone' | 'sand' | 'water' | 'log' | 'leaves' | 'planks' | 'bricks' | 'cobblestone' | 'glass' | 'lamp';
	/** 隣接面を省略しない (葉・ガラス・水) */
	transparent: boolean;
	/** 半透明でブレンド描画する (水・ガラス) */
	translucent: boolean;
	/** 当たり判定を持つ */
	solid: boolean;
	/** 光を放つ (ランプ) */
	emissive: boolean;
	/** テクスチャアトラス内のタイル番号 [top, side, bottom] */
	tiles: [number, number, number];
	/** 手持ちバー・プレビューに使う代表色 */
	color: string;
};

export const BLOCK_DEFS: Record<number, BlockDef> = {
	[BLOCK.grass]: { id: BLOCK.grass, key: 'grass', transparent: false, translucent: false, solid: true, emissive: false, tiles: [0, 1, 2], color: '#6cae3e' },
	[BLOCK.dirt]: { id: BLOCK.dirt, key: 'dirt', transparent: false, translucent: false, solid: true, emissive: false, tiles: [2, 2, 2], color: '#8b5a2b' },
	[BLOCK.stone]: { id: BLOCK.stone, key: 'stone', transparent: false, translucent: false, solid: true, emissive: false, tiles: [3, 3, 3], color: '#8a8a8a' },
	[BLOCK.sand]: { id: BLOCK.sand, key: 'sand', transparent: false, translucent: false, solid: true, emissive: false, tiles: [4, 4, 4], color: '#dcd3a0' },
	[BLOCK.water]: { id: BLOCK.water, key: 'water', transparent: true, translucent: true, solid: false, emissive: false, tiles: [5, 5, 5], color: '#3b6fd8' },
	[BLOCK.log]: { id: BLOCK.log, key: 'log', transparent: false, translucent: false, solid: true, emissive: false, tiles: [6, 7, 6], color: '#7a5a34' },
	[BLOCK.leaves]: { id: BLOCK.leaves, key: 'leaves', transparent: true, translucent: false, solid: true, emissive: false, tiles: [8, 8, 8], color: '#3f8a2f' },
	[BLOCK.planks]: { id: BLOCK.planks, key: 'planks', transparent: false, translucent: false, solid: true, emissive: false, tiles: [9, 9, 9], color: '#b48c5a' },
	[BLOCK.bricks]: { id: BLOCK.bricks, key: 'bricks', transparent: false, translucent: false, solid: true, emissive: false, tiles: [10, 10, 10], color: '#a04b3a' },
	[BLOCK.cobblestone]: { id: BLOCK.cobblestone, key: 'cobblestone', transparent: false, translucent: false, solid: true, emissive: false, tiles: [11, 11, 11], color: '#6f6f6f' },
	[BLOCK.glass]: { id: BLOCK.glass, key: 'glass', transparent: true, translucent: true, solid: true, emissive: false, tiles: [12, 12, 12], color: '#c8e8f0' },
	[BLOCK.lamp]: { id: BLOCK.lamp, key: 'lamp', transparent: false, translucent: false, solid: true, emissive: true, tiles: [13, 13, 13], color: '#f6d76b' },
};

/** 手持ちバーに並ぶ順 */
export const HOTBAR_BLOCKS: BlockId[] = [
	BLOCK.grass, BLOCK.dirt, BLOCK.stone, BLOCK.cobblestone, BLOCK.sand,
	BLOCK.log, BLOCK.planks, BLOCK.leaves, BLOCK.bricks, BLOCK.glass, BLOCK.lamp, BLOCK.water,
];

export const ATLAS_TILE_COUNT = 16;
export const ATLAS_TILE_PX = 16;

export function isSolid(id: number): boolean {
	const def = BLOCK_DEFS[id];
	return def != null && def.solid;
}

export function isTransparent(id: number): boolean {
	if (id === BLOCK.air) return true;
	const def = BLOCK_DEFS[id];
	return def == null || def.transparent;
}
