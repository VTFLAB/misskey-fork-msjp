/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * ワールドの定期更新 (作物の成長、苗木、草の広がり、葉の枯れ) と、ブロック設置・撤去時の連鎖規則。
 * CraftWorld 上の純粋なロジックで、通信は持たない。編集は返すだけで、適用と送信は engine が行う。
 *
 * 調整値 (tick を約 500 ms ごとに呼ぶ前提、dt = 0.5 で基準):
 * - 1 chunk あたり 24 列を無作為に選び、各列の地表から上 8 段のうち 1 段を調べる (1 回の確率は 24/256/8 ≈ 1.2%)
 * - 小麦: 1 段階が 1/3 で進む。0 → 3 まで平均 約 6.4 分 (1 段階あたり約 2.1 分)
 * - 苗木: 調べられるたび 1/6 で成長。平均 約 4.3 分
 * - 草の広がり 1/20 (隣の土 1 つあたり平均 約 14 分)、耕地の戻り 1/40 (平均 約 28 分)、葉の枯れ 1/8 (平均 約 5 分)
 */

import { BIOME, BLOCK, BLOCK_DEFS, ITEM, WORLD, isSolid } from './constants.js';
import { treeBlocks } from './terrain.js';
import type { CraftWorld } from './world.js';

export type BlockEdit = { x: number; y: number; z: number; id: number };

const PICKS_PER_CHUNK = 24;
const TOP_LEVELS = 8;
const CHUNK_RADIUS = 2;
const MAX_CHUNKS = 100;
const MAX_QUEUE_BLOCKS = 600;
const FALL_CAP = 16;
const REFERENCE_DT = 0.5;
const LEAF_RANGE = 4;

function passable(id: number): boolean {
	return id === BLOCK.air || id === BLOCK.water || BLOCK_DEFS[id]?.replaceable === true;
}

/** ドアの上下 (同じ軸) の相方。ドアでなければ null */
export function doorCounterpart(id: number): number | null {
	switch (id) {
		case BLOCK.oakDoor: return BLOCK.oakDoorUpper;
		case BLOCK.oakDoorUpper: return BLOCK.oakDoor;
		case BLOCK.oakDoorZ: return BLOCK.oakDoorZUpper;
		case BLOCK.oakDoorZUpper: return BLOCK.oakDoorZ;
		default: return null;
	}
}

/** ドアを開閉したあとの id (同じ半分で軸だけ入れ替わる)。ドアでなければ null */
export function doorToggled(id: number): number | null {
	switch (id) {
		case BLOCK.oakDoor: return BLOCK.oakDoorZ;
		case BLOCK.oakDoorZ: return BLOCK.oakDoor;
		case BLOCK.oakDoorUpper: return BLOCK.oakDoorZUpper;
		case BLOCK.oakDoorZUpper: return BLOCK.oakDoorUpper;
		default: return null;
	}
}

function isLog(id: number): boolean {
	return id === BLOCK.log || id === BLOCK.birchLog;
}

function key(x: number, y: number, z: number): string {
	return `${x},${y},${z}`;
}

type TreeGroup = { saplingKey: string; sx: number; sy: number; sz: number; blocks: BlockEdit[]; i: number };

export class WorldTicker {
	private groups: TreeGroup[] = [];
	private growing = new Set<string>();
	private queuedBlocks = 0;

	constructor(private world: CraftWorld) {
	}

	/** ホストだけが呼ぶ。プレイヤー周辺の無作為更新を行い、適用して送るべき編集を返す (最大 maxEdits 件) */
	public tick(dt: number, now: number, players: { x: number; y: number; z: number }[], maxEdits = 6): BlockEdit[] {
		void now;
		const out: BlockEdit[] = [];
		const seen = new Set<string>();
		this.drainTrees(out, seen, maxEdits);
		if (out.length >= maxEdits || dt <= 0 || players.length === 0) return out;

		const picks = Math.max(1, Math.round(PICKS_PER_CHUNK * Math.min(dt / REFERENCE_DT, 4)));
		const chunks = this.nearbyChunks(players);
		for (const [cx, cz] of chunks) {
			for (let n = 0; n < picks; n++) {
				if (out.length >= maxEdits) return out;
				const x = cx * WORLD.chunkSize + Math.floor(Math.random() * WORLD.chunkSize);
				const z = cz * WORLD.chunkSize + Math.floor(Math.random() * WORLD.chunkSize);
				const y = this.world.surfaceY(x, z) - 1 - Math.floor(Math.random() * TOP_LEVELS);
				if (y < WORLD.minY) continue;
				this.randomTick(x, y, z, out, seen);
			}
		}
		return out;
	}

