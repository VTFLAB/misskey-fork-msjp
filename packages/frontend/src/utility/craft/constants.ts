/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Misskey Craft (bsky-fork original) の共有定数。
 * backend の `core/CraftService.ts` の CRAFT_WORLD と値を揃えること
 * (高さ、座標上限。ブロック種別の上限はサーバーが 127 まで受け付け、実在する id はここで決める)。
 *
 * 数値は Minecraft の仕様書を参考にしつつ、ブラウザで軽く動かすために簡略化している。
 */
export const WORLD = {
	minY: 0,
	maxY: 95,
	sizeY: 96,
	chunkSize: 16,
	seaLevel: 32,
	/** x / z の絶対値の上限 (サーバーと同じ) */
	maxCoord: 1000000,
	/** 描画距離 (chunk)。設定で 4..12 に変えられる */
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
	goldOre: 20,
	diamondOre: 21,
	lapisOre: 22,
	torch: 23,
	ladder: 24,
	stoneBricks: 25,
	wool: 26,
	furnace: 27,
	enchantingTable: 28,
	bed: 29,
	farmland: 30,
	wheat0: 31,
	wheat1: 32,
	wheat2: 33,
	wheat3: 34,
	sapling: 35,
	tallGrass: 36,
	flower: 37,
	bookshelf: 38,
	glowstone: 39,
	obsidian: 40,
	mossyCobblestone: 41,
	hayBale: 42,
	sandstone: 43,
	clay: 44,
	ice: 45,
	pumpkin: 46,
	melon: 47,
	birchLog: 48,
	birchPlanks: 49,
} as const;

export type BlockKey = keyof typeof BLOCK;
export type BlockId = typeof BLOCK[keyof typeof BLOCK];
export const MAX_BLOCK_TYPE = 49;

export type ToolKind = 'none' | 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword';
/** 0: 素手, 1: 木 (と金), 2: 石, 3: 鉄, 4: ダイヤ */
export type ToolTier = 0 | 1 | 2 | 3 | 4;

/** メッシュの形。cube 以外は当たり判定を持たない (solid: false) */
export type BlockShape = 'cube' | 'cross' | 'torch' | 'ladder' | 'bed' | 'farmland';

export type SoundMaterialId = 'stone' | 'wood' | 'gravel' | 'grass' | 'sand' | 'snow' | 'glass' | 'wool' | 'metal' | 'crop' | 'water' | 'none';

export type BlockDef = {
	id: BlockId;
	key: Exclude<BlockKey, 'air'>;
	shape: BlockShape;
	/** 隣接面を省略しない (葉・ガラス・水・十字型) */
	transparent: boolean;
	/** 半透明でブレンド描画する (水・ガラス・氷) */
	translucent: boolean;
	/** 当たり判定を持つ */
	solid: boolean;
	/** 放つ光 (0..15)。松明 14、グロウストーン 15 */
	light: number;
	/** 光をどれだけ遮るか (0..15)。不透明な立方体は 15 */
	opacity: number;
	/** テクスチャアトラス内のタイル番号 [top, side, bottom] */
	tiles: [number, number, number];
	/** 手持ちバー・ミニマップに使う代表色 */
	color: string;
	/** 硬さ (Minecraft の値)。Infinity は壊せない。採掘時間は mining.ts の式で決まる */
	hardness: number;
	/** 効率よく壊せる道具 */
	tool: ToolKind;
	/** ドロップに必要な道具の最低ティア (0 なら素手でもドロップ) */
	minTier: ToolTier;
	/** 壊したときに手に入るアイテム (null は何も落とさない)。count は省略時 1 */
	drops: { id: number; count?: number; chance?: number } | null;
	/** シルクタッチで壊すと自分自身が落ちる (ガラス・葉・鉱石など) */
	silk?: boolean;
	/** 幸運で個数が増える鉱石 */
	fortune?: boolean;
	/** 壊したときの経験値 [min, max] */
	xp?: [number, number];
	/** プレイヤーが置けるか */
	placeable: boolean;
	/** 触れるとダメージ (サボテン) */
	damaging?: boolean;
	/** 上を歩くと滑る (氷) */
	slippery?: boolean;
	/** 登れる (はしご) */
	climbable?: boolean;
	/** 設置時に他のブロックが置き換えてよい (草・花) */
	replaceable?: boolean;
	/** 設置に必要な支え。below: 下が固体 (作物は耕地)、wall: 置く面が壁 */
	support?: 'below' | 'wall' | 'farmland';
	/** ランダム tick で次に育つブロック */
	growsTo?: BlockId;
	/** 足音・破壊音 */
	sound: SoundMaterialId;
	/** 作業台・かまど・エンチャント台・ベッドのように右クリックで使う */
	usable?: boolean;
	/** 燃料として使えるとき、何回分 */
	fuel?: number;
};

const b = (def: BlockDef) => def;

const cube = (id: BlockId, key: Exclude<BlockKey, 'air'>, tiles: [number, number, number], color: string, hardness: number, tool: ToolKind, minTier: ToolTier, drops: BlockDef['drops'], sound: SoundMaterialId, extra: Partial<BlockDef> = {}): BlockDef =>
	b({ id, key, shape: 'cube', transparent: false, translucent: false, solid: true, light: 0, opacity: 15, tiles, color, hardness, tool, minTier, drops, placeable: true, sound, ...extra });

const plant = (id: BlockId, key: Exclude<BlockKey, 'air'>, tile: number, color: string, drops: BlockDef['drops'], extra: Partial<BlockDef> = {}): BlockDef =>
	b({ id, key, shape: 'cross', transparent: true, translucent: false, solid: false, light: 0, opacity: 0, tiles: [tile, tile, tile], color, hardness: 0, tool: 'none', minTier: 0, drops, placeable: true, sound: 'grass', support: 'below', ...extra });

