/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Misskey Craft (bsky-fork original) の共有定数。
 * backend の `core/CraftService.ts` の CRAFT_WORLD と値を揃えること
 * (高さ、座標上限、ブロック種別の最大値)。
 */
export const WORLD = {
	minY: 0,
	maxY: 95,
	sizeY: 96,
	chunkSize: 16,
	seaLevel: 32,
	/** x / z の絶対値の上限 (サーバーと同じ) */
	maxCoord: 1000000,
	/** 描画距離 (chunk) */
	renderDistance: 8,
	/** ブロックデータを保持する距離 (chunk)。これより遠い chunk は破棄し、必要時に再生成する */
	keepDistance: 20,
} as const;

/** 昼夜サイクル。Date.now() 基準なので全クライアントで一致する */
export const DAY_LENGTH_MS = 20 * 60 * 1000;

/** 0..1 の一日の時刻。0 = 朝 6 時相当、0.5 = 夕方 */
export function timeOfDay(now = Date.now()): number {
	return (now % DAY_LENGTH_MS) / DAY_LENGTH_MS;
}

/** 0.12 (真夜中) .. 1 (昼) の空の明るさ */
export function daylight(now = Date.now()): number {
	const t = timeOfDay(now);
	// 0.0-0.45 昼、0.45-0.55 夕暮れ、0.55-0.95 夜、0.95-1.0 夜明け
	if (t < 0.45) return 1;
	if (t < 0.55) return 1 - (t - 0.45) / 0.1 * 0.88;
	if (t < 0.95) return 0.12;
	return 0.12 + (t - 0.95) / 0.05 * 0.88;
}

export function isNight(now = Date.now()): boolean {
	const t = timeOfDay(now);
	return t >= 0.52 && t < 0.97;
}

// ----- ブロック -----

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
	snow: 13,
	cactus: 14,
	coalOre: 15,
	ironOre: 16,
	bedrock: 17,
	craftingTable: 18,
	gravel: 19,
} as const;

export type BlockId = typeof BLOCK[keyof typeof BLOCK];
export const MAX_BLOCK_TYPE = 19;

export type ToolKind = 'none' | 'pickaxe' | 'sword';
/** 0: 素手, 1: 木, 2: 石, 3: 鉄 */
export type ToolTier = 0 | 1 | 2 | 3;

export type BlockDef = {
	id: BlockId;
	key: 'grass' | 'dirt' | 'stone' | 'sand' | 'water' | 'log' | 'leaves' | 'planks' | 'bricks' | 'cobblestone' | 'glass' | 'lamp' | 'snow' | 'cactus' | 'coalOre' | 'ironOre' | 'bedrock' | 'craftingTable' | 'gravel';
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
	/** 手持ちバー・ミニマップに使う代表色 */
	color: string;
	/** 素手で壊すのにかかる秒数。Infinity は壊せない */
	hardness: number;
	/** 効率よく壊せる道具 */
	tool: ToolKind;
	/** ドロップに必要な道具の最低ティア (0 なら素手でもドロップ) */
	minTier: ToolTier;
	/** 壊したときに手に入るアイテム (null は何も落とさない) */
	drops: number | null;
	/** プレイヤーが置けるか */
	placeable: boolean;
	/** 触れるとダメージ (サボテン) */
	damaging?: boolean;
};

const b = (def: BlockDef) => def;