	private nearbyChunks(players: { x: number; y: number; z: number }[]): [number, number][] {
		const set = new Map<string, [number, number]>();
		for (const p of players) {
			const pcx = Math.floor(p.x / WORLD.chunkSize);
			const pcz = Math.floor(p.z / WORLD.chunkSize);
			for (let dz = -CHUNK_RADIUS; dz <= CHUNK_RADIUS; dz++) {
				for (let dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx++) {
					const cx = pcx + dx;
					const cz = pcz + dz;
					if (!this.world.hasChunk(cx, cz)) continue;
					set.set(`${cx},${cz}`, [cx, cz]);
				}
			}
		}
		const list = [...set.values()];
		for (let i = list.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[list[i], list[j]] = [list[j], list[i]];
		}
		return list.length > MAX_CHUNKS ? list.slice(0, MAX_CHUNKS) : list;
	}

	private push(out: BlockEdit[], seen: Set<string>, x: number, y: number, z: number, id: number): void {
		const k = key(x, y, z);
		if (seen.has(k)) return;
		seen.add(k);
		out.push({ x, y, z, id });
	}

	private randomTick(x: number, y: number, z: number, out: BlockEdit[], seen: Set<string>): void {
		const w = this.world;
		const id = w.peekBlock(x, y, z);
		if (id == null || id === BLOCK.air) return;

		if (id === BLOCK.wheat0 || id === BLOCK.wheat1 || id === BLOCK.wheat2) {
			if (Math.random() < 1 / 3) this.push(out, seen, x, y, z, id + 1);
		} else if (id === BLOCK.sapling) {
			if (Math.random() < 1 / 6) this.queueTree(x, y, z);
		} else if (id === BLOCK.grass) {
			if (Math.random() >= 1 / 20) return;
			const d = Math.floor(Math.random() * 4);
			const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0);
			const nz = z + (d === 2 ? 1 : d === 3 ? -1 : 0);
			if (w.peekBlock(nx, y, nz) !== BLOCK.dirt) return;
			const above = w.peekBlock(nx, y + 1, nz);
			if (above == null || !passable(above) || above === BLOCK.water) return;
			this.push(out, seen, nx, y, nz, BLOCK.grass);
		} else if (id === BLOCK.farmland) {
			if (Math.random() >= 1 / 40) return;
			if (w.peekBlock(x, y + 1, z) === BLOCK.air) this.push(out, seen, x, y, z, BLOCK.dirt);
		} else if (id === BLOCK.leaves) {
			if (Math.random() >= 1 / 8) return;
			if (!this.leafSupported(x, y, z)) this.push(out, seen, x, y, z, BLOCK.air);
		}
	}

	/** 葉をたどって LEAF_RANGE 以内に原木があるか。未生成 chunk に入ったら安全側 (あるとみなす) */
	private leafSupported(x: number, y: number, z: number): boolean {
		const w = this.world;
		const visited = new Set<string>([key(x, y, z)]);
		let frontier: [number, number, number][] = [[x, y, z]];
		for (let depth = 0; depth < LEAF_RANGE; depth++) {
			const next: [number, number, number][] = [];
			for (const [px, py, pz] of frontier) {
				for (let d = 0; d < 6; d++) {
					const qx = px + (d === 0 ? 1 : d === 1 ? -1 : 0);
					const qy = py + (d === 2 ? 1 : d === 3 ? -1 : 0);
					const qz = pz + (d === 4 ? 1 : d === 5 ? -1 : 0);
					const k = key(qx, qy, qz);
					if (visited.has(k)) continue;
					visited.add(k);
					const id = w.peekBlock(qx, qy, qz);
					if (id == null || isLog(id)) return true;
					if (id === BLOCK.leaves) next.push([qx, qy, qz]);
				}
			}
			if (next.length === 0) break;
			frontier = next;
		}
		return false;
	}

	private queueTree(x: number, y: number, z: number): void {
		const w = this.world;
		const sk = key(x, y, z);
		if (this.growing.has(sk) || this.queuedBlocks > MAX_QUEUE_BLOCKS) return;
		const below = w.peekBlock(x, y - 1, z);
		if (below !== BLOCK.grass && below !== BLOCK.dirt) return;
		for (let dy = 1; dy <= 5; dy++) {
			if (w.peekBlock(x, y + dy, z) !== BLOCK.air) return;
		}
		const biome = w.biomeAt(x, z);
		const kind = biome === BIOME.birchForest ? 'birch' : biome === BIOME.taiga ? 'spruce' : 'oak';
		const blocks = treeBlocks(kind, x, y, z, 4 + Math.floor(Math.random() * 3));
		if (blocks.length === 0) return;
		this.growing.add(sk);
		this.queuedBlocks += blocks.length;
		this.groups.push({ saplingKey: sk, sx: x, sy: y, sz: z, blocks, i: 0 });
	}

	private drainTrees(out: BlockEdit[], seen: Set<string>, maxEdits: number): void {
		const w = this.world;
		while (out.length < maxEdits && this.groups.length > 0) {
			const g = this.groups[0];
			if (g.i === 0 && w.peekBlock(g.sx, g.sy, g.sz) !== BLOCK.sapling) {
				// 苗木が壊された
				this.finishGroup(g);
				continue;
			}
			if (g.i >= g.blocks.length) {
				this.finishGroup(g);
				continue;
			}
			const b = g.blocks[g.i++];
			this.queuedBlocks--;
			const cur = w.peekBlock(b.x, b.y, b.z);
			if (cur == null || cur === b.id) continue;
			if (cur !== BLOCK.air && cur !== BLOCK.leaves && cur !== BLOCK.sapling && BLOCK_DEFS[cur]?.replaceable !== true) continue;
			if (cur === BLOCK.leaves && b.id === BLOCK.leaves) continue;
			this.push(out, seen, b.x, b.y, b.z, b.id);
		}
	}

	private finishGroup(g: TreeGroup): void {
		this.queuedBlocks -= g.blocks.length - g.i;
		this.growing.delete(g.saplingKey);
		this.groups.shift();
	}
}