export const BLOCK_DEFS: Record<number, BlockDef> = {
	[BLOCK.grass]: cube(BLOCK.grass, 'grass', [0, 1, 2], '#6cae3e', 0.6, 'shovel', 0, { id: BLOCK.dirt }, 'grass', { silk: true }),
	[BLOCK.dirt]: cube(BLOCK.dirt, 'dirt', [2, 2, 2], '#8b5a2b', 0.5, 'shovel', 0, { id: BLOCK.dirt }, 'gravel'),
	[BLOCK.stone]: cube(BLOCK.stone, 'stone', [3, 3, 3], '#8a8a8a', 1.5, 'pickaxe', 1, { id: BLOCK.cobblestone }, 'stone', { silk: true }),
	[BLOCK.sand]: cube(BLOCK.sand, 'sand', [4, 4, 4], '#dcd3a0', 0.5, 'shovel', 0, { id: BLOCK.sand }, 'sand'),
	[BLOCK.water]: b({ id: BLOCK.water, key: 'water', shape: 'cube', transparent: true, translucent: true, solid: false, light: 0, opacity: 1, tiles: [5, 5, 5], color: '#3b6fd8', hardness: Infinity, tool: 'none', minTier: 0, drops: null, placeable: false, sound: 'water' }),
	[BLOCK.log]: cube(BLOCK.log, 'log', [6, 7, 6], '#7a5a34', 2, 'axe', 0, { id: BLOCK.log }, 'wood', { fuel: 1 }),
	[BLOCK.leaves]: b({ id: BLOCK.leaves, key: 'leaves', shape: 'cube', transparent: true, translucent: false, solid: true, light: 0, opacity: 1, tiles: [8, 8, 8], color: '#3f8a2f', hardness: 0.2, tool: 'hoe', minTier: 0, drops: { id: BLOCK.sapling, chance: 0.05 }, silk: true, placeable: true, sound: 'grass' }),
	[BLOCK.planks]: cube(BLOCK.planks, 'planks', [9, 9, 9], '#b48c5a', 2, 'axe', 0, { id: BLOCK.planks }, 'wood', { fuel: 1 }),
	[BLOCK.bricks]: cube(BLOCK.bricks, 'bricks', [10, 10, 10], '#a04b3a', 2, 'pickaxe', 1, { id: BLOCK.bricks }, 'stone'),
	[BLOCK.cobblestone]: cube(BLOCK.cobblestone, 'cobblestone', [11, 11, 11], '#6f6f6f', 2, 'pickaxe', 1, { id: BLOCK.cobblestone }, 'stone'),
	[BLOCK.glass]: b({ id: BLOCK.glass, key: 'glass', shape: 'cube', transparent: true, translucent: true, solid: true, light: 0, opacity: 0, tiles: [12, 12, 12], color: '#c8e8f0', hardness: 0.3, tool: 'none', minTier: 0, drops: null, silk: true, placeable: true, sound: 'glass' }),
	[BLOCK.lamp]: cube(BLOCK.lamp, 'lamp', [13, 13, 13], '#f6d76b', 0.3, 'none', 0, { id: BLOCK.lamp }, 'glass', { light: 15 }),
	[BLOCK.snow]: cube(BLOCK.snow, 'snow', [14, 15, 2], '#f0f4f8', 0.2, 'shovel', 0, { id: BLOCK.dirt }, 'snow', { silk: true }),
	[BLOCK.cactus]: b({ id: BLOCK.cactus, key: 'cactus', shape: 'cube', transparent: true, translucent: false, solid: true, light: 0, opacity: 0, tiles: [16, 17, 16], color: '#4f8a3a', hardness: 0.4, tool: 'none', minTier: 0, drops: { id: BLOCK.cactus }, placeable: true, damaging: true, sound: 'wool', support: 'below' }),
	[BLOCK.coalOre]: cube(BLOCK.coalOre, 'coalOre', [18, 18, 18], '#4a4a4a', 3, 'pickaxe', 1, { id: 101 }, 'stone', { silk: true, fortune: true, xp: [0, 2] }),
	[BLOCK.ironOre]: cube(BLOCK.ironOre, 'ironOre', [19, 19, 19], '#b89a7a', 3, 'pickaxe', 2, { id: 102 }, 'stone', { silk: true, fortune: true }),
	[BLOCK.bedrock]: b({ id: BLOCK.bedrock, key: 'bedrock', shape: 'cube', transparent: false, translucent: false, solid: true, light: 0, opacity: 15, tiles: [20, 20, 20], color: '#2a2a2a', hardness: Infinity, tool: 'none', minTier: 0, drops: null, placeable: false, sound: 'stone' }),
	[BLOCK.craftingTable]: cube(BLOCK.craftingTable, 'craftingTable', [21, 22, 9], '#9c6b3c', 2.5, 'axe', 0, { id: BLOCK.craftingTable }, 'wood', { usable: true, fuel: 1 }),
	[BLOCK.gravel]: cube(BLOCK.gravel, 'gravel', [23, 23, 23], '#8d8477', 0.6, 'shovel', 0, { id: BLOCK.gravel }, 'gravel'),
	[BLOCK.goldOre]: cube(BLOCK.goldOre, 'goldOre', [24, 24, 24], '#d9b84a', 3, 'pickaxe', 3, { id: 107 }, 'stone', { silk: true, fortune: true }),
	[BLOCK.diamondOre]: cube(BLOCK.diamondOre, 'diamondOre', [25, 25, 25], '#6fe3e0', 3, 'pickaxe', 3, { id: 109 }, 'stone', { silk: true, fortune: true, xp: [3, 7] }),
	[BLOCK.lapisOre]: cube(BLOCK.lapisOre, 'lapisOre', [26, 26, 26], '#3a5bc7', 3, 'pickaxe', 2, { id: 130, count: 4 }, 'stone', { silk: true, fortune: true, xp: [2, 5] }),
	[BLOCK.torch]: b({ id: BLOCK.torch, key: 'torch', shape: 'torch', transparent: true, translucent: false, solid: false, light: 14, opacity: 0, tiles: [27, 27, 27], color: '#ffcc55', hardness: 0, tool: 'none', minTier: 0, drops: { id: BLOCK.torch }, placeable: true, sound: 'wood', support: 'below' }),
	[BLOCK.ladder]: b({ id: BLOCK.ladder, key: 'ladder', shape: 'ladder', transparent: true, translucent: false, solid: false, light: 0, opacity: 0, tiles: [28, 28, 28], color: '#b48c5a', hardness: 0.4, tool: 'axe', minTier: 0, drops: { id: BLOCK.ladder }, placeable: true, climbable: true, sound: 'wood', support: 'wall' }),
	[BLOCK.stoneBricks]: cube(BLOCK.stoneBricks, 'stoneBricks', [29, 29, 29], '#7d7d7d', 1.5, 'pickaxe', 1, { id: BLOCK.stoneBricks }, 'stone'),
	[BLOCK.wool]: cube(BLOCK.wool, 'wool', [30, 30, 30], '#e9e9e9', 0.8, 'none', 0, { id: BLOCK.wool }, 'wool'),
	[BLOCK.furnace]: cube(BLOCK.furnace, 'furnace', [31, 32, 31], '#6a6a6a', 3.5, 'pickaxe', 1, { id: BLOCK.furnace }, 'stone', { usable: true }),
	[BLOCK.enchantingTable]: cube(BLOCK.enchantingTable, 'enchantingTable', [33, 34, 40], '#5a2d7a', 5, 'pickaxe', 1, { id: BLOCK.enchantingTable }, 'stone', { usable: true, light: 7 }),
	[BLOCK.bed]: b({ id: BLOCK.bed, key: 'bed', shape: 'bed', transparent: true, translucent: false, solid: true, light: 0, opacity: 0, tiles: [35, 36, 9], color: '#c43b3b', hardness: 0.2, tool: 'none', minTier: 0, drops: { id: BLOCK.bed }, placeable: true, usable: true, sound: 'wool', support: 'below' }),
	[BLOCK.farmland]: b({ id: BLOCK.farmland, key: 'farmland', shape: 'farmland', transparent: true, translucent: false, solid: true, light: 0, opacity: 15, tiles: [37, 2, 2], color: '#6b4524', hardness: 0.6, tool: 'shovel', minTier: 0, drops: { id: BLOCK.dirt }, placeable: false, sound: 'gravel' }),
	[BLOCK.wheat0]: plant(BLOCK.wheat0, 'wheat0', 41, '#4f9a3a', { id: 136 }, { support: 'farmland', growsTo: BLOCK.wheat1, sound: 'crop', hardness: 0 }),
	[BLOCK.wheat1]: plant(BLOCK.wheat1, 'wheat1', 42, '#6aa83c', { id: 136 }, { support: 'farmland', growsTo: BLOCK.wheat2, sound: 'crop', placeable: false }),
	[BLOCK.wheat2]: plant(BLOCK.wheat2, 'wheat2', 43, '#9ab63a', { id: 136 }, { support: 'farmland', growsTo: BLOCK.wheat3, sound: 'crop', placeable: false }),
	[BLOCK.wheat3]: plant(BLOCK.wheat3, 'wheat3', 44, '#d8b33a', { id: 137 }, { support: 'farmland', sound: 'crop', placeable: false }),
	[BLOCK.sapling]: plant(BLOCK.sapling, 'sapling', 45, '#4c8f36', { id: BLOCK.sapling }, { growsTo: BLOCK.log }),
	[BLOCK.tallGrass]: plant(BLOCK.tallGrass, 'tallGrass', 46, '#5fa23c', { id: 136, chance: 0.125 }, { replaceable: true, silk: true }),
	[BLOCK.flower]: plant(BLOCK.flower, 'flower', 47, '#e04a3a', { id: BLOCK.flower }, { replaceable: true }),
	[BLOCK.bookshelf]: cube(BLOCK.bookshelf, 'bookshelf', [9, 48, 9], '#8a6a3c', 1.5, 'axe', 0, { id: 153, count: 3 }, 'wood', { silk: true, fuel: 1 }),
	[BLOCK.glowstone]: cube(BLOCK.glowstone, 'glowstone', [49, 49, 49], '#f2d27a', 0.3, 'none', 0, { id: BLOCK.glowstone }, 'glass', { light: 15 }),
	[BLOCK.obsidian]: cube(BLOCK.obsidian, 'obsidian', [50, 50, 50], '#1a1026', 50, 'pickaxe', 4, { id: BLOCK.obsidian }, 'stone'),
	[BLOCK.mossyCobblestone]: cube(BLOCK.mossyCobblestone, 'mossyCobblestone', [51, 51, 51], '#5f7a52', 2, 'pickaxe', 1, { id: BLOCK.mossyCobblestone }, 'stone'),
	[BLOCK.hayBale]: cube(BLOCK.hayBale, 'hayBale', [52, 53, 52], '#c9a63a', 0.5, 'hoe', 0, { id: BLOCK.hayBale }, 'grass'),
	[BLOCK.sandstone]: cube(BLOCK.sandstone, 'sandstone', [54, 55, 54], '#d9cf9a', 0.8, 'pickaxe', 1, { id: BLOCK.sandstone }, 'stone'),
	[BLOCK.clay]: cube(BLOCK.clay, 'clay', [56, 56, 56], '#9ea4b0', 0.6, 'shovel', 0, { id: 152, count: 4 }, 'gravel', { silk: true }),
	[BLOCK.ice]: b({ id: BLOCK.ice, key: 'ice', shape: 'cube', transparent: true, translucent: true, solid: true, light: 0, opacity: 1, tiles: [57, 57, 57], color: '#a9d3f5', hardness: 0.5, tool: 'pickaxe', minTier: 0, drops: null, silk: true, placeable: true, slippery: true, sound: 'glass' }),
	[BLOCK.pumpkin]: cube(BLOCK.pumpkin, 'pumpkin', [58, 59, 58], '#d98a2a', 1, 'axe', 0, { id: BLOCK.pumpkin }, 'wood'),
	[BLOCK.melon]: cube(BLOCK.melon, 'melon', [60, 61, 60], '#8bbf3a', 1, 'axe', 0, { id: BLOCK.melon }, 'wood'),
	[BLOCK.birchLog]: cube(BLOCK.birchLog, 'birchLog', [62, 63, 62], '#d8d2b8', 2, 'axe', 0, { id: BLOCK.birchLog }, 'wood', { fuel: 1 }),
	[BLOCK.birchPlanks]: cube(BLOCK.birchPlanks, 'birchPlanks', [64, 64, 64], '#d9c99a', 2, 'axe', 0, { id: BLOCK.birchPlanks }, 'wood', { fuel: 1 }),
};

