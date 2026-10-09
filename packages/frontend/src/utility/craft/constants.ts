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

/**
 * ワールドごとの時刻のずれ (ms)。ベッドで夜を飛ばすとサーバーが更新し、全員に配る。
 * サーバーの craft_world.timeOffset と同じ値
 */
let worldTimeOffset = 0;

export function setWorldTimeOffset(ms: number): void {
	worldTimeOffset = Number.isFinite(ms) ? ms : 0;
}

export function getWorldTimeOffset(): number {
	return worldTimeOffset;
}

/** 0..1 の一日の時刻。0 = 朝 6 時相当、0.5 = 夕方 */
export function timeOfDay(now = Date.now()): number {
	return (((now + worldTimeOffset) % DAY_LENGTH_MS) + DAY_LENGTH_MS) % DAY_LENGTH_MS / DAY_LENGTH_MS;
}

/** 夜を飛ばして朝 (時刻 0) にするための時刻のずれ */
export function timeOffsetForMorning(now = Date.now()): number {
	return (DAY_LENGTH_MS - (now % DAY_LENGTH_MS)) % DAY_LENGTH_MS;
}

/** 寝て夜を飛ばせる時間帯 */
export function canSleepNow(now = Date.now()): boolean {
	const t = timeOfDay(now);
	return t >= 0.5 && t < 0.97;
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
	// 建材 (立方体)
	smoothStone: 50,
	andesite: 51,
	granite: 52,
	diorite: 53,
	polishedAndesite: 54,
	polishedGranite: 55,
	polishedDiorite: 56,
	deepslate: 57,
	deepslateBricks: 58,
	terracotta: 59,
	dandelion: 60,
	chiseledStoneBricks: 61,
	mossyStoneBricks: 62,
	smoothSandstone: 63,
	spruceLog: 64,
	sprucePlanks: 65,
	barrel: 66,
	// 家具・小物 (箱形)
	chest: 67,
	lantern: 68,
	ironBars: 69,
	glassPane: 70,
	// 色付き羊毛
	redWool: 71,
	yellowWool: 72,
	blueWool: 73,
	greenWool: 74,
	blackWool: 75,
	grayWool: 76,
	orangeWool: 77,
	purpleWool: 78,
	pinkWool: 79,
	lightBlueWool: 80,
	limeWool: 81,
	// コンクリート
	whiteConcrete: 82,
	grayConcrete: 83,
	blackConcrete: 84,
	redConcrete: 85,
	blueConcrete: 86,
	greenConcrete: 87,
	yellowConcrete: 88,
	orangeConcrete: 89,
	// カーペット
	whiteCarpet: 90,
	redCarpet: 91,
	blueCarpet: 92,
	greenCarpet: 93,
	// 半ブロック
	oakSlab: 94,
	birchSlab: 95,
	spruceSlab: 96,
	stoneSlab: 97,
	cobblestoneSlab: 98,
	stoneBrickSlab: 99,
	sandstoneSlab: 100,
	smoothStoneSlab: 101,
	// 階段 (向き 4 種。0: -z、1: +x、2: +z、3: -x)
	oakStairs: 102,
	oakStairs1: 103,
	oakStairs2: 104,
	oakStairs3: 105,
	cobblestoneStairs: 106,
	cobblestoneStairs1: 107,
	cobblestoneStairs2: 108,
	cobblestoneStairs3: 109,
	stoneBrickStairs: 110,
	stoneBrickStairs1: 111,
	stoneBrickStairs2: 112,
	stoneBrickStairs3: 113,
	// 柵・塀
	oakFence: 114,
	cobblestoneWall: 115,
	// ドア (x 軸 / z 軸の板、下半分 / 上半分。開閉は軸の入れ替え。ドロップは下半分だけ)
	oakDoor: 116,
	oakDoorUpper: 117,
	oakDoorZ: 118,
	oakDoorZUpper: 119,
	// 家具
	oakTable: 120,
	oakStool: 121,
	oakChair: 122,
	oakChair1: 123,
	oakChair2: 124,
	oakChair3: 125,
	flowerPot: 126,
	// 壁付きの松明 (向き = 壁のある方向。0: -z、1: +x、2: +z、3: -x)
	wallTorch: 127,
	wallTorch1: 128,
	wallTorch2: 129,
	wallTorch3: 130,
	// 追加の階段
	birchStairs: 131,
	birchStairs1: 132,
	birchStairs2: 133,
	birchStairs3: 134,
	spruceStairs: 135,
	spruceStairs1: 136,
	spruceStairs2: 137,
	spruceStairs3: 138,
	sandstoneStairs: 139,
	sandstoneStairs1: 140,
	sandstoneStairs2: 141,
	sandstoneStairs3: 142,
	smoothStoneStairs: 143,
	smoothStoneStairs1: 144,
	smoothStoneStairs2: 145,
	smoothStoneStairs3: 146,
	deepslateBrickStairs: 147,
	deepslateBrickStairs1: 148,
	deepslateBrickStairs2: 149,
	deepslateBrickStairs3: 150,
	// 追加の半ブロック
	deepslateBrickSlab: 151,
	polishedAndesiteSlab: 152,
	polishedGraniteSlab: 153,
	polishedDioriteSlab: 154,
	// 追加の柵・塀
	birchFence: 155,
	spruceFence: 156,
	stoneBrickWall: 157,
	deepslateBrickWall: 158,
	// 追加のドア
	birchDoor: 159,
	birchDoorUpper: 160,
	birchDoorZ: 161,
	birchDoorZUpper: 162,
	spruceDoor: 163,
	spruceDoorUpper: 164,
	spruceDoorZ: 165,
	spruceDoorZUpper: 166,
	// 追加の家具
	birchTable: 167,
	spruceTable: 168,
	birchStool: 169,
	spruceStool: 170,
	birchChair: 171,
	birchChair1: 172,
	birchChair2: 173,
	birchChair3: 174,
	spruceChair: 175,
	spruceChair1: 176,
	spruceChair2: 177,
	spruceChair3: 178,
	// 色ガラス・柱・レンガの階段と半ブロック
	redStainedGlass: 179,
	blueStainedGlass: 180,
	greenStainedGlass: 181,
	yellowStainedGlass: 182,
	stonePillar: 183,
	brickSlab: 184,
	brickStairs: 185,
	brickStairs1: 186,
	brickStairs2: 187,
	brickStairs3: 188,
} as const;

export type BlockKey = keyof typeof BLOCK;
export type BlockId = typeof BLOCK[keyof typeof BLOCK];
export const MAX_BLOCK_TYPE = 188;

export type ToolKind = 'none' | 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword';
/** 0: 素手, 1: 木 (と金), 2: 石, 3: 鉄, 4: ダイヤ */
export type ToolTier = 0 | 1 | 2 | 3 | 4;

/** メッシュの形。cube 以外は当たり判定を持たない (solid: false) */
/**
 * メッシュの形。cube 以外のうち boxes は 1/16 単位の箱の集まりで、描画と当たり判定の両方に使う
 * (shapes.ts の blockBoxes が隣接による枝も含めて返す)
 */
export type BlockShape = 'cube' | 'cross' | 'torch' | 'ladder' | 'bed' | 'farmland' | 'boxes';
/** 1/16 単位の箱 [x0, y0, z0, x1, y1, z1] */
export type ShapeBox = [number, number, number, number, number, number];

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
	/** shape が boxes のときの固定の箱 (1/16 単位)。connect があるときは中心の柱だけ */
	boxes?: ShapeBox[];
	/** 隣接で枝を伸ばす (柵・塀・板)。shapes.ts が枝を足す */
	connect?: 'fence' | 'wall' | 'pane';
	/** 当たり判定の高さを描画より高くする (柵は 1.5) */
	collisionHeight?: number;
	/** 向きのある形 (階段・椅子)。facingSet[facing] が自分。設置時は向き 0 のアイテムからプレイヤーの向きで選ぶ */
	facing?: 0 | 1 | 2 | 3;
	facingSet?: [BlockId, BlockId, BlockId, BlockId];
	/** ドアの半分と軸。使うと軸が入れ替わる (開閉) */
	door?: { half: 'lower' | 'upper'; axis: 'x' | 'z' };
	/** 表示名のキー (向き違いの変種が共有する)。省略時は key */
	nameKey?: string;
};

