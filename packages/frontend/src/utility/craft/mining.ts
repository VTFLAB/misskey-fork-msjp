/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BLOCK, BLOCK_DEFS, ITEM, ITEM_DEFS } from './constants.js';
import type { ItemDef } from './constants.js';
import type { ItemStack } from './types.js';

export function heldTool(stack: ItemStack): ItemDef['tool'] | undefined {
	if (stack == null) return undefined;
	return ITEM_DEFS[stack.id]?.tool;
}

/** 剣はブロックの採掘にもドロップ条件にも数えない */
function blockTool(stack: ItemStack): ItemDef['tool'] | undefined {
	const tool = heldTool(stack);
	return tool != null && tool.kind !== 'sword' ? tool : undefined;
}

export function canHarvest(blockId: number, stack: ItemStack): boolean {
	const def = BLOCK_DEFS[blockId];
	if (def == null) return false;
	if (def.minTier <= 0) return true;
	const tool = blockTool(stack);
	return tool != null && tool.kind === def.tool && tool.tier >= def.minTier;
}

/** 壊すのにかかる秒数 */
export function breakTime(blockId: number, stack: ItemStack): number {
	const def = BLOCK_DEFS[blockId];
	if (def == null || !Number.isFinite(def.hardness)) return Infinity;
	const tool = blockTool(stack);
	let t: number;
	if (tool != null && def.tool !== 'none' && tool.kind === def.tool) {
		t = def.hardness / tool.speed;
		if (!canHarvest(blockId, stack)) t = def.hardness * 3;
	} else if (def.minTier > 0) {
		t = def.hardness * 3;
	} else {
		t = def.hardness;
	}
	return Math.max(0.05, t);
}

export function dropsFor(blockId: number, stack: ItemStack): ItemStack {
	const def = BLOCK_DEFS[blockId];
	if (def == null || !canHarvest(blockId, stack)) return null;
	if (blockId === BLOCK.leaves) {
		return Math.random() < 0.05 ? { id: ITEM.apple, count: 1 } : null;
	}
	return def.drops != null ? { id: def.drops, count: 1 } : null;
}

export function attackDamage(stack: ItemStack): number {
	return heldTool(stack)?.attack ?? 1;
}