export const ATLAS_TILE_COUNT = 80;
export const ATLAS_TILE_PX = 16;
/** 破壊の進み具合のひび割れ (10 段階) はアトラスの末尾 10 タイルに置く */
export const ATLAS_CRACK_TILE = 70;

export function isSolid(id: number): boolean {
	const def = BLOCK_DEFS[id];
	return def != null && def.solid;
}

export function isTransparent(id: number): boolean {
	if (id === BLOCK.air) return true;
	const def = BLOCK_DEFS[id];
	return def == null || def.transparent;
}

export function isCrop(id: number): boolean {
	return id >= BLOCK.wheat0 && id <= BLOCK.wheat3;
}

// ----- 道具・防具の素材 -----

export type ToolMaterialKey = 'wood' | 'stone' | 'iron' | 'gold' | 'diamond';
export type ToolMaterial = {
	key: ToolMaterialKey;
	index: number;
	tier: ToolTier;
	durability: number;
	/** 採掘速度の倍率 (素手 1) */
	speed: number;
	/** 剣の攻撃力 */
	swordAttack: number;
	/** 斧の攻撃力 */
	axeAttack: number;
	/** ツルハシの攻撃力 */
	pickaxeAttack: number;
	/** シャベルの攻撃力 */
	shovelAttack: number;
	enchantability: number;
	color: string;
	/** 修理・クラフトに使う素材のアイテム id */
	ingredient: number;
	/** 斧の攻撃速度 (回/秒) */
	axeSpeed: number;
	/** クワの攻撃速度 (回/秒) */
	hoeSpeed: number;
};

export const TOOL_MATERIALS: ToolMaterial[] = [
	{ key: 'wood', index: 0, tier: 1, durability: 59, speed: 2, swordAttack: 4, axeAttack: 7, pickaxeAttack: 2, shovelAttack: 2.5, enchantability: 15, color: '#b48c5a', ingredient: BLOCK.planks, axeSpeed: 0.8, hoeSpeed: 1 },
	{ key: 'stone', index: 1, tier: 2, durability: 131, speed: 4, swordAttack: 5, axeAttack: 9, pickaxeAttack: 3, shovelAttack: 3.5, enchantability: 5, color: '#8a8a8a', ingredient: BLOCK.cobblestone, axeSpeed: 0.8, hoeSpeed: 2 },
	{ key: 'iron', index: 2, tier: 3, durability: 250, speed: 6, swordAttack: 6, axeAttack: 9, pickaxeAttack: 4, shovelAttack: 4.5, enchantability: 14, color: '#d8d8d8', ingredient: 103, axeSpeed: 0.9, hoeSpeed: 3 },
	{ key: 'gold', index: 3, tier: 1, durability: 32, speed: 12, swordAttack: 4, axeAttack: 7, pickaxeAttack: 2, shovelAttack: 2.5, enchantability: 22, color: '#f1d04a', ingredient: 108, axeSpeed: 1.0, hoeSpeed: 1 },
	{ key: 'diamond', index: 4, tier: 4, durability: 1561, speed: 8, swordAttack: 7, axeAttack: 9, pickaxeAttack: 5, shovelAttack: 5.5, enchantability: 10, color: '#6fe3e0', ingredient: 109, axeSpeed: 1.0, hoeSpeed: 4 },
];

export type ToolTypeKey = 'pickaxe' | 'axe' | 'shovel' | 'sword' | 'hoe';
export const TOOL_TYPES: { key: ToolTypeKey; index: number; attackSpeed: number }[] = [
	{ key: 'pickaxe', index: 0, attackSpeed: 1.2 },
	{ key: 'axe', index: 1, attackSpeed: 0.9 },
	{ key: 'shovel', index: 2, attackSpeed: 1.0 },
	{ key: 'sword', index: 3, attackSpeed: 1.6 },
	{ key: 'hoe', index: 4, attackSpeed: 2.0 },
];

export type ArmorMaterialKey = 'leather' | 'iron' | 'gold' | 'diamond';
export type ArmorSlot = 'helmet' | 'chestplate' | 'leggings' | 'boots';
export const ARMOR_SLOTS: ArmorSlot[] = ['helmet', 'chestplate', 'leggings', 'boots'];
export type ArmorMaterial = {
	key: ArmorMaterialKey;
	index: number;
	/** [helmet, chestplate, leggings, boots] */
	durability: [number, number, number, number];
	points: [number, number, number, number];
	toughness: number;
	enchantability: number;
	color: string;
	ingredient: number;
};