/**
 * ブロックはそのままアイテム id として使う (1..MAX_BLOCK_TYPE、最大 255)。
 * 素材・染料は 400 以降、道具は 200 以降、防具は 300 以降。
 * (以前は素材が 100 以降だったが、ブロック id が 100 を超えて衝突したため 2026-10-09 に +300 した。
 * 保存データの古い id は LEGACY_ITEM_IDS で読み替える)
 */
export const ITEM = {
	stick: 400,
	coal: 401,
	rawIron: 402,
	ironIngot: 403,
	apple: 404,
	rawMeat: 405,
	cookedMeat: 406,
	rawGold: 407,
	goldIngot: 408,
	diamond: 409,
	lapis: 430,
	leather: 431,
	feather: 432,
	bone: 433,
	string: 434,
	rottenFlesh: 435,
	wheatSeeds: 436,
	wheat: 437,
	bread: 438,
	goldenApple: 439,
	rawBeef: 440,
	cookedBeef: 441,
	rawPorkchop: 442,
	cookedPorkchop: 443,
	rawChicken: 444,
	cookedChicken: 445,
	rawMutton: 446,
	cookedMutton: 447,
	arrow: 448,
	bow: 449,
	egg: 450,
	charcoal: 451,
	brick: 452,
	book: 453,
	paper: 454,
	melonSlice: 455,
	pumpkinPie: 456,
	// 染料
	redDye: 457,
	yellowDye: 458,
	blueDye: 459,
	greenDye: 460,
	whiteDye: 461,
	blackDye: 462,
	grayDye: 463,
	orangeDye: 464,
	purpleDye: 465,
	pinkDye: 466,
	lightBlueDye: 467,
	limeDye: 468,
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

const b = (def: BlockDef) => def;

const cube = (id: BlockId, key: Exclude<BlockKey, 'air'>, tiles: [number, number, number], color: string, hardness: number, tool: ToolKind, minTier: ToolTier, drops: BlockDef['drops'], sound: SoundMaterialId, extra: Partial<BlockDef> = {}): BlockDef =>
	b({ id, key, shape: 'cube', transparent: false, translucent: false, solid: true, light: 0, opacity: 15, tiles, color, hardness, tool, minTier, drops, placeable: true, sound, ...extra });

const plant = (id: BlockId, key: Exclude<BlockKey, 'air'>, tile: number, color: string, drops: BlockDef['drops'], extra: Partial<BlockDef> = {}): BlockDef =>
	b({ id, key, shape: 'cross', transparent: true, translucent: false, solid: false, light: 0, opacity: 0, tiles: [tile, tile, tile], color, hardness: 0, tool: 'none', minTier: 0, drops, placeable: true, sound: 'grass', support: 'below', ...extra });

/** 箱形 (半ブロック・家具など)。solid は当たり判定あり */
const boxBlock = (id: BlockId, key: Exclude<BlockKey, 'air'>, tiles: [number, number, number], color: string, hardness: number, tool: ToolKind, minTier: ToolTier, drops: BlockDef['drops'], sound: SoundMaterialId, boxes: ShapeBox[], extra: Partial<BlockDef> = {}): BlockDef =>
	b({ id, key, shape: 'boxes', transparent: true, translucent: false, solid: true, light: 0, opacity: 0, tiles, color, hardness, tool, minTier, drops, placeable: true, sound, boxes, ...extra });

const SLAB: ShapeBox[] = [[0, 0, 0, 16, 8, 16]];
const CARPET: ShapeBox[] = [[0, 0, 0, 16, 1, 16]];

/** 階段。向き f の高い側: 0 は z 0..8、1 は x 8..16、2 は z 8..16、3 は x 0..8 */
function stairBoxes(f: 0 | 1 | 2 | 3): ShapeBox[] {
	const high: ShapeBox = f === 0 ? [0, 8, 0, 16, 16, 8] : f === 1 ? [8, 8, 0, 16, 16, 16] : f === 2 ? [0, 8, 8, 16, 16, 16] : [0, 8, 0, 8, 16, 16];
	return [[0, 0, 0, 16, 8, 16], high];
}

/** 椅子。背もたれは向きの側 (置いた人の方を向いて座る形になる) */
function chairBoxes(f: 0 | 1 | 2 | 3): ShapeBox[] {
	const back: ShapeBox = f === 0 ? [2, 10, 2, 14, 16, 4] : f === 1 ? [12, 10, 2, 14, 16, 14] : f === 2 ? [2, 10, 12, 14, 16, 14] : [2, 10, 2, 4, 16, 14];
	return [[2, 8, 2, 14, 10, 14], [2, 0, 2, 4, 8, 4], [12, 0, 2, 14, 8, 4], [2, 0, 12, 4, 8, 14], [12, 0, 12, 14, 8, 14], back];
}

const TABLE: ShapeBox[] = [[0, 12, 0, 16, 16, 16], [1, 0, 1, 3, 12, 3], [13, 0, 1, 15, 12, 3], [1, 0, 13, 3, 12, 15], [13, 0, 13, 15, 12, 15]];
const STOOL: ShapeBox[] = [[3, 8, 3, 13, 10, 13], [4, 0, 4, 6, 8, 6], [10, 0, 4, 12, 8, 6], [4, 0, 10, 6, 8, 12], [10, 0, 10, 12, 8, 12]];
const CHEST: ShapeBox[] = [[1, 0, 1, 15, 14, 15]];
const LANTERN: ShapeBox[] = [[5, 0, 5, 11, 7, 11], [6, 7, 6, 10, 9, 10]];
const FLOWER_POT: ShapeBox[] = [[5, 0, 5, 11, 6, 11]];
const FENCE_POST: ShapeBox[] = [[6, 0, 6, 10, 16, 10]];
const WALL_POST: ShapeBox[] = [[4, 0, 4, 12, 16, 12]];
const PANE_POST: ShapeBox[] = [[7, 0, 7, 9, 16, 9]];
const DOOR_X: ShapeBox[] = [[0, 0, 0, 16, 16, 3]];
const DOOR_Z: ShapeBox[] = [[0, 0, 0, 3, 16, 16]];

/** ドア 4 変種 (x 下、x 上、z 下、z 上) を base から連番で登録する。ドロップは下半分だけ */
function addDoor(add: (def: BlockDef) => void, key: string, base: BlockId, tiles: [number, number], color: string): void {
	const ids = [base, base + 1, base + 2, base + 3] as BlockId[];
	const keys = [key, `${key}Upper`, `${key}Z`, `${key}ZUpper`] as Exclude<BlockKey, 'air'>[];
	const axes: ('x' | 'z')[] = ['x', 'x', 'z', 'z'];
	const halves: ('lower' | 'upper')[] = ['lower', 'upper', 'lower', 'upper'];
	for (let i = 0; i < 4; i++) {
		add(boxBlock(ids[i], keys[i], [tiles[halves[i] === 'lower' ? 0 : 1], tiles[halves[i] === 'lower' ? 0 : 1], tiles[0]], color, 3, 'axe', 0, halves[i] === 'lower' ? { id: base } : null, 'wood', axes[i] === 'x' ? DOOR_X : DOOR_Z, {
			door: { half: halves[i], axis: axes[i] }, placeable: i === 0, usable: true, nameKey: key, support: halves[i] === 'lower' ? 'below' : undefined,
		}));
	}
}

/** 階段 4 向きを base から連番で登録する */
function addStairs(add: (def: BlockDef) => void, key: string, base: BlockId, tiles: [number, number, number], color: string, tool: ToolKind): void {
	const set: [BlockId, BlockId, BlockId, BlockId] = [base, (base + 1) as BlockId, (base + 2) as BlockId, (base + 3) as BlockId];
	for (let f = 0; f < 4; f++) {
		add(boxBlock(set[f], (f === 0 ? key : `${key}${f}`) as Exclude<BlockKey, 'air'>, tiles, color, 2, tool, tool === 'pickaxe' ? 1 : 0, { id: base }, tool === 'axe' ? 'wood' : 'stone', stairBoxes(f as 0 | 1 | 2 | 3), { facing: f as 0 | 1 | 2 | 3, facingSet: set, placeable: f === 0, nameKey: key, fuel: tool === 'axe' ? 1 : undefined }));
	}
}

/** 椅子 4 向き */
function addChair(add: (def: BlockDef) => void, key: string, base: BlockId, tile: number, color: string): void {
	const set: [BlockId, BlockId, BlockId, BlockId] = [base, (base + 1) as BlockId, (base + 2) as BlockId, (base + 3) as BlockId];
	for (let f = 0; f < 4; f++) {
		add(boxBlock(set[f], (f === 0 ? key : `${key}${f}`) as Exclude<BlockKey, 'air'>, [tile, tile, tile], color, 2, 'axe', 0, { id: base }, 'wood', chairBoxes(f as 0 | 1 | 2 | 3), { facing: f as 0 | 1 | 2 | 3, facingSet: set, placeable: f === 0, nameKey: key, fuel: 1 }));
	}
}

function buildBuildingBlocks(): Record<number, BlockDef> {
	const out: Record<number, BlockDef> = {};
	const add = (def: BlockDef) => { out[def.id] = def; };
	// 石材
	add(cube(BLOCK.smoothStone, 'smoothStone', [80, 80, 80], '#a0a0a0', 2, 'pickaxe', 1, { id: BLOCK.smoothStone }, 'stone'));
	add(cube(BLOCK.andesite, 'andesite', [81, 81, 81], '#8a8a86', 1.5, 'pickaxe', 1, { id: BLOCK.andesite }, 'stone'));
	add(cube(BLOCK.granite, 'granite', [82, 82, 82], '#a07060', 1.5, 'pickaxe', 1, { id: BLOCK.granite }, 'stone'));
	add(cube(BLOCK.diorite, 'diorite', [83, 83, 83], '#c8c8c4', 1.5, 'pickaxe', 1, { id: BLOCK.diorite }, 'stone'));
	add(cube(BLOCK.polishedAndesite, 'polishedAndesite', [84, 84, 84], '#94948f', 1.5, 'pickaxe', 1, { id: BLOCK.polishedAndesite }, 'stone'));
	add(cube(BLOCK.polishedGranite, 'polishedGranite', [85, 85, 85], '#a87868', 1.5, 'pickaxe', 1, { id: BLOCK.polishedGranite }, 'stone'));
	add(cube(BLOCK.polishedDiorite, 'polishedDiorite', [86, 86, 86], '#d2d2cf', 1.5, 'pickaxe', 1, { id: BLOCK.polishedDiorite }, 'stone'));
	add(cube(BLOCK.deepslate, 'deepslate', [87, 88, 87], '#4b4b52', 3, 'pickaxe', 1, { id: BLOCK.deepslate }, 'stone'));
	add(cube(BLOCK.deepslateBricks, 'deepslateBricks', [89, 89, 89], '#55555c', 3.5, 'pickaxe', 1, { id: BLOCK.deepslateBricks }, 'stone'));
	add(cube(BLOCK.terracotta, 'terracotta', [90, 90, 90], '#9a5a3c', 1.25, 'pickaxe', 1, { id: BLOCK.terracotta }, 'stone'));
	add(plant(BLOCK.dandelion, 'dandelion', 91, '#f0d040', { id: BLOCK.dandelion }, { replaceable: true }));
	add(cube(BLOCK.chiseledStoneBricks, 'chiseledStoneBricks', [92, 92, 92], '#7d7d7d', 1.5, 'pickaxe', 1, { id: BLOCK.chiseledStoneBricks }, 'stone'));
	add(cube(BLOCK.mossyStoneBricks, 'mossyStoneBricks', [93, 93, 93], '#6c7c5c', 1.5, 'pickaxe', 1, { id: BLOCK.mossyStoneBricks }, 'stone'));
	add(cube(BLOCK.smoothSandstone, 'smoothSandstone', [94, 94, 94], '#e0d6a4', 2, 'pickaxe', 1, { id: BLOCK.smoothSandstone }, 'stone'));
	add(cube(BLOCK.spruceLog, 'spruceLog', [95, 96, 95], '#5a3f24', 2, 'axe', 0, { id: BLOCK.spruceLog }, 'wood', { fuel: 1 }));
	add(cube(BLOCK.sprucePlanks, 'sprucePlanks', [97, 97, 97], '#7a5a34', 2, 'axe', 0, { id: BLOCK.sprucePlanks }, 'wood', { fuel: 1 }));
	add(cube(BLOCK.barrel, 'barrel', [98, 99, 98], '#7a5a34', 2.5, 'axe', 0, { id: BLOCK.barrel }, 'wood', { fuel: 1 }));
	// 家具・小物
	add(boxBlock(BLOCK.chest, 'chest', [100, 101, 100], '#9c6b3c', 2.5, 'axe', 0, { id: BLOCK.chest }, 'wood', CHEST, { fuel: 1 }));
	add(boxBlock(BLOCK.lantern, 'lantern', [102, 102, 102], '#f0c060', 3.5, 'pickaxe', 0, { id: BLOCK.lantern }, 'metal', LANTERN, { light: 15, support: 'below' }));
	add(boxBlock(BLOCK.ironBars, 'ironBars', [103, 103, 103], '#8a8a8a', 5, 'pickaxe', 1, { id: BLOCK.ironBars }, 'metal', PANE_POST, { connect: 'pane' }));
	add(boxBlock(BLOCK.glassPane, 'glassPane', [12, 12, 12], '#c8e8f0', 0.3, 'none', 0, null, 'glass', PANE_POST, { connect: 'pane', translucent: true, silk: true }));
	// 羊毛・コンクリート・カーペット
	const wools: [BlockId, Exclude<BlockKey, 'air'>, number, string][] = [
		[BLOCK.redWool, 'redWool', 105, '#b03a2e'], [BLOCK.yellowWool, 'yellowWool', 106, '#e6c43a'], [BLOCK.blueWool, 'blueWool', 107, '#35479b'],
		[BLOCK.greenWool, 'greenWool', 108, '#4f7a2a'], [BLOCK.blackWool, 'blackWool', 109, '#202020'], [BLOCK.grayWool, 'grayWool', 110, '#6e6e6e'],
		[BLOCK.orangeWool, 'orangeWool', 111, '#e0792a'], [BLOCK.purpleWool, 'purpleWool', 112, '#7a3aa0'], [BLOCK.pinkWool, 'pinkWool', 113, '#e8a0b8'],
		[BLOCK.lightBlueWool, 'lightBlueWool', 114, '#74b6e0'], [BLOCK.limeWool, 'limeWool', 115, '#80c535'],
	];
	for (const [id, key, tile, color] of wools) add(cube(id, key, [tile, tile, tile], color, 0.8, 'none', 0, { id }, 'wool'));
	const concretes: [BlockId, Exclude<BlockKey, 'air'>, number, string][] = [
		[BLOCK.whiteConcrete, 'whiteConcrete', 116, '#d8d8d8'], [BLOCK.grayConcrete, 'grayConcrete', 117, '#5a5a5a'], [BLOCK.blackConcrete, 'blackConcrete', 118, '#141414'],
		[BLOCK.redConcrete, 'redConcrete', 119, '#9c2a26'], [BLOCK.blueConcrete, 'blueConcrete', 120, '#2c3f8f'], [BLOCK.greenConcrete, 'greenConcrete', 121, '#4c6b23'],
		[BLOCK.yellowConcrete, 'yellowConcrete', 122, '#e5b53a'], [BLOCK.orangeConcrete, 'orangeConcrete', 123, '#d9731e'],
	];
	for (const [id, key, tile, color] of concretes) add(cube(id, key, [tile, tile, tile], color, 1.8, 'pickaxe', 1, { id }, 'stone'));
	const carpets: [BlockId, Exclude<BlockKey, 'air'>, number, string][] = [
		[BLOCK.whiteCarpet, 'whiteCarpet', 30, '#e9e9e9'], [BLOCK.redCarpet, 'redCarpet', 105, '#b03a2e'], [BLOCK.blueCarpet, 'blueCarpet', 107, '#35479b'], [BLOCK.greenCarpet, 'greenCarpet', 108, '#4f7a2a'],
	];
	for (const [id, key, tile, color] of carpets) add(boxBlock(id, key, [tile, tile, tile], color, 0.1, 'none', 0, { id }, 'wool', CARPET, { support: 'below' }));
	// 半ブロック
	const slabs: [BlockId, Exclude<BlockKey, 'air'>, [number, number, number], string, ToolKind, number][] = [
		[BLOCK.oakSlab, 'oakSlab', [9, 9, 9], '#b48c5a', 'axe', 2], [BLOCK.birchSlab, 'birchSlab', [64, 64, 64], '#d9c99a', 'axe', 2], [BLOCK.spruceSlab, 'spruceSlab', [97, 97, 97], '#7a5a34', 'axe', 2],
		[BLOCK.stoneSlab, 'stoneSlab', [3, 3, 3], '#8a8a8a', 'pickaxe', 2], [BLOCK.cobblestoneSlab, 'cobblestoneSlab', [11, 11, 11], '#6f6f6f', 'pickaxe', 2], [BLOCK.stoneBrickSlab, 'stoneBrickSlab', [29, 29, 29], '#7d7d7d', 'pickaxe', 2],
		[BLOCK.sandstoneSlab, 'sandstoneSlab', [54, 55, 54], '#d9cf9a', 'pickaxe', 2], [BLOCK.smoothStoneSlab, 'smoothStoneSlab', [80, 80, 80], '#a0a0a0', 'pickaxe', 2],
	];
	for (const [id, key, tiles, color, tool, hardness] of slabs) add(boxBlock(id, key, tiles, color, hardness, tool, tool === 'pickaxe' ? 1 : 0, { id }, tool === 'axe' ? 'wood' : 'stone', SLAB, tool === 'axe' ? { fuel: 1 } : {}));
	// 階段 (向き 4 種)
	addStairs(add, 'oakStairs', BLOCK.oakStairs, [9, 9, 9], '#b48c5a', 'axe');
	addStairs(add, 'cobblestoneStairs', BLOCK.cobblestoneStairs, [11, 11, 11], '#6f6f6f', 'pickaxe');
	addStairs(add, 'stoneBrickStairs', BLOCK.stoneBrickStairs, [29, 29, 29], '#7d7d7d', 'pickaxe');
	addStairs(add, 'birchStairs', BLOCK.birchStairs, [64, 64, 64], '#d9c99a', 'axe');
	addStairs(add, 'spruceStairs', BLOCK.spruceStairs, [97, 97, 97], '#7a5a34', 'axe');
	addStairs(add, 'sandstoneStairs', BLOCK.sandstoneStairs, [54, 55, 54], '#d9cf9a', 'pickaxe');
	addStairs(add, 'smoothStoneStairs', BLOCK.smoothStoneStairs, [80, 80, 80], '#a0a0a0', 'pickaxe');
	addStairs(add, 'deepslateBrickStairs', BLOCK.deepslateBrickStairs, [89, 89, 89], '#55555c', 'pickaxe');
	addStairs(add, 'brickStairs', BLOCK.brickStairs, [10, 10, 10], '#a04b3a', 'pickaxe');
	// 追加の半ブロック
	add(boxBlock(BLOCK.deepslateBrickSlab, 'deepslateBrickSlab', [89, 89, 89], '#55555c', 2, 'pickaxe', 1, { id: BLOCK.deepslateBrickSlab }, 'stone', SLAB));
	add(boxBlock(BLOCK.polishedAndesiteSlab, 'polishedAndesiteSlab', [84, 84, 84], '#94948f', 2, 'pickaxe', 1, { id: BLOCK.polishedAndesiteSlab }, 'stone', SLAB));
	add(boxBlock(BLOCK.polishedGraniteSlab, 'polishedGraniteSlab', [85, 85, 85], '#a87868', 2, 'pickaxe', 1, { id: BLOCK.polishedGraniteSlab }, 'stone', SLAB));
	add(boxBlock(BLOCK.polishedDioriteSlab, 'polishedDioriteSlab', [86, 86, 86], '#d2d2cf', 2, 'pickaxe', 1, { id: BLOCK.polishedDioriteSlab }, 'stone', SLAB));
	add(boxBlock(BLOCK.brickSlab, 'brickSlab', [10, 10, 10], '#a04b3a', 2, 'pickaxe', 1, { id: BLOCK.brickSlab }, 'stone', SLAB));
	// 色ガラス・柱
	const glasses: [BlockId, Exclude<BlockKey, 'air'>, number, string][] = [
		[BLOCK.redStainedGlass, 'redStainedGlass', 132, '#c84a4a'], [BLOCK.blueStainedGlass, 'blueStainedGlass', 133, '#4a6ac8'], [BLOCK.greenStainedGlass, 'greenStainedGlass', 134, '#5ab05a'], [BLOCK.yellowStainedGlass, 'yellowStainedGlass', 135, '#e0d05a'],
	];
	for (const [id, key, tile, color] of glasses) add(b({ id, key, shape: 'cube', transparent: true, translucent: true, solid: true, light: 0, opacity: 0, tiles: [tile, tile, tile], color, hardness: 0.3, tool: 'none', minTier: 0, drops: null, silk: true, placeable: true, sound: 'glass' }));
	add(cube(BLOCK.stonePillar, 'stonePillar', [136, 137, 136], '#b8b8b4', 2, 'pickaxe', 1, { id: BLOCK.stonePillar }, 'stone'));
	// 柵・塀・ドア
	add(boxBlock(BLOCK.oakFence, 'oakFence', [9, 9, 9], '#b48c5a', 2, 'axe', 0, { id: BLOCK.oakFence }, 'wood', FENCE_POST, { connect: 'fence', collisionHeight: 1.5, fuel: 1 }));
	add(boxBlock(BLOCK.cobblestoneWall, 'cobblestoneWall', [11, 11, 11], '#6f6f6f', 2, 'pickaxe', 1, { id: BLOCK.cobblestoneWall }, 'stone', WALL_POST, { connect: 'wall', collisionHeight: 1.5 }));
	addDoor(add, 'oakDoor', BLOCK.oakDoor, [124, 125], '#b48c5a');
	addDoor(add, 'birchDoor', BLOCK.birchDoor, [128, 129], '#d9c99a');
	addDoor(add, 'spruceDoor', BLOCK.spruceDoor, [130, 131], '#7a5a34');
	// 家具
	add(boxBlock(BLOCK.oakTable, 'oakTable', [9, 9, 9], '#b48c5a', 2, 'axe', 0, { id: BLOCK.oakTable }, 'wood', TABLE, { fuel: 1 }));
	add(boxBlock(BLOCK.oakStool, 'oakStool', [9, 9, 9], '#b48c5a', 2, 'axe', 0, { id: BLOCK.oakStool }, 'wood', STOOL, { fuel: 1 }));
	addChair(add, 'oakChair', BLOCK.oakChair, 9, '#b48c5a');
	addChair(add, 'birchChair', BLOCK.birchChair, 64, '#d9c99a');
	addChair(add, 'spruceChair', BLOCK.spruceChair, 97, '#7a5a34');
	add(boxBlock(BLOCK.birchTable, 'birchTable', [64, 64, 64], '#d9c99a', 2, 'axe', 0, { id: BLOCK.birchTable }, 'wood', TABLE, { fuel: 1 }));
	add(boxBlock(BLOCK.spruceTable, 'spruceTable', [97, 97, 97], '#7a5a34', 2, 'axe', 0, { id: BLOCK.spruceTable }, 'wood', TABLE, { fuel: 1 }));
	add(boxBlock(BLOCK.birchStool, 'birchStool', [64, 64, 64], '#d9c99a', 2, 'axe', 0, { id: BLOCK.birchStool }, 'wood', STOOL, { fuel: 1 }));
	add(boxBlock(BLOCK.spruceStool, 'spruceStool', [97, 97, 97], '#7a5a34', 2, 'axe', 0, { id: BLOCK.spruceStool }, 'wood', STOOL, { fuel: 1 }));
	// 追加の柵・塀
	add(boxBlock(BLOCK.birchFence, 'birchFence', [64, 64, 64], '#d9c99a', 2, 'axe', 0, { id: BLOCK.birchFence }, 'wood', FENCE_POST, { connect: 'fence', collisionHeight: 1.5, fuel: 1 }));
	add(boxBlock(BLOCK.spruceFence, 'spruceFence', [97, 97, 97], '#7a5a34', 2, 'axe', 0, { id: BLOCK.spruceFence }, 'wood', FENCE_POST, { connect: 'fence', collisionHeight: 1.5, fuel: 1 }));
	add(boxBlock(BLOCK.stoneBrickWall, 'stoneBrickWall', [29, 29, 29], '#7d7d7d', 2, 'pickaxe', 1, { id: BLOCK.stoneBrickWall }, 'stone', WALL_POST, { connect: 'wall', collisionHeight: 1.5 }));
	add(boxBlock(BLOCK.deepslateBrickWall, 'deepslateBrickWall', [89, 89, 89], '#55555c', 3.5, 'pickaxe', 1, { id: BLOCK.deepslateBrickWall }, 'stone', WALL_POST, { connect: 'wall', collisionHeight: 1.5 }));
	// 壁付きの松明 (向き = 壁の方向)。ドロップは普通の松明
	const torchSet: [BlockId, BlockId, BlockId, BlockId] = [BLOCK.wallTorch, BLOCK.wallTorch1, BLOCK.wallTorch2, BLOCK.wallTorch3];
	for (let f = 0; f < 4; f++) {
		add(b({ id: torchSet[f], key: (f === 0 ? 'wallTorch' : `wallTorch${f}`) as Exclude<BlockKey, 'air'>, shape: 'torch', transparent: true, translucent: false, solid: false, light: 14, opacity: 0, tiles: [27, 27, 27], color: '#ffcc55', hardness: 0, tool: 'none', minTier: 0, drops: { id: BLOCK.torch }, placeable: false, sound: 'wood', support: 'wall', facing: f as 0 | 1 | 2 | 3, facingSet: torchSet, nameKey: 'torch' }));
	}
	add(boxBlock(BLOCK.flowerPot, 'flowerPot', [126, 126, 126], '#a04b3a', 0.2, 'none', 0, { id: BLOCK.flowerPot }, 'stone', FLOWER_POT, { support: 'below' }));
	return out;
}

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
	[BLOCK.coalOre]: cube(BLOCK.coalOre, 'coalOre', [18, 18, 18], '#4a4a4a', 3, 'pickaxe', 1, { id: ITEM.coal }, 'stone', { silk: true, fortune: true, xp: [0, 2] }),
	[BLOCK.ironOre]: cube(BLOCK.ironOre, 'ironOre', [19, 19, 19], '#b89a7a', 3, 'pickaxe', 2, { id: ITEM.rawIron }, 'stone', { silk: true, fortune: true }),
	[BLOCK.bedrock]: b({ id: BLOCK.bedrock, key: 'bedrock', shape: 'cube', transparent: false, translucent: false, solid: true, light: 0, opacity: 15, tiles: [20, 20, 20], color: '#2a2a2a', hardness: Infinity, tool: 'none', minTier: 0, drops: null, placeable: false, sound: 'stone' }),
	[BLOCK.craftingTable]: cube(BLOCK.craftingTable, 'craftingTable', [21, 22, 9], '#9c6b3c', 2.5, 'axe', 0, { id: BLOCK.craftingTable }, 'wood', { usable: true, fuel: 1 }),
	[BLOCK.gravel]: cube(BLOCK.gravel, 'gravel', [23, 23, 23], '#8d8477', 0.6, 'shovel', 0, { id: BLOCK.gravel }, 'gravel'),
	[BLOCK.goldOre]: cube(BLOCK.goldOre, 'goldOre', [24, 24, 24], '#d9b84a', 3, 'pickaxe', 3, { id: ITEM.rawGold }, 'stone', { silk: true, fortune: true }),
	[BLOCK.diamondOre]: cube(BLOCK.diamondOre, 'diamondOre', [25, 25, 25], '#6fe3e0', 3, 'pickaxe', 3, { id: ITEM.diamond }, 'stone', { silk: true, fortune: true, xp: [3, 7] }),
	[BLOCK.lapisOre]: cube(BLOCK.lapisOre, 'lapisOre', [26, 26, 26], '#3a5bc7', 3, 'pickaxe', 2, { id: ITEM.lapis, count: 4 }, 'stone', { silk: true, fortune: true, xp: [2, 5] }),
	[BLOCK.torch]: b({ id: BLOCK.torch, key: 'torch', shape: 'torch', transparent: true, translucent: false, solid: false, light: 14, opacity: 0, tiles: [27, 27, 27], color: '#ffcc55', hardness: 0, tool: 'none', minTier: 0, drops: { id: BLOCK.torch }, placeable: true, sound: 'wood', support: 'below' }),
	[BLOCK.ladder]: b({ id: BLOCK.ladder, key: 'ladder', shape: 'ladder', transparent: true, translucent: false, solid: false, light: 0, opacity: 0, tiles: [28, 28, 28], color: '#b48c5a', hardness: 0.4, tool: 'axe', minTier: 0, drops: { id: BLOCK.ladder }, placeable: true, climbable: true, sound: 'wood', support: 'wall' }),
	[BLOCK.stoneBricks]: cube(BLOCK.stoneBricks, 'stoneBricks', [29, 29, 29], '#7d7d7d', 1.5, 'pickaxe', 1, { id: BLOCK.stoneBricks }, 'stone'),
	[BLOCK.wool]: cube(BLOCK.wool, 'wool', [30, 30, 30], '#e9e9e9', 0.8, 'none', 0, { id: BLOCK.wool }, 'wool'),
	[BLOCK.furnace]: cube(BLOCK.furnace, 'furnace', [31, 32, 31], '#6a6a6a', 3.5, 'pickaxe', 1, { id: BLOCK.furnace }, 'stone', { usable: true }),
	[BLOCK.enchantingTable]: cube(BLOCK.enchantingTable, 'enchantingTable', [33, 34, 40], '#5a2d7a', 5, 'pickaxe', 1, { id: BLOCK.enchantingTable }, 'stone', { usable: true, light: 7 }),
	[BLOCK.bed]: b({ id: BLOCK.bed, key: 'bed', shape: 'bed', transparent: true, translucent: false, solid: true, light: 0, opacity: 0, tiles: [35, 36, 9], color: '#c43b3b', hardness: 0.2, tool: 'none', minTier: 0, drops: { id: BLOCK.bed }, placeable: true, usable: true, sound: 'wool', support: 'below' }),
	[BLOCK.farmland]: b({ id: BLOCK.farmland, key: 'farmland', shape: 'farmland', transparent: true, translucent: false, solid: true, light: 0, opacity: 15, tiles: [37, 2, 2], color: '#6b4524', hardness: 0.6, tool: 'shovel', minTier: 0, drops: { id: BLOCK.dirt }, placeable: false, sound: 'gravel' }),
	[BLOCK.wheat0]: plant(BLOCK.wheat0, 'wheat0', 41, '#4f9a3a', { id: ITEM.wheatSeeds }, { support: 'farmland', growsTo: BLOCK.wheat1, sound: 'crop', hardness: 0 }),
	[BLOCK.wheat1]: plant(BLOCK.wheat1, 'wheat1', 42, '#6aa83c', { id: ITEM.wheatSeeds }, { support: 'farmland', growsTo: BLOCK.wheat2, sound: 'crop', placeable: false }),
	[BLOCK.wheat2]: plant(BLOCK.wheat2, 'wheat2', 43, '#9ab63a', { id: ITEM.wheatSeeds }, { support: 'farmland', growsTo: BLOCK.wheat3, sound: 'crop', placeable: false }),
	[BLOCK.wheat3]: plant(BLOCK.wheat3, 'wheat3', 44, '#d8b33a', { id: ITEM.wheat }, { support: 'farmland', sound: 'crop', placeable: false }),
	[BLOCK.sapling]: plant(BLOCK.sapling, 'sapling', 45, '#4c8f36', { id: BLOCK.sapling }, { growsTo: BLOCK.log }),
	[BLOCK.tallGrass]: plant(BLOCK.tallGrass, 'tallGrass', 46, '#5fa23c', { id: ITEM.wheatSeeds, chance: 0.125 }, { replaceable: true, silk: true }),
	[BLOCK.flower]: plant(BLOCK.flower, 'flower', 47, '#e04a3a', { id: BLOCK.flower }, { replaceable: true }),
	[BLOCK.bookshelf]: cube(BLOCK.bookshelf, 'bookshelf', [9, 48, 9], '#8a6a3c', 1.5, 'axe', 0, { id: ITEM.book, count: 3 }, 'wood', { silk: true, fuel: 1 }),
	[BLOCK.glowstone]: cube(BLOCK.glowstone, 'glowstone', [49, 49, 49], '#f2d27a', 0.3, 'none', 0, { id: BLOCK.glowstone }, 'glass', { light: 15 }),
	[BLOCK.obsidian]: cube(BLOCK.obsidian, 'obsidian', [50, 50, 50], '#1a1026', 50, 'pickaxe', 4, { id: BLOCK.obsidian }, 'stone'),
	[BLOCK.mossyCobblestone]: cube(BLOCK.mossyCobblestone, 'mossyCobblestone', [51, 51, 51], '#5f7a52', 2, 'pickaxe', 1, { id: BLOCK.mossyCobblestone }, 'stone'),
	[BLOCK.hayBale]: cube(BLOCK.hayBale, 'hayBale', [52, 53, 52], '#c9a63a', 0.5, 'hoe', 0, { id: BLOCK.hayBale }, 'grass'),
	[BLOCK.sandstone]: cube(BLOCK.sandstone, 'sandstone', [54, 55, 54], '#d9cf9a', 0.8, 'pickaxe', 1, { id: BLOCK.sandstone }, 'stone'),
	[BLOCK.clay]: cube(BLOCK.clay, 'clay', [56, 56, 56], '#9ea4b0', 0.6, 'shovel', 0, { id: ITEM.brick, count: 4 }, 'gravel', { silk: true }),
	[BLOCK.ice]: b({ id: BLOCK.ice, key: 'ice', shape: 'cube', transparent: true, translucent: true, solid: true, light: 0, opacity: 1, tiles: [57, 57, 57], color: '#a9d3f5', hardness: 0.5, tool: 'pickaxe', minTier: 0, drops: null, silk: true, placeable: true, slippery: true, sound: 'glass' }),
	[BLOCK.pumpkin]: cube(BLOCK.pumpkin, 'pumpkin', [58, 59, 58], '#d98a2a', 1, 'axe', 0, { id: BLOCK.pumpkin }, 'wood'),
	[BLOCK.melon]: cube(BLOCK.melon, 'melon', [60, 61, 60], '#8bbf3a', 1, 'axe', 0, { id: BLOCK.melon }, 'wood'),
	[BLOCK.birchLog]: cube(BLOCK.birchLog, 'birchLog', [62, 63, 62], '#d8d2b8', 2, 'axe', 0, { id: BLOCK.birchLog }, 'wood', { fuel: 1 }),
	[BLOCK.birchPlanks]: cube(BLOCK.birchPlanks, 'birchPlanks', [64, 64, 64], '#d9c99a', 2, 'axe', 0, { id: BLOCK.birchPlanks }, 'wood', { fuel: 1 }),
	...buildBuildingBlocks(),
};