export const BLOCK_DEFS: Record<number, BlockDef> = {
	[BLOCK.grass]: b({ id: BLOCK.grass, key: 'grass', transparent: false, translucent: false, solid: true, emissive: false, tiles: [0, 1, 2], color: '#6cae3e', hardness: 0.9, tool: 'none', minTier: 0, drops: BLOCK.dirt, placeable: true }),
	[BLOCK.dirt]: b({ id: BLOCK.dirt, key: 'dirt', transparent: false, translucent: false, solid: true, emissive: false, tiles: [2, 2, 2], color: '#8b5a2b', hardness: 0.75, tool: 'none', minTier: 0, drops: BLOCK.dirt, placeable: true }),
	[BLOCK.stone]: b({ id: BLOCK.stone, key: 'stone', transparent: false, translucent: false, solid: true, emissive: false, tiles: [3, 3, 3], color: '#8a8a8a', hardness: 7.5, tool: 'pickaxe', minTier: 1, drops: BLOCK.cobblestone, placeable: true }),
	[BLOCK.sand]: b({ id: BLOCK.sand, key: 'sand', transparent: false, translucent: false, solid: true, emissive: false, tiles: [4, 4, 4], color: '#dcd3a0', hardness: 0.75, tool: 'none', minTier: 0, drops: BLOCK.sand, placeable: true }),
	[BLOCK.water]: b({ id: BLOCK.water, key: 'water', transparent: true, translucent: true, solid: false, emissive: false, tiles: [5, 5, 5], color: '#3b6fd8', hardness: Infinity, tool: 'none', minTier: 0, drops: null, placeable: false }),
	[BLOCK.log]: b({ id: BLOCK.log, key: 'log', transparent: false, translucent: false, solid: true, emissive: false, tiles: [6, 7, 6], color: '#7a5a34', hardness: 3, tool: 'none', minTier: 0, drops: BLOCK.log, placeable: true }),
	[BLOCK.leaves]: b({ id: BLOCK.leaves, key: 'leaves', transparent: true, translucent: false, solid: true, emissive: false, tiles: [8, 8, 8], color: '#3f8a2f', hardness: 0.35, tool: 'none', minTier: 0, drops: null, placeable: true }),
	[BLOCK.planks]: b({ id: BLOCK.planks, key: 'planks', transparent: false, translucent: false, solid: true, emissive: false, tiles: [9, 9, 9], color: '#b48c5a', hardness: 3, tool: 'none', minTier: 0, drops: BLOCK.planks, placeable: true }),
	[BLOCK.bricks]: b({ id: BLOCK.bricks, key: 'bricks', transparent: false, translucent: false, solid: true, emissive: false, tiles: [10, 10, 10], color: '#a04b3a', hardness: 10, tool: 'pickaxe', minTier: 1, drops: BLOCK.bricks, placeable: true }),
	[BLOCK.cobblestone]: b({ id: BLOCK.cobblestone, key: 'cobblestone', transparent: false, translucent: false, solid: true, emissive: false, tiles: [11, 11, 11], color: '#6f6f6f', hardness: 10, tool: 'pickaxe', minTier: 1, drops: BLOCK.cobblestone, placeable: true }),
	[BLOCK.glass]: b({ id: BLOCK.glass, key: 'glass', transparent: true, translucent: true, solid: true, emissive: false, tiles: [12, 12, 12], color: '#c8e8f0', hardness: 0.45, tool: 'none', minTier: 0, drops: null, placeable: true }),
	[BLOCK.lamp]: b({ id: BLOCK.lamp, key: 'lamp', transparent: false, translucent: false, solid: true, emissive: true, tiles: [13, 13, 13], color: '#f6d76b', hardness: 0.45, tool: 'none', minTier: 0, drops: BLOCK.lamp, placeable: true }),
	[BLOCK.snow]: b({ id: BLOCK.snow, key: 'snow', transparent: false, translucent: false, solid: true, emissive: false, tiles: [14, 15, 2], color: '#f0f4f8', hardness: 0.3, tool: 'none', minTier: 0, drops: BLOCK.dirt, placeable: true }),
	[BLOCK.cactus]: b({ id: BLOCK.cactus, key: 'cactus', transparent: true, translucent: false, solid: true, emissive: false, tiles: [16, 17, 16], color: '#4f8a3a', hardness: 0.6, tool: 'none', minTier: 0, drops: BLOCK.cactus, placeable: true, damaging: true }),
	[BLOCK.coalOre]: b({ id: BLOCK.coalOre, key: 'coalOre', transparent: false, translucent: false, solid: true, emissive: false, tiles: [18, 18, 18], color: '#4a4a4a', hardness: 15, tool: 'pickaxe', minTier: 1, drops: 101, placeable: true }),
	[BLOCK.ironOre]: b({ id: BLOCK.ironOre, key: 'ironOre', transparent: false, translucent: false, solid: true, emissive: false, tiles: [19, 19, 19], color: '#b89a7a', hardness: 15, tool: 'pickaxe', minTier: 2, drops: 102, placeable: true }),
	[BLOCK.bedrock]: b({ id: BLOCK.bedrock, key: 'bedrock', transparent: false, translucent: false, solid: true, emissive: false, tiles: [20, 20, 20], color: '#2a2a2a', hardness: Infinity, tool: 'none', minTier: 0, drops: null, placeable: false }),
	[BLOCK.craftingTable]: b({ id: BLOCK.craftingTable, key: 'craftingTable', transparent: false, translucent: false, solid: true, emissive: false, tiles: [21, 22, 9], color: '#9c6b3c', hardness: 3.75, tool: 'none', minTier: 0, drops: BLOCK.craftingTable, placeable: true }),
	[BLOCK.gravel]: b({ id: BLOCK.gravel, key: 'gravel', transparent: false, translucent: false, solid: true, emissive: false, tiles: [23, 23, 23], color: '#8d8477', hardness: 0.9, tool: 'none', minTier: 0, drops: BLOCK.gravel, placeable: true }),
};