export const ARMOR_MATERIALS: ArmorMaterial[] = [
	{ key: 'leather', index: 0, durability: [55, 80, 75, 65], points: [1, 3, 2, 1], toughness: 0, enchantability: 15, color: '#a0683a', ingredient: 131 },
	{ key: 'iron', index: 1, durability: [165, 240, 225, 195], points: [2, 6, 5, 2], toughness: 0, enchantability: 9, color: '#d8d8d8', ingredient: 103 },
	{ key: 'gold', index: 2, durability: [77, 112, 105, 91], points: [2, 5, 3, 1], toughness: 0, enchantability: 25, color: '#f1d04a', ingredient: 108 },
	{ key: 'diamond', index: 3, durability: [363, 528, 495, 429], points: [3, 8, 6, 3], toughness: 2, enchantability: 10, color: '#6fe3e0', ingredient: 109 },
];

export function toolItemId(material: number, type: number): number {
	return 200 + material * 10 + type;
}

export function armorItemId(material: number, slot: number): number {
	return 300 + material * 10 + slot;
}

// ----- アイテム -----

/** ブロックはそのままアイテム id として使う (1..49)。素材は 100 以降、道具は 200 以降、防具は 300 以降 */
export const ITEM = {
	stick: 100,
	coal: 101,
	rawIron: 102,
	ironIngot: 103,
	apple: 104,
	rawMeat: 105,
	cookedMeat: 106,
	rawGold: 107,
	goldIngot: 108,
	diamond: 109,
	lapis: 130,
	leather: 131,
	feather: 132,
	bone: 133,
	string: 134,
	rottenFlesh: 135,
	wheatSeeds: 136,
	wheat: 137,
	bread: 138,
	goldenApple: 139,
	rawBeef: 140,
	cookedBeef: 141,
	rawPorkchop: 142,
	cookedPorkchop: 143,
	rawChicken: 144,
	cookedChicken: 145,
	rawMutton: 146,
	cookedMutton: 147,
	arrow: 148,
	bow: 149,
	egg: 150,
	charcoal: 151,
	brick: 152,
	book: 153,
	paper: 154,
	melonSlice: 155,
	pumpkinPie: 156,
	// 道具 (200 + 素材 * 10 + 種類)
	woodenPickaxe: 200, woodenAxe: 201, woodenShovel: 202, woodenSword: 203, woodenHoe: 204,
	stonePickaxe: 210, stoneAxe: 211, stoneShovel: 212, stoneSword: 213, stoneHoe: 214,
	ironPickaxe: 220, ironAxe: 221, ironShovel: 222, ironSword: 223, ironHoe: 224,
	goldenPickaxe: 230, goldenAxe: 231, goldenShovel: 232, goldenSword: 233, goldenHoe: 234,
	diamondPickaxe: 240, diamondAxe: 241, diamondShovel: 242, diamondSword: 243, diamondHoe: 244,
	// 防具 (300 + 素材 * 10 + 部位)
	leatherHelmet: 300, leatherChestplate: 301, leatherLeggings: 302, leatherBoots: 303,
	ironHelmet: 310, ironChestplate: 311, ironLeggings: 312, ironBoots: 313,
	goldenHelmet: 320, goldenChestplate: 321, goldenLeggings: 322, goldenBoots: 323,
	diamondHelmet: 330, diamondChestplate: 331, diamondLeggings: 332, diamondBoots: 333,
} as const;

/** 旧バージョンの保存データにある道具 id → 新 id */
export const LEGACY_ITEM_IDS: Record<number, number> = {
	110: ITEM.woodenPickaxe, 111: ITEM.stonePickaxe, 112: ITEM.ironPickaxe,
	120: ITEM.woodenSword, 121: ITEM.stoneSword, 122: ITEM.ironSword,
};

export type ItemKey = keyof typeof ITEM | Exclude<BlockKey, 'air'>;

export type ItemKind = 'block' | 'material' | 'tool' | 'armor' | 'food' | 'bow';

export type ItemDef = {
	id: number;
	key: ItemKey;
	kind: ItemKind;
	maxStack: number;
	/** アイコン・ミニマップ用の代表色 */
	color: string;
	/** 耐久値 (道具・防具・弓)。無いものは壊れない */
	durability?: number;
	enchantability?: number;
	tool?: {
		kind: ToolKind;
		tier: ToolTier;
		material: ToolMaterialKey;
		/** 採掘速度の倍率 (素手 1) */
		speed: number;
		/** 攻撃力 (素手 1) */
		attack: number;
		/** 攻撃速度 (回/秒) */
		attackSpeed: number;
	};
	armor?: {
		slot: ArmorSlot;
		slotIndex: number;
		material: ArmorMaterialKey;
		points: number;
		toughness: number;
	};
	/** 食べたときに回復する空腹度と隠し満腹度 */
	food?: { nutrition: number; saturation: number; effect?: { id: 'regeneration' | 'hunger' | 'absorption'; level: number; seconds: number }; alwaysEdible?: boolean };
	/** 燃料として使えるとき、何回分 */
	fuel?: number;
	/** 修理素材 */
	repair?: number;
};

function materialItem(id: number, key: ItemKey, color: string, extra: Partial<ItemDef> = {}): ItemDef {
	return { id, key, kind: 'material', maxStack: 64, color, ...extra };
}

function foodItem(id: number, key: ItemKey, color: string, nutrition: number, saturation: number, extra: Partial<ItemDef> = {}): ItemDef {
	return { id, key, kind: 'food', maxStack: 64, color, food: { nutrition, saturation }, ...extra };
}

const TOOL_KEYS: Record<ToolMaterialKey, Record<ToolTypeKey, ItemKey>> = {
	wood: { pickaxe: 'woodenPickaxe', axe: 'woodenAxe', shovel: 'woodenShovel', sword: 'woodenSword', hoe: 'woodenHoe' },
	stone: { pickaxe: 'stonePickaxe', axe: 'stoneAxe', shovel: 'stoneShovel', sword: 'stoneSword', hoe: 'stoneHoe' },
	iron: { pickaxe: 'ironPickaxe', axe: 'ironAxe', shovel: 'ironShovel', sword: 'ironSword', hoe: 'ironHoe' },
	gold: { pickaxe: 'goldenPickaxe', axe: 'goldenAxe', shovel: 'goldenShovel', sword: 'goldenSword', hoe: 'goldenHoe' },
	diamond: { pickaxe: 'diamondPickaxe', axe: 'diamondAxe', shovel: 'diamondShovel', sword: 'diamondSword', hoe: 'diamondHoe' },
};

const ARMOR_KEYS: Record<ArmorMaterialKey, Record<ArmorSlot, ItemKey>> = {
	leather: { helmet: 'leatherHelmet', chestplate: 'leatherChestplate', leggings: 'leatherLeggings', boots: 'leatherBoots' },
	iron: { helmet: 'ironHelmet', chestplate: 'ironChestplate', leggings: 'ironLeggings', boots: 'ironBoots' },
	gold: { helmet: 'goldenHelmet', chestplate: 'goldenChestplate', leggings: 'goldenLeggings', boots: 'goldenBoots' },
	diamond: { helmet: 'diamondHelmet', chestplate: 'diamondChestplate', leggings: 'diamondLeggings', boots: 'diamondBoots' },
};

