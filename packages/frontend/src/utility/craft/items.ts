/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ENCHANT_DEFS, ITEM_DEFS, LEGACY_ITEM_IDS } from './constants.js';
import type { EnchantId, ItemDef } from './constants.js';
import type { ItemStack, SerializedStack } from './types.js';

/**
 * ItemStack の共通ヘルパー。耐久値・エンチャント・保存形式をここに集める。
 */

export function itemDef(stack: ItemStack): ItemDef | undefined {
	return stack == null ? undefined : ITEM_DEFS[stack.id];
}

/** 1 枠に重ねられる最大数。エンチャント付きや耐久値を消費した物は重ならない */
export function maxStackOf(stack: NonNullable<ItemStack>): number {
	if ((stack.ench != null && stack.ench.length > 0) || (stack.dmg ?? 0) > 0) return 1;
	return ITEM_DEFS[stack.id]?.maxStack ?? 1;
}

/** 同じ枠にまとめてよいか (id が同じで、どちらも無印) */
export function canMerge(a: NonNullable<ItemStack>, b: NonNullable<ItemStack>): boolean {
	return a.id === b.id && maxStackOf(a) > 1 && maxStackOf(b) > 1;
}

export function enchantLevel(stack: ItemStack, id: EnchantId): number {
	if (stack?.ench == null) return 0;
	for (const [e, lvl] of stack.ench) if (e === id) return lvl;
	return 0;
}

export function hasEnchants(stack: ItemStack): boolean {
	return stack?.ench != null && stack.ench.length > 0;
}

/** 耐久値の残り (0..1)。耐久の無い物は 1 */
export function durabilityRatio(stack: ItemStack): number {
	const def = itemDef(stack);
	if (stack == null || def?.durability == null) return 1;
	return Math.max(0, 1 - (stack.dmg ?? 0) / def.durability);
}

export function remainingDurability(stack: ItemStack): number | null {
	const def = itemDef(stack);
	if (stack == null || def?.durability == null) return null;
	return Math.max(0, def.durability - (stack.dmg ?? 0));
}

/**
 * 耐久値を消費する。耐久 (Unbreaking) で消費を免れることがある。
 * @returns 壊れたら true (呼び出し側が枠を空にする)
 */
export function damageItem(stack: ItemStack, amount = 1, random: () => number = Math.random): boolean {
	const def = itemDef(stack);
	if (stack == null || def?.durability == null) return false;
	const unbreaking = enchantLevel(stack, 'unbreaking');
	let used = 0;
	for (let i = 0; i < amount; i++) {
		// 防具は Unbreaking でも 60% + 40%/(lvl+1) の確率で消費する。道具は 1/(lvl+1)
		const keep = unbreaking > 0 && (def.armor != null
			? random() >= 0.6 + 0.4 / (unbreaking + 1)
			: random() >= 1 / (unbreaking + 1));
		if (!keep) used++;
	}
	if (used === 0) return false;
	stack.dmg = (stack.dmg ?? 0) + used;
	return stack.dmg >= def.durability;
}

/** 修繕 (Mending) で耐久を戻す。戻した量を返す */
export function repairItem(stack: ItemStack, amount: number): number {
	if (stack == null || (stack.dmg ?? 0) <= 0) return 0;
	const n = Math.min(stack.dmg ?? 0, amount);
	stack.dmg = (stack.dmg ?? 0) - n;
	if (stack.dmg === 0) delete stack.dmg;
	return n;
}

/** 表示用: エンチャント一覧の文字列 (ローマ数字) */
export function enchantLabel(id: EnchantId, level: number, names: Record<string, string>): string {
	const roman = ['', 'I', 'II', 'III', 'IV', 'V'][level] ?? String(level);
	const name = names[id] ?? id;
	return ENCHANT_DEFS[id].maxLevel === 1 ? name : `${name} ${roman}`;
}

/** 合計レベルからレアリティを決める (ガチャ演出・枠の色) */
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export function rarityOf(stack: ItemStack): Rarity {
	if (stack?.ench == null || stack.ench.length === 0) return 'common';
	let total = 0;
	let treasure = false;
	for (const [id, lvl] of stack.ench) {
		total += lvl;
		if (ENCHANT_DEFS[id].treasure) treasure = true;
	}
	if (treasure || total >= 9) return 'legendary';
	if (total >= 5) return 'epic';
	return 'rare';
}

export function serializeStack(stack: ItemStack): SerializedStack {
	if (stack == null) return null;
	if ((stack.dmg ?? 0) > 0 || (stack.ench != null && stack.ench.length > 0)) {
		return [stack.id, stack.count, stack.dmg ?? 0, (stack.ench ?? []).map(([id, lvl]) => [id, lvl] as [string, number])];
	}
	return [stack.id, stack.count];
}

/** 保存データ 1 枠を読む。壊れたデータや知らない id は null */
export function deserializeStack(entry: unknown): ItemStack {
	if (!Array.isArray(entry) || entry.length < 2) return null;
	let id: unknown = entry[0];
	const count: unknown = entry[1];
	if (typeof id !== 'number' || typeof count !== 'number') return null;
	if (LEGACY_ITEM_IDS[id] != null) id = LEGACY_ITEM_IDS[id];
	const def = ITEM_DEFS[id as number];
	if (def == null || !Number.isInteger(count) || count < 1) return null;
	const stack: NonNullable<ItemStack> = { id: id as number, count: Math.min(count, def.maxStack) };
	const dmg: unknown = entry[2];
	if (typeof dmg === 'number' && Number.isInteger(dmg) && dmg > 0 && def.durability != null) {
		stack.dmg = Math.min(dmg, def.durability - 1);
	}
	const ench: unknown = entry[3];
	if (Array.isArray(ench)) {
		const list: [EnchantId, number][] = [];
		for (const e of ench) {
			if (!Array.isArray(e) || typeof e[0] !== 'string' || typeof e[1] !== 'number' || !Number.isFinite(e[1])) continue;
			if (!Object.hasOwn(ENCHANT_DEFS, e[0])) continue;
			const edef = ENCHANT_DEFS[e[0] as EnchantId];
			if (edef == null || list.some(([x]) => x === edef.id)) continue;
			list.push([edef.id, Math.max(1, Math.min(edef.maxLevel, Math.floor(e[1])))]);
		}
		if (list.length > 0) stack.ench = list;
	}
	if (maxStackOf(stack) === 1) stack.count = 1;
	return stack;
}

export function cloneStack(stack: ItemStack): ItemStack {
	if (stack == null) return null;
	return { id: stack.id, count: stack.count, ...(stack.dmg != null ? { dmg: stack.dmg } : {}), ...(stack.ench != null ? { ench: stack.ench.map(e => [e[0], e[1]] as [EnchantId, number]) } : {}) };
}
