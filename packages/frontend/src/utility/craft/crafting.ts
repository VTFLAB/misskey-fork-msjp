/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BLOCK, RECIPES } from './constants.js';
import type { Recipe } from './constants.js';
import type { Inventory } from './inventory.js';
import type { Vec3 } from './types.js';
import type { CraftWorld } from './world.js';

function canCraft(inv: Inventory, recipe: Recipe, nearTable: boolean): boolean {
	if (recipe.needsTable && !nearTable) return false;
	return inv.has(recipe.ingredients);
}

export function availableRecipes(inv: Inventory, nearTable: boolean): { recipe: Recipe; craftable: boolean }[] {
	const list = RECIPES.map(recipe => ({ recipe, craftable: canCraft(inv, recipe, nearTable) }));
	// Array#sort は安定なので、同じグループ内では RECIPES の順序が保たれる
	return list.sort((a, b) => Number(b.craftable) - Number(a.craftable));
}

export function craft(inv: Inventory, recipe: Recipe, nearTable: boolean): boolean {
	if (!canCraft(inv, recipe, nearTable)) return false;
	const backup = inv.serialize();
	for (const ing of recipe.ingredients) {
		inv.remove(ing.id, ing.count);
	}
	if (inv.add(recipe.result.id, recipe.result.count) > 0) {
		// 入りきらないので元に戻す
		inv.load(backup);
		return false;
	}
	return true;
}

export function isNearCraftingTable(world: CraftWorld, pos: Vec3, radius = 3): boolean {
	const cx = Math.floor(pos.x), cy = Math.floor(pos.y), cz = Math.floor(pos.z);
	for (let x = cx - radius; x <= cx + radius; x++) {
		for (let y = cy - radius; y <= cy + radius; y++) {
			for (let z = cz - radius; z <= cz + radius; z++) {
				if (world.peekBlock(x, y, z) === BLOCK.craftingTable) return true;
			}
		}
	}
	return false;
}