function buildToolDefs(): Record<number, ItemDef> {
	const out: Record<number, ItemDef> = {};
	for (const m of TOOL_MATERIALS) {
		for (const t of TOOL_TYPES) {
			const attack = t.key === 'sword' ? m.swordAttack
				: t.key === 'axe' ? m.axeAttack
				: t.key === 'pickaxe' ? m.pickaxeAttack
				: t.key === 'shovel' ? m.shovelAttack
				: 1;
			const id = toolItemId(m.index, t.index);
			out[id] = {
				id, key: TOOL_KEYS[m.key][t.key], kind: 'tool', maxStack: 1, color: m.color,
				durability: m.durability, enchantability: m.enchantability, repair: m.ingredient,
				tool: { kind: t.key, tier: m.tier, material: m.key, speed: m.speed, attack, attackSpeed: t.key === 'axe' ? m.axeSpeed : t.key === 'hoe' ? m.hoeSpeed : t.attackSpeed },
				fuel: m.key === 'wood' ? 1 : undefined,
			};
		}
	}
	for (const m of ARMOR_MATERIALS) {
		ARMOR_SLOTS.forEach((slot, si) => {
			const id = armorItemId(m.index, si);
			out[id] = {
				id, key: ARMOR_KEYS[m.key][slot], kind: 'armor', maxStack: 1, color: m.color,
				durability: m.durability[si], enchantability: m.enchantability, repair: m.ingredient,
				armor: { slot, slotIndex: si, material: m.key, points: m.points[si], toughness: m.toughness },
			};
		});
	}
	return out;
}

export const ITEM_DEFS: Record<number, ItemDef> = {
	...Object.fromEntries(Object.values(BLOCK_DEFS).map(def => [def.id, {
		id: def.id, key: def.key, kind: 'block', maxStack: 64, color: def.color, fuel: def.fuel,
	} satisfies ItemDef])),
	[ITEM.stick]: materialItem(ITEM.stick, 'stick', '#8a6a3c', { fuel: 1 }),
	[ITEM.coal]: materialItem(ITEM.coal, 'coal', '#2b2b2b', { fuel: 8 }),
	[ITEM.rawIron]: materialItem(ITEM.rawIron, 'rawIron', '#c9a98a'),
	[ITEM.ironIngot]: materialItem(ITEM.ironIngot, 'ironIngot', '#d8d8d8'),
	[ITEM.apple]: foodItem(ITEM.apple, 'apple', '#d33a2f', 4, 2.4),
	[ITEM.rawMeat]: foodItem(ITEM.rawMeat, 'rawMeat', '#d9716a', 3, 1.8),
	[ITEM.cookedMeat]: foodItem(ITEM.cookedMeat, 'cookedMeat', '#8c4a2b', 8, 12.8),
	[ITEM.rawGold]: materialItem(ITEM.rawGold, 'rawGold', '#e0c070'),
	[ITEM.goldIngot]: materialItem(ITEM.goldIngot, 'goldIngot', '#f1d04a'),
	[ITEM.diamond]: materialItem(ITEM.diamond, 'diamond', '#6fe3e0'),
	[ITEM.lapis]: materialItem(ITEM.lapis, 'lapis', '#3a5bc7'),
	[ITEM.leather]: materialItem(ITEM.leather, 'leather', '#a0683a'),
	[ITEM.feather]: materialItem(ITEM.feather, 'feather', '#f4f4f4'),
	[ITEM.bone]: materialItem(ITEM.bone, 'bone', '#e8e4d0'),
	[ITEM.string]: materialItem(ITEM.string, 'string', '#eeeeee'),
	[ITEM.rottenFlesh]: foodItem(ITEM.rottenFlesh, 'rottenFlesh', '#8a5a4a', 4, 0.8, { food: { nutrition: 4, saturation: 0.8, effect: { id: 'hunger', level: 1, seconds: 30 } } }),
	[ITEM.wheatSeeds]: materialItem(ITEM.wheatSeeds, 'wheatSeeds', '#7fae4a'),
	[ITEM.wheat]: materialItem(ITEM.wheat, 'wheat', '#d8b33a'),
	[ITEM.bread]: foodItem(ITEM.bread, 'bread', '#c08a4a', 5, 6),
	[ITEM.goldenApple]: foodItem(ITEM.goldenApple, 'goldenApple', '#f1d04a', 4, 9.6, { food: { nutrition: 4, saturation: 9.6, effect: { id: 'regeneration', level: 2, seconds: 5 }, alwaysEdible: true } }),
	[ITEM.rawBeef]: foodItem(ITEM.rawBeef, 'rawBeef', '#c45a4a', 3, 1.8),
	[ITEM.cookedBeef]: foodItem(ITEM.cookedBeef, 'cookedBeef', '#6e3a24', 8, 12.8),
	[ITEM.rawPorkchop]: foodItem(ITEM.rawPorkchop, 'rawPorkchop', '#e89a9a', 3, 1.8),
	[ITEM.cookedPorkchop]: foodItem(ITEM.cookedPorkchop, 'cookedPorkchop', '#b7703a', 8, 12.8),
	[ITEM.rawChicken]: foodItem(ITEM.rawChicken, 'rawChicken', '#f0c8b8', 2, 1.2),
	[ITEM.cookedChicken]: foodItem(ITEM.cookedChicken, 'cookedChicken', '#c88a4a', 6, 7.2),
	[ITEM.rawMutton]: foodItem(ITEM.rawMutton, 'rawMutton', '#d46a6a', 2, 1.2),
	[ITEM.cookedMutton]: foodItem(ITEM.cookedMutton, 'cookedMutton', '#8a4a2e', 6, 9.6),
	[ITEM.arrow]: materialItem(ITEM.arrow, 'arrow', '#d8d0c0'),
	[ITEM.bow]: { id: ITEM.bow, key: 'bow', kind: 'bow', maxStack: 1, color: '#8a6a3c', durability: 384, enchantability: 1, repair: ITEM.string },
	[ITEM.egg]: materialItem(ITEM.egg, 'egg', '#f0e6d0', { maxStack: 16 }),
	[ITEM.charcoal]: materialItem(ITEM.charcoal, 'charcoal', '#3a3a3a', { fuel: 8 }),
	[ITEM.brick]: materialItem(ITEM.brick, 'brick', '#a04b3a'),
	[ITEM.book]: materialItem(ITEM.book, 'book', '#7a4a2e'),
	[ITEM.paper]: materialItem(ITEM.paper, 'paper', '#f4f1e6'),
	[ITEM.melonSlice]: foodItem(ITEM.melonSlice, 'melonSlice', '#e05a4a', 2, 1.2),
	[ITEM.pumpkinPie]: foodItem(ITEM.pumpkinPie, 'pumpkinPie', '#d9a05a', 8, 4.8),
	...buildToolDefs(),
};

export function isBlockItem(id: number): boolean {
	return id >= 1 && id <= MAX_BLOCK_TYPE && BLOCK_DEFS[id]?.placeable === true;
}

/** 燃料として何回分か (0 なら燃料でない) */
export function fuelValue(id: number): number {
	return ITEM_DEFS[id]?.fuel ?? 0;
}

// ----- エンチャント -----

export type EnchantId =
	| 'sharpness' | 'knockback' | 'looting' | 'efficiency' | 'unbreaking' | 'fortune' | 'silkTouch'
	| 'protection' | 'featherFalling' | 'respiration' | 'aquaAffinity' | 'thorns' | 'mending'
	| 'power' | 'punch' | 'infinity';

export type EnchantTarget = 'sword' | 'axe' | 'digger' | 'armor' | 'helmet' | 'boots' | 'bow' | 'breakable';

export type EnchantDef = {
	id: EnchantId;
	maxLevel: number;
	/** 出やすさ (common 10, uncommon 5, rare 2, very rare 1) */
	weight: number;
	targets: EnchantTarget[];
	/** 同時に付かないもの */
	conflicts: EnchantId[];
	/** 宝 (ガチャの高ティアでしか出ない) */
	treasure?: boolean;
};