/**
 * (x, y, z) のブロックが空気になった直後に呼ぶ。上に積まれた砂・砂利の落下と、支えを失った付着物の除去を返す。
 * 返す編集は適用順 (付着物の除去、落下の順)。
 */
export function cascadeAfterRemoval(world: CraftWorld, x: number, y: number, z: number): BlockEdit[] {
	const out: BlockEdit[] = [];
	if (isSolid(world.getBlock(x, y, z))) return out;
	const overlay = new Map<string, number>();
	const get = (px: number, py: number, pz: number): number => overlay.get(key(px, py, pz)) ?? world.getBlock(px, py, pz);
	const put = (px: number, py: number, pz: number, id: number): void => {
		overlay.set(key(px, py, pz), id);
		out.push({ x: px, y: py, z: pz, id });
	};

	// ドアの片方が消えたらもう片方も消える
	const below = get(x, y - 1, z);
	if (BLOCK_DEFS[below]?.door?.half === 'lower') put(x, y - 1, z, BLOCK.air);

	// 横の梯子: 壁にできる固体が 1 つも残らなければ消える
	for (let d = 0; d < 4; d++) {
		const lx = x + (d === 0 ? 1 : d === 1 ? -1 : 0);
		const lz = z + (d === 2 ? 1 : d === 3 ? -1 : 0);
		if (get(lx, y, lz) !== BLOCK.ladder) continue;
		let hasWall = false;
		for (let e = 0; e < 4; e++) {
			const wx = lx + (e === 0 ? 1 : e === 1 ? -1 : 0);
			const wz = lz + (e === 2 ? 1 : e === 3 ? -1 : 0);
			if (isSolid(get(wx, y, wz))) {
				hasWall = true;
				break;
			}
		}
		if (!hasWall) put(lx, y, lz, BLOCK.air);
	}

	const sweep = (from: number): number => {
		let yy = from;
		while (yy <= WORLD.maxY && out.length < FALL_CAP * 2) {
			const sdef = BLOCK_DEFS[get(x, yy, z)];
			const support = sdef?.support;
			// ドアの上半分は下半分が消えたら一緒に消える
			if (support !== 'below' && support !== 'farmland' && sdef?.door?.half !== 'lower' && sdef?.door?.half !== 'upper') break;
			put(x, yy, z, BLOCK.air);
			yy++;
		}
		return yy;
	};

	let yy = sweep(y + 1);
	let fallen = 0;
	while (fallen < FALL_CAP && yy <= WORLD.maxY) {
		const id = get(x, yy, z);
		if (id !== BLOCK.sand && id !== BLOCK.gravel) break;
		let dest = yy;
		while (dest - 1 >= WORLD.minY && passable(get(x, dest - 1, z))) dest--;
		if (dest === yy) break;
		put(x, yy, z, BLOCK.air);
		put(x, dest, z, id);
		yy++;
		fallen++;
	}
	if (fallen > 0) sweep(yy);
	return out;
}

