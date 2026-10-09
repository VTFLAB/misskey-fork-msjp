/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ENCHANT_DEFS, GACHA_TIERS, ITEM, armorItemId, enchantTargetsOf, toolItemId } from './constants.js';
import type { EnchantDef, EnchantId, GachaTier } from './constants.js';
import type { ItemStack } from './types.js';

/** stack に今から付けられるエンチャント (対象が合い、持っているものと競合しない) */
export function applicableEnchants(stack: ItemStack): EnchantDef[] {
	if (stack == null) return [];
	const targets = enchantTargetsOf(stack.id);
	if (targets.length === 0) return [];
	const have = new Set<EnchantId>((stack.ench ?? []).map(e => e[0]));
	const out: EnchantDef[] = [];
	for (const def of Object.values(ENCHANT_DEFS)) {
		if (have.has(def.id)) continue;
		if (!def.targets.some(t => targets.includes(t))) continue;
		if (def.conflicts.some(c => have.has(c))) continue;
		out.push(def);
	}
	return out;
}

/** 重み付きで 1 つ選ぶ */
function pickWeighted<T>(list: T[], weight: (item: T) => number, random: () => number): T {
	let total = 0;
	for (const item of list) total += weight(item);
	let r = random() * total;
	for (const item of list) {
		r -= weight(item);
		if (r < 0) return item;
	}
	return list[list.length - 1];
}

/**
 * stack にティアに応じたエンチャントを付ける (stack を書き換える)。
 * 宝 (Mending) はティア 3 だけ。付けられる物が無ければ null
 */
export function enchantStack(stack: NonNullable<ItemStack>, tier: GachaTier, random: () => number = Math.random): [EnchantId, number][] | null {
	const cfg = GACHA_TIERS[tier];
	const [lo, hi] = cfg.enchantRolls;
	const rolls = lo + Math.floor(random() * (hi - lo + 1));
	const added: [EnchantId, number][] = [];
	for (let i = 0; i < rolls; i++) {
		const pool = applicableEnchants(stack).filter(d => tier >= 3 || d.treasure !== true);
		if (pool.length === 0) break;
		const def = pickWeighted(pool, d => d.weight, random);
		const level = Math.max(1, Math.min(def.maxLevel, Math.round(def.maxLevel * (cfg.levelBias * 0.6 + random() * 0.6))));
		const entry: [EnchantId, number] = [def.id, level];
		stack.ench = [...(stack.ench ?? []), entry];
		added.push(entry);
	}
	return added.length > 0 ? added : null;
}

type Weighted = [number, number];

/** [道具素材 index (0 木 1 石 2 鉄 3 金 4 ダイヤ), 防具素材 index (0 革 1 鉄 2 金 3 ダイヤ), 重み] */
const MATERIAL_POOL: Record<GachaTier, { tool: Weighted[]; armor: Weighted[]; bow: number }> = {
	1: { tool: [[0, 1], [1, 1], [2, 1]], armor: [[0, 1], [1, 1]], bow: 0.1 },
	2: { tool: [[2, 1], [3, 1], [4, 1]], armor: [[1, 1], [2, 1], [3, 1]], bow: 0.1 },
	3: { tool: [[4, 70], [3, 15], [2, 15]], armor: [[3, 70], [2, 15], [1, 15]], bow: 0.1 },
};

function rollEquipment(tier: GachaTier, random: () => number): NonNullable<ItemStack> {
	const pool = MATERIAL_POOL[tier];
	if (random() < pool.bow) return { id: ITEM.bow, count: 1 };
	if (random() < 0.55) {
		const [m] = pickWeighted(pool.tool, e => e[1], random);
		return { id: toolItemId(m, Math.floor(random() * 5)), count: 1 };
	}
	const [m] = pickWeighted(pool.armor, e => e[1], random);
	return { id: armorItemId(m, Math.floor(random() * 4)), count: 1 };
}

/** ガチャ: ティアに応じた装備をランダムに作り、必ず 1 つ以上エンチャントを付けて返す */
export function rollGacha(tier: GachaTier, random: () => number = Math.random): NonNullable<ItemStack> {
	let stack = rollEquipment(tier, random);
	for (let attempt = 0; attempt < 5; attempt++) {
		if (enchantStack(stack, tier, random) != null) return stack;
		stack = rollEquipment(tier, random);
	}
	// 通常は到達しない (全装備に耐久エンチャントが付く)
	stack.ench = [['unbreaking', 1]];
	return stack;
}