export const ENCHANT_DEFS: Record<EnchantId, EnchantDef> = {
	sharpness: { id: 'sharpness', maxLevel: 5, weight: 10, targets: ['sword', 'axe'], conflicts: [] },
	knockback: { id: 'knockback', maxLevel: 2, weight: 5, targets: ['sword'], conflicts: [] },
	looting: { id: 'looting', maxLevel: 3, weight: 2, targets: ['sword'], conflicts: [] },
	efficiency: { id: 'efficiency', maxLevel: 5, weight: 10, targets: ['digger', 'axe'], conflicts: [] },
	unbreaking: { id: 'unbreaking', maxLevel: 3, weight: 5, targets: ['breakable'], conflicts: [] },
	fortune: { id: 'fortune', maxLevel: 3, weight: 2, targets: ['digger', 'axe'], conflicts: ['silkTouch'] },
	silkTouch: { id: 'silkTouch', maxLevel: 1, weight: 1, targets: ['digger', 'axe'], conflicts: ['fortune'] },
	protection: { id: 'protection', maxLevel: 4, weight: 10, targets: ['armor'], conflicts: [] },
	featherFalling: { id: 'featherFalling', maxLevel: 4, weight: 5, targets: ['boots'], conflicts: [] },
	respiration: { id: 'respiration', maxLevel: 3, weight: 2, targets: ['helmet'], conflicts: [] },
	aquaAffinity: { id: 'aquaAffinity', maxLevel: 1, weight: 2, targets: ['helmet'], conflicts: [] },
	thorns: { id: 'thorns', maxLevel: 3, weight: 1, targets: ['armor'], conflicts: [] },
	mending: { id: 'mending', maxLevel: 1, weight: 2, targets: ['breakable'], conflicts: ['infinity'], treasure: true },
	power: { id: 'power', maxLevel: 5, weight: 10, targets: ['bow'], conflicts: [] },
	punch: { id: 'punch', maxLevel: 2, weight: 2, targets: ['bow'], conflicts: [] },
	infinity: { id: 'infinity', maxLevel: 1, weight: 1, targets: ['bow'], conflicts: ['mending'] },
};

/** アイテムに付けられるエンチャントの対象区分 */
export function enchantTargetsOf(id: number): EnchantTarget[] {
	const def = ITEM_DEFS[id];
	if (def == null) return [];
	const out: EnchantTarget[] = [];
	if (def.durability != null) out.push('breakable');
	if (def.tool != null) {
		if (def.tool.kind === 'sword') out.push('sword');
		else if (def.tool.kind === 'axe') out.push('axe');
		else out.push('digger');
	}
	if (def.armor != null) {
		out.push('armor');
		if (def.armor.slot === 'helmet') out.push('helmet');
		if (def.armor.slot === 'boots') out.push('boots');
	}
	if (def.kind === 'bow') out.push('bow');
	return out;
}

/** ガチャ (エンチャント台) のティア */
export type GachaTier = 1 | 2 | 3;
export const GACHA_TIERS: Record<GachaTier, { levels: number; lapis: number; enchantRolls: [number, number]; levelBias: number }> = {
	1: { levels: 5, lapis: 1, enchantRolls: [1, 1], levelBias: 0.3 },
	2: { levels: 15, lapis: 2, enchantRolls: [1, 2], levelBias: 0.6 },
	3: { levels: 30, lapis: 3, enchantRolls: [2, 3], levelBias: 0.9 },
};

// ----- クラフト -----

export type RecipeNeeds = 'none' | 'table' | 'furnace';

export type Ingredient = {
	/** いずれか 1 種類で満たせる (燃料など) */
	ids: number[];
	count: number;
};

export type Recipe = {
	key: string;
	result: { id: number; count: number };
	ingredients: Ingredient[];
	needs: RecipeNeeds;
	/** 一覧の分類 */
	category: 'basic' | 'tools' | 'weapons' | 'armor' | 'blocks' | 'food' | 'smelting';
	/** かまどで得る経験値 */
	xp?: number;
};

const FUEL_IDS = [ITEM.coal, ITEM.charcoal, BLOCK.planks, BLOCK.birchPlanks, BLOCK.log, BLOCK.birchLog, ITEM.stick];
const PLANK_IDS = [BLOCK.planks, BLOCK.birchPlanks];
const LOG_IDS = [BLOCK.log, BLOCK.birchLog];

const one = (id: number, count = 1): Ingredient => ({ ids: [id], count });
const any = (ids: number[], count = 1): Ingredient => ({ ids, count });
const r = (key: string, result: { id: number; count: number }, ingredients: Ingredient[], needs: RecipeNeeds, category: Recipe['category'], xp?: number): Recipe => ({ key, result, ingredients, needs, category, xp });

function toolRecipes(): Recipe[] {
	const out: Recipe[] = [];
	const heads: Record<ToolTypeKey, number> = { pickaxe: 3, axe: 3, shovel: 1, sword: 2, hoe: 2 };
	const sticks: Record<ToolTypeKey, number> = { pickaxe: 2, axe: 2, shovel: 2, sword: 1, hoe: 2 };
	for (const m of TOOL_MATERIALS) {
		for (const t of TOOL_TYPES) {
			const id = toolItemId(m.index, t.index);
			const ing = m.key === 'wood' ? any(PLANK_IDS, heads[t.key]) : one(m.ingredient, heads[t.key]);
			out.push(r(ITEM_DEFS[id].key, { id, count: 1 }, [ing, one(ITEM.stick, sticks[t.key])], 'table', t.key === 'sword' ? 'weapons' : 'tools'));
		}
	}
	const pieces: [number, number, number, number] = [5, 8, 7, 4];
	for (const m of ARMOR_MATERIALS) {
		ARMOR_SLOTS.forEach((_slot, si) => {
			const id = armorItemId(m.index, si);
			out.push(r(ITEM_DEFS[id].key, { id, count: 1 }, [one(m.ingredient, pieces[si])], 'table', 'armor'));
		});
	}
	return out;
}

