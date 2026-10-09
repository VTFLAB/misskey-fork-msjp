/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BLOCK_DEFS } from './constants.js';
import type { BlockDef } from './constants.js';

/** ブロック内の箱 [x0, y0, z0, x1, y1, z1]。ブロック単位 (0..1)。当たり判定では y が 1 を超えることがある */
export type Box = [number, number, number, number, number, number];
/** 相対位置の隣のブロック id */
export type NeighborFn = (dx: number, dy: number, dz: number) => number;

const S = 1 / 16;

/** 1/16 単位の箱をブロック単位にする */
function scaled(b: readonly number[]): Box {
	return [b[0] * S, b[1] * S, b[2] * S, b[3] * S, b[4] * S, b[5] * S];
}

/** 不透明な立方体か (柵・塀・板が繋がる相手) */
function isOpaqueCube(def: BlockDef | undefined): boolean {
	return def != null && def.shape === 'cube' && def.solid && !def.transparent;
}

/** 向き: +x, -x, +z, -z */
const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** +x 向きの腕 (1/16 単位) を 4 方向に回す */
function armFor(dir: number, a: readonly number[]): Box {
	switch (dir) {
		case 0: return scaled([a[0], a[1], a[2], a[3], a[4], a[5]]);
		case 1: return scaled([16 - a[3], a[1], a[2], 16 - a[0], a[4], a[5]]);
		case 2: return scaled([a[2], a[1], a[0], a[5], a[4], a[3]]);
		default: return scaled([a[2], a[1], 16 - a[3], a[5], a[4], 16 - a[0]]);
	}
}

const FENCE_ARMS = [[10, 6, 7, 16, 9, 9], [10, 12, 7, 16, 15, 9]];
const WALL_ARMS = [[12, 0, 5, 16, 14, 11]];
const PANE_ARMS = [[9, 0, 7, 16, 16, 9]];

function connectedBoxes(def: BlockDef, nb: NeighborFn, forCollision: boolean): Box[] {
	const out: Box[] = (def.boxes ?? []).map(scaled);
	const connect = def.connect;
	if (connect == null) return out;
	const link: boolean[] = [];
	for (let d = 0; d < 4; d++) {
		const n = BLOCK_DEFS[nb(DIRS[d][0], 0, DIRS[d][1])];
		let ok = false;
		if (n != null) {
			if (connect === 'pane') ok = n.connect === 'pane' || isOpaqueCube(n);
			else ok = n.connect === 'fence' || n.connect === 'wall' || isOpaqueCube(n);
		}
		link.push(ok);
	}
	const arms = connect === 'fence' ? FENCE_ARMS : connect === 'wall' ? WALL_ARMS : PANE_ARMS;
	const count = link.filter(Boolean).length;
	// ちょうど反対側の 2 方向だけ繋がる板は柱を省く
	if (connect === 'pane' && count === 2 && ((link[0] && link[1]) || (link[2] && link[3]))) out.length = 0;
	for (let d = 0; d < 4; d++) {
		if (!link[d]) continue;
		for (const a of arms) out.push(armFor(d, a));
	}
	if (forCollision && def.collisionHeight != null) {
		const hh = def.collisionHeight;
		for (const b of out) b[4] = hh;
	}
	return out;
}

/** 描画用の箱。boxes 以外の形は [] (bed と farmland だけ物理で共有するため箱を返す) */
export function renderBoxes(id: number, nb: NeighborFn): Box[] {
	const def = BLOCK_DEFS[id];
	if (def == null) return [];
	if (def.shape === 'boxes') return connectedBoxes(def, nb, false);
	if (def.shape === 'bed') return [[0, 0, 0, 1, 9 / 16, 1]];
	if (def.shape === 'farmland') return [[0, 0, 0, 1, 15 / 16, 1]];
	return [];
}

/** 当たり判定の箱。固体でなければ []、立方体は 1 マス全体 */
export function collisionBoxes(id: number, nb: NeighborFn): Box[] {
	const def = BLOCK_DEFS[id];
	if (def == null || !def.solid) return [];
	if (def.shape === 'cube') return [[0, 0, 0, 1, 1, 1]];
	if (def.shape === 'boxes') return connectedBoxes(def, nb, true);
	return renderBoxes(id, nb);
}