export const ATLAS_TILE_COUNT = 32;
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

// ----- アイテム -----

/** ブロックはそのままアイテム id として使う (1..19)。道具・素材は 100 以降 */
export const ITEM = {
	stick: 100,
	coal: 101,
	rawIron: 102,
	ironIngot: 103,
	apple: 104,
	rawMeat: 105,
	cookedMeat: 106,
	woodenPickaxe: 110,
	stonePickaxe: 111,
	ironPickaxe: 112,
	woodenSword: 120,
	stoneSword: 121,
	ironSword: 122,
} as const;

export type ItemKey = BlockDef['key'] | 'stick' | 'coal' | 'rawIron' | 'ironIngot' | 'apple' | 'rawMeat' | 'cookedMeat' | 'woodenPickaxe' | 'stonePickaxe' | 'ironPickaxe' | 'woodenSword' | 'stoneSword' | 'ironSword';

export type ItemDef = {
	id: number;
	key: ItemKey;
	kind: 'block' | 'material' | 'tool' | 'food';
	maxStack: number;
	/** アイコン・ミニマップ用の代表色 */
	color: string;
	tool?: {
		kind: ToolKind;
		tier: ToolTier;
		/** 採掘速度の倍率 (素手 1) */
		speed: number;
		/** 攻撃力 (素手 1) */
		attack: number;
	};
	/** 食べたときに回復する空腹度 */
	food?: number;
};

export const ITEM_DEFS: Record<number, ItemDef> = {
	...Object.fromEntries(Object.values(BLOCK_DEFS).map(def => [def.id, {
		id: def.id, key: def.key, kind: 'block', maxStack: 64, color: def.color,
	} satisfies ItemDef])),
	[ITEM.stick]: { id: ITEM.stick, key: 'stick', kind: 'material', maxStack: 64, color: '#8a6a3c' },
	[ITEM.coal]: { id: ITEM.coal, key: 'coal', kind: 'material', maxStack: 64, color: '#2b2b2b' },
	[ITEM.rawIron]: { id: ITEM.rawIron, key: 'rawIron', kind: 'material', maxStack: 64, color: '#c9a98a' },
	[ITEM.ironIngot]: { id: ITEM.ironIngot, key: 'ironIngot', kind: 'material', maxStack: 64, color: '#d8d8d8' },
	[ITEM.apple]: { id: ITEM.apple, key: 'apple', kind: 'food', maxStack: 64, color: '#d33a2f', food: 4 },
	[ITEM.rawMeat]: { id: ITEM.rawMeat, key: 'rawMeat', kind: 'food', maxStack: 64, color: '#d9716a', food: 3 },
	[ITEM.cookedMeat]: { id: ITEM.cookedMeat, key: 'cookedMeat', kind: 'food', maxStack: 64, color: '#8c4a2b', food: 8 },
	[ITEM.woodenPickaxe]: { id: ITEM.woodenPickaxe, key: 'woodenPickaxe', kind: 'tool', maxStack: 1, color: '#b48c5a', tool: { kind: 'pickaxe', tier: 1, speed: 2, attack: 2 } },
	[ITEM.stonePickaxe]: { id: ITEM.stonePickaxe, key: 'stonePickaxe', kind: 'tool', maxStack: 1, color: '#8a8a8a', tool: { kind: 'pickaxe', tier: 2, speed: 4, attack: 3 } },
	[ITEM.ironPickaxe]: { id: ITEM.ironPickaxe, key: 'ironPickaxe', kind: 'tool', maxStack: 1, color: '#d8d8d8', tool: { kind: 'pickaxe', tier: 3, speed: 6, attack: 4 } },
	[ITEM.woodenSword]: { id: ITEM.woodenSword, key: 'woodenSword', kind: 'tool', maxStack: 1, color: '#b48c5a', tool: { kind: 'sword', tier: 1, speed: 1, attack: 4 } },
	[ITEM.stoneSword]: { id: ITEM.stoneSword, key: 'stoneSword', kind: 'tool', maxStack: 1, color: '#8a8a8a', tool: { kind: 'sword', tier: 2, speed: 1, attack: 5 } },
	[ITEM.ironSword]: { id: ITEM.ironSword, key: 'ironSword', kind: 'tool', maxStack: 1, color: '#d8d8d8', tool: { kind: 'sword', tier: 3, speed: 1, attack: 6 } },
};