export const RECIPES: Recipe[] = [
	r('planks', { id: BLOCK.planks, count: 4 }, [one(BLOCK.log)], 'none', 'basic'),
	r('birchPlanks', { id: BLOCK.birchPlanks, count: 4 }, [one(BLOCK.birchLog)], 'none', 'basic'),
	r('stick', { id: ITEM.stick, count: 4 }, [any(PLANK_IDS, 2)], 'none', 'basic'),
	r('craftingTable', { id: BLOCK.craftingTable, count: 1 }, [any(PLANK_IDS, 4)], 'none', 'basic'),
	r('torch', { id: BLOCK.torch, count: 4 }, [any([ITEM.coal, ITEM.charcoal]), one(ITEM.stick)], 'none', 'basic'),
	r('ladder', { id: BLOCK.ladder, count: 3 }, [one(ITEM.stick, 7)], 'table', 'basic'),
	r('furnace', { id: BLOCK.furnace, count: 1 }, [one(BLOCK.cobblestone, 8)], 'table', 'basic'),
	r('bed', { id: BLOCK.bed, count: 1 }, [one(BLOCK.wool, 3), any(PLANK_IDS, 3)], 'table', 'basic'),
	r('bow', { id: ITEM.bow, count: 1 }, [one(ITEM.stick, 3), one(ITEM.string, 3)], 'table', 'weapons'),
	r('arrow', { id: ITEM.arrow, count: 4 }, [one(ITEM.stick), one(ITEM.feather), one(BLOCK.cobblestone)], 'table', 'weapons'),
	r('paper', { id: ITEM.paper, count: 3 }, [one(ITEM.wheat, 3)], 'table', 'basic'),
	r('book', { id: ITEM.book, count: 1 }, [one(ITEM.paper, 3), one(ITEM.leather)], 'table', 'basic'),
	r('bookshelf', { id: BLOCK.bookshelf, count: 1 }, [any(PLANK_IDS, 6), one(ITEM.book, 3)], 'table', 'blocks'),
	r('enchantingTable', { id: BLOCK.enchantingTable, count: 1 }, [one(ITEM.book), one(ITEM.diamond, 2), one(BLOCK.obsidian, 4)], 'table', 'basic'),
	r('lamp', { id: BLOCK.lamp, count: 1 }, [one(BLOCK.glass), one(BLOCK.torch, 4)], 'table', 'blocks'),
	r('glowstone', { id: BLOCK.glowstone, count: 1 }, [one(BLOCK.torch, 8), one(ITEM.goldIngot)], 'table', 'blocks'),
	r('bricks', { id: BLOCK.bricks, count: 1 }, [one(ITEM.brick, 4)], 'table', 'blocks'),
	r('stoneBricks', { id: BLOCK.stoneBricks, count: 4 }, [one(BLOCK.stone, 4)], 'table', 'blocks'),
	r('mossyCobblestone', { id: BLOCK.mossyCobblestone, count: 1 }, [one(BLOCK.cobblestone), one(BLOCK.tallGrass)], 'none', 'blocks'),
	r('sandstone', { id: BLOCK.sandstone, count: 1 }, [one(BLOCK.sand, 4)], 'none', 'blocks'),
	r('wool', { id: BLOCK.wool, count: 1 }, [one(ITEM.string, 4)], 'none', 'blocks'),
	r('hayBale', { id: BLOCK.hayBale, count: 1 }, [one(ITEM.wheat, 9)], 'table', 'blocks'),
	r('wheatFromHay', { id: ITEM.wheat, count: 9 }, [one(BLOCK.hayBale)], 'none', 'basic'),
	r('bread', { id: ITEM.bread, count: 1 }, [one(ITEM.wheat, 3)], 'table', 'food'),
	r('goldenApple', { id: ITEM.goldenApple, count: 1 }, [one(ITEM.apple), one(ITEM.goldIngot, 8)], 'table', 'food'),
	r('melonSlice', { id: ITEM.melonSlice, count: 6 }, [one(BLOCK.melon)], 'none', 'food'),
	r('pumpkinPie', { id: ITEM.pumpkinPie, count: 1 }, [one(BLOCK.pumpkin), one(ITEM.egg)], 'table', 'food'),
	r('wheatSeeds', { id: ITEM.wheatSeeds, count: 1 }, [one(ITEM.wheat)], 'none', 'basic'),
	// かまど (燃料 1 につき 1 個。石炭は手に入りやすいので簡略化)
	r('ironIngot', { id: ITEM.ironIngot, count: 1 }, [one(ITEM.rawIron), any(FUEL_IDS)], 'furnace', 'smelting', 0.7),
	r('goldIngot', { id: ITEM.goldIngot, count: 1 }, [one(ITEM.rawGold), any(FUEL_IDS)], 'furnace', 'smelting', 1),
	r('charcoal', { id: ITEM.charcoal, count: 1 }, [any(LOG_IDS), any(FUEL_IDS)], 'furnace', 'smelting', 0.15),
	r('glass', { id: BLOCK.glass, count: 1 }, [one(BLOCK.sand), any(FUEL_IDS)], 'furnace', 'smelting', 0.1),
	r('stone', { id: BLOCK.stone, count: 1 }, [one(BLOCK.cobblestone), any(FUEL_IDS)], 'furnace', 'smelting', 0.1),
	r('brick', { id: ITEM.brick, count: 1 }, [one(BLOCK.clay), any(FUEL_IDS)], 'furnace', 'smelting', 0.3),
	r('cookedMeat', { id: ITEM.cookedMeat, count: 1 }, [one(ITEM.rawMeat), any(FUEL_IDS)], 'furnace', 'smelting', 0.35),
	r('cookedBeef', { id: ITEM.cookedBeef, count: 1 }, [one(ITEM.rawBeef), any(FUEL_IDS)], 'furnace', 'smelting', 0.35),
	r('cookedPorkchop', { id: ITEM.cookedPorkchop, count: 1 }, [one(ITEM.rawPorkchop), any(FUEL_IDS)], 'furnace', 'smelting', 0.35),
	r('cookedChicken', { id: ITEM.cookedChicken, count: 1 }, [one(ITEM.rawChicken), any(FUEL_IDS)], 'furnace', 'smelting', 0.35),
	r('cookedMutton', { id: ITEM.cookedMutton, count: 1 }, [one(ITEM.rawMutton), any(FUEL_IDS)], 'furnace', 'smelting', 0.35),
	...toolRecipes(),
];

// ----- プレイヤー -----

export const PLAYER = {
	width: 0.6,
	height: 1.8,
	sneakHeight: 1.5,
	swimHeight: 0.6,
	eyeHeight: 1.62,
	sneakEyeHeight: 1.27,
	swimEyeHeight: 0.4,
	/** 段差を自動で登る高さ */
	stepHeight: 0.6,
	reach: 4.5,
	maxHealth: 20,
	maxHunger: 20,
	/** 水中で息が続く秒数 (300 tick) */
	maxAir: 15,
	inventorySize: 36,
	hotbarSize: 9,
	/** 防具枠は 36..39 (兜、胸、脚、靴) */
	armorSlotStart: 36,
	armorSlots: 4,
	totalSlots: 40,
	/** 歩行速度 (ブロック/秒)。Minecraft の 4.317 */
	walkSpeed: 4.317,
	sprintSpeed: 5.612,
	sneakSpeed: 1.295,
	/** ジャンプの初速 (0.42 ブロック/tick) */
	jumpSpeed: 8.4,
	/** 重力 (0.08 ブロック/tick^2 相当) */
	gravity: 32,
	maxFallSpeed: 78,
	/** はしごの昇降速度 */
	climbSpeed: 2.35,
	/** 泳ぎの速度 */
	swimSpeed: 2.2,
} as const;

/** 行動ごとの消耗 (exhaustion)。4 たまると隠し満腹度 (無ければ空腹度) が 1 減る */
export const EXHAUSTION = {
	sprintPerMeter: 0.1,
	swimPerMeter: 0.01,
	jump: 0.05,
	sprintJump: 0.2,
	attack: 0.1,
	damaged: 0.1,
	mineBlock: 0.005,
	regenPerHealth: 6,
} as const;

/** 次のレベルまでに必要な経験値 */
export function xpToNextLevel(level: number): number {
	if (level < 16) return 2 * level + 7;
	if (level < 31) return 5 * level - 38;
	return 9 * level - 158;
}

// ----- バイオーム -----

export const BIOME = {
	ocean: 0,
	plains: 1,
	forest: 2,
	desert: 3,
	taiga: 4,
	mountains: 5,
	birchForest: 6,
	swamp: 7,
} as const;

export type BiomeId = typeof BIOME[keyof typeof BIOME];

export type BiomeDef = {
	id: BiomeId;
	key: 'ocean' | 'plains' | 'forest' | 'desert' | 'taiga' | 'mountains' | 'birchForest' | 'swamp';
	/** ミニマップ用の色 */
	color: string;
	/** 草・葉の色合い (乗算) */
	grassTint: [number, number, number];
};

export const BIOME_DEFS: Record<number, BiomeDef> = {
	[BIOME.ocean]: { id: BIOME.ocean, key: 'ocean', color: '#3b6fd8', grassTint: [1, 1, 1] },
	[BIOME.plains]: { id: BIOME.plains, key: 'plains', color: '#7cc24a', grassTint: [1, 1, 1] },
	[BIOME.forest]: { id: BIOME.forest, key: 'forest', color: '#3f8a2f', grassTint: [0.85, 1, 0.8] },
	[BIOME.desert]: { id: BIOME.desert, key: 'desert', color: '#dcd3a0', grassTint: [1.05, 1, 0.75] },
	[BIOME.taiga]: { id: BIOME.taiga, key: 'taiga', color: '#dfe8ee', grassTint: [0.8, 0.95, 0.85] },
	[BIOME.mountains]: { id: BIOME.mountains, key: 'mountains', color: '#8a8a8a', grassTint: [0.9, 0.95, 0.85] },
	[BIOME.birchForest]: { id: BIOME.birchForest, key: 'birchForest', color: '#9ccf5a', grassTint: [0.95, 1, 0.75] },
	[BIOME.swamp]: { id: BIOME.swamp, key: 'swamp', color: '#5a7a45', grassTint: [0.7, 0.8, 0.55] },
};