export const ATLAS_TILE_COUNT = 144;
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

/**
 * 旧バージョンの保存データの id → 新 id。
 * 110..112 / 120..122 は最初の版の道具。100..109 と 130..168 は 2026-10-09 までの素材・染料 (+300 した)。
 * ブロック id が同じ番号を使うようになったため、保存データの 100..168 は素材として読み替える
 * (その番号のブロックを持ち物に入れていた短い期間のデータは素材に変わる)
 */
export const LEGACY_ITEM_IDS: Record<number, number> = {
	110: ITEM.woodenPickaxe, 111: ITEM.stonePickaxe, 112: ITEM.ironPickaxe,
	120: ITEM.woodenSword, 121: ITEM.stoneSword, 122: ITEM.ironSword,
	...Object.fromEntries([...Array.from({ length: 10 }, (_, i) => 100 + i), ...Array.from({ length: 39 }, (_, i) => 130 + i)].map(id => [id, id + 300])),
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
	[ITEM.redDye]: materialItem(ITEM.redDye, 'redDye', '#b03a2e'),
	[ITEM.yellowDye]: materialItem(ITEM.yellowDye, 'yellowDye', '#e6c43a'),
	[ITEM.blueDye]: materialItem(ITEM.blueDye, 'blueDye', '#35479b'),
	[ITEM.greenDye]: materialItem(ITEM.greenDye, 'greenDye', '#4f7a2a'),
	[ITEM.whiteDye]: materialItem(ITEM.whiteDye, 'whiteDye', '#f0f0f0'),
	[ITEM.blackDye]: materialItem(ITEM.blackDye, 'blackDye', '#202020'),
	[ITEM.grayDye]: materialItem(ITEM.grayDye, 'grayDye', '#6e6e6e'),
	[ITEM.orangeDye]: materialItem(ITEM.orangeDye, 'orangeDye', '#e0792a'),
	[ITEM.purpleDye]: materialItem(ITEM.purpleDye, 'purpleDye', '#7a3aa0'),
	[ITEM.pinkDye]: materialItem(ITEM.pinkDye, 'pinkDye', '#e8a0b8'),
	[ITEM.lightBlueDye]: materialItem(ITEM.lightBlueDye, 'lightBlueDye', '#74b6e0'),
	[ITEM.limeDye]: materialItem(ITEM.limeDye, 'limeDye', '#80c535'),
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
	category: 'basic' | 'tools' | 'weapons' | 'armor' | 'blocks' | 'food' | 'smelting' | 'building' | 'furniture' | 'dyes';
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

const ALL_PLANK_IDS = [BLOCK.planks, BLOCK.birchPlanks, BLOCK.sprucePlanks];
const ANY_SLAB_IDS = [BLOCK.oakSlab, BLOCK.birchSlab, BLOCK.spruceSlab];

function buildingRecipes(): Recipe[] {
	const out: Recipe[] = [];
	// 染料
	out.push(r('redDye', { id: ITEM.redDye, count: 2 }, [one(BLOCK.flower)], 'none', 'dyes'));
	out.push(r('yellowDye', { id: ITEM.yellowDye, count: 2 }, [one(BLOCK.dandelion)], 'none', 'dyes'));
	out.push(r('blueDye', { id: ITEM.blueDye, count: 1 }, [one(ITEM.lapis)], 'none', 'dyes'));
	out.push(r('greenDye', { id: ITEM.greenDye, count: 1 }, [one(BLOCK.cactus), any(FUEL_IDS)], 'furnace', 'smelting', 0.2));
	out.push(r('whiteDye', { id: ITEM.whiteDye, count: 3 }, [one(ITEM.bone)], 'none', 'dyes'));
	out.push(r('blackDye', { id: ITEM.blackDye, count: 1 }, [any([ITEM.coal, ITEM.charcoal])], 'none', 'dyes'));
	out.push(r('grayDye', { id: ITEM.grayDye, count: 2 }, [one(ITEM.blackDye), one(ITEM.whiteDye)], 'none', 'dyes'));
	out.push(r('orangeDye', { id: ITEM.orangeDye, count: 2 }, [one(ITEM.redDye), one(ITEM.yellowDye)], 'none', 'dyes'));
	out.push(r('purpleDye', { id: ITEM.purpleDye, count: 2 }, [one(ITEM.redDye), one(ITEM.blueDye)], 'none', 'dyes'));
	out.push(r('pinkDye', { id: ITEM.pinkDye, count: 2 }, [one(ITEM.redDye), one(ITEM.whiteDye)], 'none', 'dyes'));
	out.push(r('lightBlueDye', { id: ITEM.lightBlueDye, count: 2 }, [one(ITEM.blueDye), one(ITEM.whiteDye)], 'none', 'dyes'));
	out.push(r('limeDye', { id: ITEM.limeDye, count: 2 }, [one(ITEM.greenDye), one(ITEM.whiteDye)], 'none', 'dyes'));
	// 色付き羊毛・コンクリート
	const colors: [string, number, BlockId, BlockId | null][] = [
		['red', ITEM.redDye, BLOCK.redWool, BLOCK.redConcrete], ['yellow', ITEM.yellowDye, BLOCK.yellowWool, BLOCK.yellowConcrete], ['blue', ITEM.blueDye, BLOCK.blueWool, BLOCK.blueConcrete],
		['green', ITEM.greenDye, BLOCK.greenWool, BLOCK.greenConcrete], ['black', ITEM.blackDye, BLOCK.blackWool, BLOCK.blackConcrete], ['gray', ITEM.grayDye, BLOCK.grayWool, BLOCK.grayConcrete],
		['orange', ITEM.orangeDye, BLOCK.orangeWool, BLOCK.orangeConcrete], ['purple', ITEM.purpleDye, BLOCK.purpleWool, null], ['pink', ITEM.pinkDye, BLOCK.pinkWool, null],
		['lightBlue', ITEM.lightBlueDye, BLOCK.lightBlueWool, null], ['lime', ITEM.limeDye, BLOCK.limeWool, null],
	];
	for (const [name, dye, wool, concrete] of colors) {
		out.push(r(`${name}Wool`, { id: wool, count: 1 }, [one(BLOCK.wool), one(dye)], 'none', 'building'));
		if (concrete != null) out.push(r(`${name}Concrete`, { id: concrete, count: 8 }, [one(BLOCK.sand, 4), one(BLOCK.gravel, 4), one(dye)], 'table', 'building'));
	}
	out.push(r('whiteConcrete', { id: BLOCK.whiteConcrete, count: 8 }, [one(BLOCK.sand, 4), one(BLOCK.gravel, 4), one(ITEM.whiteDye)], 'table', 'building'));
	out.push(r('whiteCarpet', { id: BLOCK.whiteCarpet, count: 3 }, [one(BLOCK.wool, 2)], 'none', 'furniture'));
	out.push(r('redCarpet', { id: BLOCK.redCarpet, count: 3 }, [one(BLOCK.redWool, 2)], 'none', 'furniture'));
	out.push(r('blueCarpet', { id: BLOCK.blueCarpet, count: 3 }, [one(BLOCK.blueWool, 2)], 'none', 'furniture'));
	out.push(r('greenCarpet', { id: BLOCK.greenCarpet, count: 3 }, [one(BLOCK.greenWool, 2)], 'none', 'furniture'));
	// 石材
	out.push(r('smoothStone', { id: BLOCK.smoothStone, count: 1 }, [one(BLOCK.stone), any(FUEL_IDS)], 'furnace', 'smelting', 0.1));
	out.push(r('smoothSandstone', { id: BLOCK.smoothSandstone, count: 1 }, [one(BLOCK.sandstone), any(FUEL_IDS)], 'furnace', 'smelting', 0.1));
	out.push(r('terracotta', { id: BLOCK.terracotta, count: 1 }, [one(BLOCK.clay), any(FUEL_IDS)], 'furnace', 'smelting', 0.35));
	out.push(r('polishedAndesite', { id: BLOCK.polishedAndesite, count: 4 }, [one(BLOCK.andesite, 4)], 'table', 'building'));
	out.push(r('polishedGranite', { id: BLOCK.polishedGranite, count: 4 }, [one(BLOCK.granite, 4)], 'table', 'building'));
	out.push(r('polishedDiorite', { id: BLOCK.polishedDiorite, count: 4 }, [one(BLOCK.diorite, 4)], 'table', 'building'));
	out.push(r('deepslateBricks', { id: BLOCK.deepslateBricks, count: 4 }, [one(BLOCK.deepslate, 4)], 'table', 'building'));
	out.push(r('chiseledStoneBricks', { id: BLOCK.chiseledStoneBricks, count: 1 }, [one(BLOCK.stoneBrickSlab, 2)], 'table', 'building'));
	out.push(r('mossyStoneBricks', { id: BLOCK.mossyStoneBricks, count: 1 }, [one(BLOCK.stoneBricks), one(BLOCK.tallGrass)], 'none', 'building'));
	out.push(r('sprucePlanks', { id: BLOCK.sprucePlanks, count: 4 }, [one(BLOCK.spruceLog)], 'none', 'basic'));
	// 半ブロック・階段
	const slabs: [string, BlockId, number][] = [
		['oakSlab', BLOCK.oakSlab, BLOCK.planks], ['birchSlab', BLOCK.birchSlab, BLOCK.birchPlanks], ['spruceSlab', BLOCK.spruceSlab, BLOCK.sprucePlanks],
		['stoneSlab', BLOCK.stoneSlab, BLOCK.stone], ['cobblestoneSlab', BLOCK.cobblestoneSlab, BLOCK.cobblestone], ['stoneBrickSlab', BLOCK.stoneBrickSlab, BLOCK.stoneBricks],
		['sandstoneSlab', BLOCK.sandstoneSlab, BLOCK.sandstone], ['smoothStoneSlab', BLOCK.smoothStoneSlab, BLOCK.smoothStone],
	];
	for (const [key, id, from] of slabs) out.push(r(key, { id, count: 6 }, [one(from, 3)], 'table', 'building'));
	out.push(r('oakStairs', { id: BLOCK.oakStairs, count: 4 }, [one(BLOCK.planks, 6)], 'table', 'building'));
	out.push(r('birchStairs', { id: BLOCK.birchStairs, count: 4 }, [one(BLOCK.birchPlanks, 6)], 'table', 'building'));
	out.push(r('spruceStairs', { id: BLOCK.spruceStairs, count: 4 }, [one(BLOCK.sprucePlanks, 6)], 'table', 'building'));
	out.push(r('sandstoneStairs', { id: BLOCK.sandstoneStairs, count: 4 }, [one(BLOCK.sandstone, 6)], 'table', 'building'));
	out.push(r('smoothStoneStairs', { id: BLOCK.smoothStoneStairs, count: 4 }, [one(BLOCK.smoothStone, 6)], 'table', 'building'));
	out.push(r('deepslateBrickStairs', { id: BLOCK.deepslateBrickStairs, count: 4 }, [one(BLOCK.deepslateBricks, 6)], 'table', 'building'));
	out.push(r('brickStairs', { id: BLOCK.brickStairs, count: 4 }, [one(BLOCK.bricks, 6)], 'table', 'building'));
	out.push(r('deepslateBrickSlab', { id: BLOCK.deepslateBrickSlab, count: 6 }, [one(BLOCK.deepslateBricks, 3)], 'table', 'building'));
	out.push(r('polishedAndesiteSlab', { id: BLOCK.polishedAndesiteSlab, count: 6 }, [one(BLOCK.polishedAndesite, 3)], 'table', 'building'));
	out.push(r('polishedGraniteSlab', { id: BLOCK.polishedGraniteSlab, count: 6 }, [one(BLOCK.polishedGranite, 3)], 'table', 'building'));
	out.push(r('polishedDioriteSlab', { id: BLOCK.polishedDioriteSlab, count: 6 }, [one(BLOCK.polishedDiorite, 3)], 'table', 'building'));
	out.push(r('brickSlab', { id: BLOCK.brickSlab, count: 6 }, [one(BLOCK.bricks, 3)], 'table', 'building'));
	out.push(r('stonePillar', { id: BLOCK.stonePillar, count: 2 }, [one(BLOCK.smoothStoneSlab, 2)], 'table', 'building'));
	out.push(r('redStainedGlass', { id: BLOCK.redStainedGlass, count: 8 }, [one(BLOCK.glass, 8), one(ITEM.redDye)], 'table', 'building'));
	out.push(r('blueStainedGlass', { id: BLOCK.blueStainedGlass, count: 8 }, [one(BLOCK.glass, 8), one(ITEM.blueDye)], 'table', 'building'));
	out.push(r('greenStainedGlass', { id: BLOCK.greenStainedGlass, count: 8 }, [one(BLOCK.glass, 8), one(ITEM.greenDye)], 'table', 'building'));
	out.push(r('yellowStainedGlass', { id: BLOCK.yellowStainedGlass, count: 8 }, [one(BLOCK.glass, 8), one(ITEM.yellowDye)], 'table', 'building'));
	out.push(r('cobblestoneStairs', { id: BLOCK.cobblestoneStairs, count: 4 }, [one(BLOCK.cobblestone, 6)], 'table', 'building'));
	out.push(r('stoneBrickStairs', { id: BLOCK.stoneBrickStairs, count: 4 }, [one(BLOCK.stoneBricks, 6)], 'table', 'building'));
	// 柵・塀・ガラス・ドア
	out.push(r('oakFence', { id: BLOCK.oakFence, count: 3 }, [one(BLOCK.planks, 4), one(ITEM.stick, 2)], 'table', 'building'));
	out.push(r('birchFence', { id: BLOCK.birchFence, count: 3 }, [one(BLOCK.birchPlanks, 4), one(ITEM.stick, 2)], 'table', 'building'));
	out.push(r('spruceFence', { id: BLOCK.spruceFence, count: 3 }, [one(BLOCK.sprucePlanks, 4), one(ITEM.stick, 2)], 'table', 'building'));
	out.push(r('cobblestoneWall', { id: BLOCK.cobblestoneWall, count: 6 }, [one(BLOCK.cobblestone, 6)], 'table', 'building'));
	out.push(r('stoneBrickWall', { id: BLOCK.stoneBrickWall, count: 6 }, [one(BLOCK.stoneBricks, 6)], 'table', 'building'));
	out.push(r('deepslateBrickWall', { id: BLOCK.deepslateBrickWall, count: 6 }, [one(BLOCK.deepslateBricks, 6)], 'table', 'building'));
	out.push(r('glassPane', { id: BLOCK.glassPane, count: 16 }, [one(BLOCK.glass, 6)], 'table', 'building'));
	out.push(r('ironBars', { id: BLOCK.ironBars, count: 16 }, [one(ITEM.ironIngot, 6)], 'table', 'building'));
	out.push(r('oakDoor', { id: BLOCK.oakDoor, count: 3 }, [one(BLOCK.planks, 6)], 'table', 'building'));
	out.push(r('birchDoor', { id: BLOCK.birchDoor, count: 3 }, [one(BLOCK.birchPlanks, 6)], 'table', 'building'));
	out.push(r('spruceDoor', { id: BLOCK.spruceDoor, count: 3 }, [one(BLOCK.sprucePlanks, 6)], 'table', 'building'));
	// 家具
	out.push(r('oakTable', { id: BLOCK.oakTable, count: 1 }, [one(BLOCK.oakSlab), one(ITEM.stick, 4)], 'table', 'furniture'));
	out.push(r('birchTable', { id: BLOCK.birchTable, count: 1 }, [one(BLOCK.birchSlab), one(ITEM.stick, 4)], 'table', 'furniture'));
	out.push(r('spruceTable', { id: BLOCK.spruceTable, count: 1 }, [one(BLOCK.spruceSlab), one(ITEM.stick, 4)], 'table', 'furniture'));
	out.push(r('oakStool', { id: BLOCK.oakStool, count: 1 }, [one(BLOCK.oakSlab), one(ITEM.stick, 3)], 'table', 'furniture'));
	out.push(r('birchStool', { id: BLOCK.birchStool, count: 1 }, [one(BLOCK.birchSlab), one(ITEM.stick, 3)], 'table', 'furniture'));
	out.push(r('spruceStool', { id: BLOCK.spruceStool, count: 1 }, [one(BLOCK.spruceSlab), one(ITEM.stick, 3)], 'table', 'furniture'));
	out.push(r('oakChair', { id: BLOCK.oakChair, count: 2 }, [one(BLOCK.planks, 3), one(ITEM.stick, 4)], 'table', 'furniture'));
	out.push(r('birchChair', { id: BLOCK.birchChair, count: 2 }, [one(BLOCK.birchPlanks, 3), one(ITEM.stick, 4)], 'table', 'furniture'));
	out.push(r('spruceChair', { id: BLOCK.spruceChair, count: 2 }, [one(BLOCK.sprucePlanks, 3), one(ITEM.stick, 4)], 'table', 'furniture'));
	out.push(r('chest', { id: BLOCK.chest, count: 1 }, [any(ALL_PLANK_IDS, 8)], 'table', 'furniture'));
	out.push(r('barrel', { id: BLOCK.barrel, count: 1 }, [any(ALL_PLANK_IDS, 6), any(ANY_SLAB_IDS, 2)], 'table', 'furniture'));
	out.push(r('lantern', { id: BLOCK.lantern, count: 1 }, [one(ITEM.ironIngot), one(BLOCK.torch)], 'table', 'furniture'));
	out.push(r('flowerPot', { id: BLOCK.flowerPot, count: 1 }, [one(ITEM.brick, 3), one(BLOCK.flower)], 'table', 'furniture'));
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
	...buildingRecipes(),
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