export function isBlockItem(id: number): boolean {
	return id >= 1 && id <= MAX_BLOCK_TYPE && BLOCK_DEFS[id]?.placeable === true;
}

// ----- クラフト -----

export type Recipe = {
	key: string;
	result: { id: number; count: number };
	ingredients: { id: number; count: number }[];
	/** 作業台の近く (3 ブロック以内) でないと作れない */
	needsTable: boolean;
};

export const RECIPES: Recipe[] = [
	{ key: 'planks', result: { id: BLOCK.planks, count: 4 }, ingredients: [{ id: BLOCK.log, count: 1 }], needsTable: false },
	{ key: 'stick', result: { id: ITEM.stick, count: 4 }, ingredients: [{ id: BLOCK.planks, count: 2 }], needsTable: false },
	{ key: 'craftingTable', result: { id: BLOCK.craftingTable, count: 1 }, ingredients: [{ id: BLOCK.planks, count: 4 }], needsTable: false },
	{ key: 'cookedMeat', result: { id: ITEM.cookedMeat, count: 1 }, ingredients: [{ id: ITEM.rawMeat, count: 1 }, { id: ITEM.coal, count: 1 }], needsTable: false },
	{ key: 'woodenPickaxe', result: { id: ITEM.woodenPickaxe, count: 1 }, ingredients: [{ id: BLOCK.planks, count: 3 }, { id: ITEM.stick, count: 2 }], needsTable: true },
	{ key: 'stonePickaxe', result: { id: ITEM.stonePickaxe, count: 1 }, ingredients: [{ id: BLOCK.cobblestone, count: 3 }, { id: ITEM.stick, count: 2 }], needsTable: true },
	{ key: 'ironPickaxe', result: { id: ITEM.ironPickaxe, count: 1 }, ingredients: [{ id: ITEM.ironIngot, count: 3 }, { id: ITEM.stick, count: 2 }], needsTable: true },
	{ key: 'woodenSword', result: { id: ITEM.woodenSword, count: 1 }, ingredients: [{ id: BLOCK.planks, count: 2 }, { id: ITEM.stick, count: 1 }], needsTable: true },
	{ key: 'stoneSword', result: { id: ITEM.stoneSword, count: 1 }, ingredients: [{ id: BLOCK.cobblestone, count: 2 }, { id: ITEM.stick, count: 1 }], needsTable: true },
	{ key: 'ironSword', result: { id: ITEM.ironSword, count: 1 }, ingredients: [{ id: ITEM.ironIngot, count: 2 }, { id: ITEM.stick, count: 1 }], needsTable: true },
	{ key: 'ironIngot', result: { id: ITEM.ironIngot, count: 1 }, ingredients: [{ id: ITEM.rawIron, count: 1 }, { id: ITEM.coal, count: 1 }], needsTable: true },
	{ key: 'glass', result: { id: BLOCK.glass, count: 1 }, ingredients: [{ id: BLOCK.sand, count: 1 }, { id: ITEM.coal, count: 1 }], needsTable: true },
	{ key: 'lamp', result: { id: BLOCK.lamp, count: 1 }, ingredients: [{ id: BLOCK.glass, count: 1 }, { id: ITEM.coal, count: 1 }, { id: ITEM.stick, count: 1 }], needsTable: true },
	{ key: 'bricks', result: { id: BLOCK.bricks, count: 4 }, ingredients: [{ id: BLOCK.cobblestone, count: 4 }], needsTable: true },
	{ key: 'stone', result: { id: BLOCK.stone, count: 1 }, ingredients: [{ id: BLOCK.cobblestone, count: 1 }, { id: ITEM.coal, count: 1 }], needsTable: true },
];

