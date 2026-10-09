/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { i18n } from '@/i18n.js';
import { ITEM_DEFS } from '@/utility/craft/constants.js';
import type { EnchantId, MobType } from '@/utility/craft/constants.js';
import { enchantLabel, rarityOf } from '@/utility/craft/items.js';
import type { Rarity } from '@/utility/craft/items.js';
import type { ItemStack } from '@/utility/craft/types.js';

const dict = (key: string): Record<string, string> => (i18n.ts._craft as unknown as Record<string, Record<string, string>>)[key] ?? {};

export function itemName(id: number): string {
	const def = ITEM_DEFS[id];
	if (def == null) return '';
	if (def.kind === 'block') return dict('_blocks')[def.key] ?? def.key;
	return dict('_items')[def.key] ?? def.key;
}

export function mobName(type: MobType): string {
	return dict('_mobs')[type] ?? type;
}

export function enchantName(id: EnchantId, level: number): string {
	return enchantLabel(id, level, dict('_enchants'));
}

export function enchantList(stack: ItemStack): string[] {
	if (stack?.ench == null) return [];
	return stack.ench.map(([id, lvl]) => enchantName(id, lvl));
}

export function rarityName(r: Rarity): string {
	switch (r) {
		case 'common': return i18n.ts._craft.rarityCommon;
		case 'rare': return i18n.ts._craft.rarityRare;
		case 'epic': return i18n.ts._craft.rarityEpic;
		case 'legendary': return i18n.ts._craft.rarityLegendary;
	}
}

export function rarityColor(r: Rarity): string {
	switch (r) {
		case 'common': return 'rgba(255, 255, 255, 0.25)';
		case 'rare': return '#5ab0ff';
		case 'epic': return '#c56bff';
		case 'legendary': return '#ffb347';
	}
}

export function stackRarity(stack: ItemStack): Rarity {
	return rarityOf(stack);
}

export function categoryName(category: string): string {
	return dict('_categories')[category] ?? category;
}