/** 砂・砂利を (x, y, z) に置いたとき落ちる先の y。落ちないなら null */
export function gravityDestination(world: CraftWorld, x: number, y: number, z: number): number | null {
	let dest = y;
	while (dest - 1 >= WORLD.minY && passable(world.getBlock(x, dest - 1, z))) dest--;
	return dest < y ? dest : null;
}

/** id を (x, y, z) に置けるか。(nx, ny, nz) はクリックした面の法線 */
export function canPlaceAt(world: CraftWorld, id: number, x: number, y: number, z: number, nx: number, ny: number, nz: number): boolean {
	const target = world.getBlock(x, y, z);
	if (!passable(target)) return false;
	const def = BLOCK_DEFS[id];
	if (def == null) return false;
	const baseDef = def.facingSet != null ? BLOCK_DEFS[def.facingSet[0]] ?? def : def;
	const isDoor = def.door != null;
	const support = baseDef.support ?? (def.door?.half === 'lower' ? 'below' : undefined);
	if (isDoor && def.door?.half === 'lower') {
		const above = world.getBlock(x, y + 1, z);
		if (above !== BLOCK.air && BLOCK_DEFS[above]?.replaceable !== true) return false;
	}
	if (support == null) return true;
	if (target === BLOCK.water && support !== 'wall') return false;

	if (support === 'wall') {
		if (ny !== 0 || (nx === 0 && nz === 0)) return false;
		return isSolid(world.getBlock(x - nx, y, z - nz));
	}

	const below = world.getBlock(x, y - 1, z);
	if (support === 'farmland') return below === BLOCK.farmland;
	if (!isSolid(below)) return false;
	if (id === BLOCK.cactus) return below === BLOCK.sand || below === BLOCK.cactus;
	if (def.shape === 'cross') return below === BLOCK.grass || below === BLOCK.dirt || below === BLOCK.farmland;
	return true;
}

/** くわで耕した結果。耕せないなら null */
export function tillResult(blockId: number): number | null {
	return blockId === BLOCK.grass || blockId === BLOCK.dirt ? BLOCK.farmland : null;
}

/** 植えられるアイテムか (種、苗木) */
export function isPlantable(id: number): boolean {
	return id === ITEM.wheatSeeds || id === BLOCK.sapling;
}

/** アイテムを belowBlockId の上に植えたときに置かれるブロック。植えられないなら null */
export function plantResult(itemId: number, belowBlockId: number): number | null {
	if (itemId === ITEM.wheatSeeds) return belowBlockId === BLOCK.farmland ? BLOCK.wheat0 : null;
	if (itemId === BLOCK.sapling) return belowBlockId === BLOCK.grass || belowBlockId === BLOCK.dirt ? BLOCK.sapling : null;
	return null;
}