// ----- プレイヤー -----

export const PLAYER = {
	width: 0.6,
	height: 1.8,
	eyeHeight: 1.62,
	reach: 5,
	maxHealth: 20,
	maxHunger: 20,
	/** 水中で息が続く秒数 */
	maxAir: 12,
	inventorySize: 36,
	hotbarSize: 9,
} as const;

// ----- バイオーム -----

export const BIOME = {
	ocean: 0,
	plains: 1,
	forest: 2,
	desert: 3,
	taiga: 4,
	mountains: 5,
} as const;

export type BiomeId = typeof BIOME[keyof typeof BIOME];

export type BiomeDef = {
	id: BiomeId;
	key: 'ocean' | 'plains' | 'forest' | 'desert' | 'taiga' | 'mountains';
	/** ミニマップ用の色 */
	color: string;
};

export const BIOME_DEFS: Record<number, BiomeDef> = {
	[BIOME.ocean]: { id: BIOME.ocean, key: 'ocean', color: '#3b6fd8' },
	[BIOME.plains]: { id: BIOME.plains, key: 'plains', color: '#7cc24a' },
	[BIOME.forest]: { id: BIOME.forest, key: 'forest', color: '#3f8a2f' },
	[BIOME.desert]: { id: BIOME.desert, key: 'desert', color: '#dcd3a0' },
	[BIOME.taiga]: { id: BIOME.taiga, key: 'taiga', color: '#dfe8ee' },
	[BIOME.mountains]: { id: BIOME.mountains, key: 'mountains', color: '#8a8a8a' },
};

// ----- MOB -----

export const MOB = {
	zombie: 'zombie',
	wolf: 'wolf',
	bear: 'bear',
} as const;

export type MobType = typeof MOB[keyof typeof MOB];

export type MobDef = {
	type: MobType;
	maxHp: number;
	/** 歩く速さ (ブロック/秒) */
	speed: number;
	/** 1 回の攻撃のダメージ */
	attack: number;
	/** 攻撃の間隔 (秒) */
	attackInterval: number;
	/** 当たり判定の幅と高さ */
	width: number;
	height: number;
	/** この距離以内のプレイヤーを追う */
	aggroRange: number;
	/** 夜だけ湧く */
	nightOnly: boolean;
	/** 湧くバイオーム (空なら全部) */
	biomes: BiomeId[];
	/** 同時に存在できる数 (ホストあたり) */
	cap: number;
	/** 倒したときのドロップ */
	drops: { id: number; count: number } | null;
	color: string;
};

export const MOB_DEFS: Record<MobType, MobDef> = {
	zombie: { type: 'zombie', maxHp: 20, speed: 2.4, attack: 3, attackInterval: 1.2, width: 0.6, height: 1.9, aggroRange: 18, nightOnly: true, biomes: [], cap: 8, drops: null, color: '#5c8f4a' },
	wolf: { type: 'wolf', maxHp: 8, speed: 5, attack: 2, attackInterval: 0.8, width: 0.6, height: 0.85, aggroRange: 12, nightOnly: false, biomes: [BIOME.forest, BIOME.taiga], cap: 4, drops: { id: ITEM.rawMeat, count: 1 }, color: '#b8b8b8' },
	bear: { type: 'bear', maxHp: 30, speed: 3.2, attack: 6, attackInterval: 1.5, width: 1.2, height: 1.3, aggroRange: 10, nightOnly: false, biomes: [BIOME.forest, BIOME.mountains, BIOME.taiga], cap: 2, drops: { id: ITEM.rawMeat, count: 3 }, color: '#5a3b22' },
};