// ----- MOB -----

export const MOB = {
	zombie: 'zombie',
	skeleton: 'skeleton',
	spider: 'spider',
	creeper: 'creeper',
	wolf: 'wolf',
	bear: 'bear',
	cow: 'cow',
	pig: 'pig',
	sheep: 'sheep',
	chicken: 'chicken',
} as const;

export type MobType = typeof MOB[keyof typeof MOB];
export const MOB_TYPES: MobType[] = Object.values(MOB);

export type MobDrop = { id: number; min: number; max: number; chance?: number };

export type MobDef = {
	type: MobType;
	maxHp: number;
	/** 歩く速さ (ブロック/秒) */
	speed: number;
	/** 1 回の攻撃のダメージ (0 なら攻撃しない) */
	attack: number;
	/** 攻撃の間隔 (秒) */
	attackInterval: number;
	/** 当たり判定の幅と高さ */
	width: number;
	height: number;
	/** この距離以内のプレイヤーを追う (0 なら追わない) */
	aggroRange: number;
	/** 敵対的 (プレイヤーを襲う) */
	hostile: boolean;
	/** 殴られると逃げる */
	flees: boolean;
	/** 夜だけ湧く (昼は燃える) */
	nightOnly: boolean;
	/** 昼に燃えて消える */
	burnsInDay: boolean;
	/** 昼だけ湧く (家畜) */
	dayOnly: boolean;
	/** 湧くバイオーム (空なら全部) */
	biomes: BiomeId[];
	/** 同時に存在できる数 (ホストあたり) */
	cap: number;
	/** 倒したときのドロップ */
	drops: MobDrop[];
	/** 倒したときの経験値 [min, max] */
	xp: [number, number];
	/** 遠距離攻撃 */
	ranged?: { minRange: number; maxRange: number; damage: number; interval: number; speed: number };
	/** 爆発 (クリーパー) */
	explode?: { fuseSeconds: number; radius: number; damage: number; triggerRange: number };
	/** 夜や暗い所でだけ敵対 (クモ) */
	hostileAtNightOnly?: boolean;
	color: string;
};

const md = (def: MobDef) => def;

export const MOB_DEFS: Record<MobType, MobDef> = {
	zombie: md({ type: 'zombie', maxHp: 20, speed: 2.4, attack: 3, attackInterval: 1.2, width: 0.6, height: 1.9, aggroRange: 20, hostile: true, flees: false, nightOnly: true, burnsInDay: true, dayOnly: false, biomes: [], cap: 8, drops: [{ id: ITEM.rottenFlesh, min: 0, max: 2 }, { id: ITEM.ironIngot, min: 1, max: 1, chance: 0.025 }], xp: [5, 5], color: '#5c8f4a' }),
	skeleton: md({ type: 'skeleton', maxHp: 20, speed: 2.6, attack: 2, attackInterval: 1.5, width: 0.6, height: 1.95, aggroRange: 18, hostile: true, flees: false, nightOnly: true, burnsInDay: true, dayOnly: false, biomes: [], cap: 5, drops: [{ id: ITEM.bone, min: 0, max: 2 }, { id: ITEM.arrow, min: 0, max: 2 }], xp: [5, 5], ranged: { minRange: 4, maxRange: 14, damage: 3, interval: 2, speed: 28 }, color: '#d8d8d8' }),
	spider: md({ type: 'spider', maxHp: 16, speed: 4.2, attack: 2, attackInterval: 1.0, width: 1.4, height: 0.9, aggroRange: 16, hostile: true, flees: false, nightOnly: true, burnsInDay: false, dayOnly: false, biomes: [], cap: 5, drops: [{ id: ITEM.string, min: 0, max: 2 }], xp: [5, 5], hostileAtNightOnly: true, color: '#2f2a2a' }),
	creeper: md({ type: 'creeper', maxHp: 20, speed: 2.7, attack: 0, attackInterval: 1, width: 0.6, height: 1.7, aggroRange: 16, hostile: true, flees: false, nightOnly: true, burnsInDay: false, dayOnly: false, biomes: [], cap: 4, drops: [{ id: ITEM.coal, min: 0, max: 2 }], xp: [5, 5], explode: { fuseSeconds: 1.5, radius: 3.5, damage: 24, triggerRange: 3 }, color: '#4caf50' }),
	wolf: md({ type: 'wolf', maxHp: 8, speed: 5, attack: 2, attackInterval: 0.8, width: 0.6, height: 0.85, aggroRange: 12, hostile: true, flees: false, nightOnly: false, burnsInDay: false, dayOnly: false, biomes: [BIOME.forest, BIOME.taiga], cap: 4, drops: [{ id: ITEM.rawMeat, min: 1, max: 1 }], xp: [1, 3], color: '#b8b8b8' }),
	bear: md({ type: 'bear', maxHp: 30, speed: 3.2, attack: 6, attackInterval: 1.5, width: 1.2, height: 1.3, aggroRange: 10, hostile: true, flees: false, nightOnly: false, burnsInDay: false, dayOnly: false, biomes: [BIOME.forest, BIOME.mountains, BIOME.taiga], cap: 2, drops: [{ id: ITEM.rawMeat, min: 2, max: 3 }, { id: ITEM.leather, min: 0, max: 1 }], xp: [1, 3], color: '#5a3b22' }),
	cow: md({ type: 'cow', maxHp: 10, speed: 2.0, attack: 0, attackInterval: 1, width: 0.9, height: 1.4, aggroRange: 0, hostile: false, flees: true, nightOnly: false, burnsInDay: false, dayOnly: true, biomes: [BIOME.plains, BIOME.forest, BIOME.birchForest], cap: 6, drops: [{ id: ITEM.rawBeef, min: 1, max: 3 }, { id: ITEM.leather, min: 0, max: 2 }], xp: [1, 3], color: '#4a3424' }),
	pig: md({ type: 'pig', maxHp: 10, speed: 2.0, attack: 0, attackInterval: 1, width: 0.9, height: 0.9, aggroRange: 0, hostile: false, flees: true, nightOnly: false, burnsInDay: false, dayOnly: true, biomes: [BIOME.plains, BIOME.forest, BIOME.swamp], cap: 6, drops: [{ id: ITEM.rawPorkchop, min: 1, max: 3 }], xp: [1, 3], color: '#f0a8a8' }),
	sheep: md({ type: 'sheep', maxHp: 8, speed: 2.0, attack: 0, attackInterval: 1, width: 0.9, height: 1.3, aggroRange: 0, hostile: false, flees: true, nightOnly: false, burnsInDay: false, dayOnly: true, biomes: [BIOME.plains, BIOME.mountains, BIOME.birchForest], cap: 6, drops: [{ id: ITEM.rawMutton, min: 1, max: 2 }, { id: BLOCK.wool, min: 1, max: 1 }], xp: [1, 3], color: '#e9e9e9' }),
	chicken: md({ type: 'chicken', maxHp: 4, speed: 2.2, attack: 0, attackInterval: 1, width: 0.4, height: 0.7, aggroRange: 0, hostile: false, flees: true, nightOnly: false, burnsInDay: false, dayOnly: true, biomes: [BIOME.plains, BIOME.forest, BIOME.birchForest, BIOME.swamp], cap: 6, drops: [{ id: ITEM.rawChicken, min: 1, max: 1 }, { id: ITEM.feather, min: 0, max: 2 }], xp: [1, 3], color: '#f4f4f4' }),
};
