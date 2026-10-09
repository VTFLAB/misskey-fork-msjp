/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BLOCK, RECIPES } from './constants.js';
import type { Recipe } from './constants.js';
import type { Inventory } from './inventory.js';
import type { Vec3 } from './types.js';
import type { CraftWorld } from './world.js';

export type CraftContext = { nearTable: boolean; nearFurnace: boolean };

const CATEGORY_ORDER: Recipe['category'][] = ['basic', 'tools', 'weapons', 'armor', 'blocks', 'food', 'smelting'];

function meetsNeeds(recipe: Recipe, ctx: CraftContext): boolean {
	if (recipe.needs === 'table') return ctx.nearTable;
	if (recipe.needs === 'furnace') return ctx.nearFurnace;
	return true;
}

function canCraft(inv: Inventory, recipe: Recipe, ctx: CraftContext): boolean {
	return meetsNeeds(recipe, ctx) && inv.has(recipe.ingredients);
}

/** 作れる物を先に、同じグループ内は分類順 (RECIPES の並び順) */
export function availableRecipes(inv: Inventory, ctx: CraftContext): { recipe: Recipe; craftable: boolean }[] {
	const list = RECIPES.map((recipe, i) => ({ recipe, craftable: canCraft(inv, recipe, ctx), i }));
	list.sort((a, b) =>
		(Number(b.craftable) - Number(a.craftable)) ||
		(CATEGORY_ORDER.indexOf(a.recipe.category) - CATEGORY_ORDER.indexOf(b.recipe.category)) ||
		(a.i - b.i));
	return list.map(({ recipe, craftable }) => ({ recipe, craftable }));
}

/**
 * 材料を消費して結果を入れる。入りきらなければ元に戻して ok: false。
 * xp はレシピの経験値を確率で丸めた整数 (0.7 なら 70% で 1)
 */
export function craft(inv: Inventory, recipe: Recipe, ctx: CraftContext, random: () => number = Math.random): { ok: boolean; xp: number } {
	if (!canCraft(inv, recipe, ctx)) return { ok: false, xp: 0 };
	const backup = inv.serialize();
	for (const ing of recipe.ingredients) {
		if (!inv.remove(ing)) {
			inv.load(backup);
			return { ok: false, xp: 0 };
		}
	}
	// 新品で渡すので dmg / ench は付けない
	if (inv.add(recipe.result.id, recipe.result.count) > 0) {
		// 入りきらないので元に戻す
		inv.load(backup);
		return { ok: false, xp: 0 };
	}
	const raw = recipe.xp ?? 0;
	const xp = Math.floor(raw) + (random() < raw - Math.floor(raw) ? 1 : 0);
	return { ok: true, xp };
}

/** pos から radius 以内 (立方体) に blockId があるか。未生成の chunk は無いものとして扱う */
export function isNearBlock(world: CraftWorld, pos: Vec3, blockId: number, radius = 3): boolean {
	const cx = Math.floor(pos.x), cy = Math.floor(pos.y), cz = Math.floor(pos.z);
	for (let x = cx - radius; x <= cx + radius; x++) {
		for (let y = cy - radius; y <= cy + radius; y++) {
			for (let z = cz - radius; z <= cz + radius; z++) {
				if (world.peekBlock(x, y, z) === blockId) return true;
			}
		}
	}
	return false;
}

/** 作業台が近くにあるか (旧 API 互換) */
export function isNearCraftingTable(world: CraftWorld, pos: Vec3, radius = 3): boolean {
	return isNearBlock(world, pos, BLOCK.craftingTable, radius);
}
