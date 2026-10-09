<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<div v-if="mode === 'furnace' && !nearFurnace" :class="$style.note"><i class="ti ti-info-circle"></i> {{ i18n.ts._craft.furnaceRequired }}</div>
	<div v-else-if="mode === 'crafting' && !nearTable" :class="$style.note"><i class="ti ti-info-circle"></i> {{ i18n.ts._craft.craftingTableRequired }}</div>
	<div :class="$style.tabs">
		<button
			v-for="c in categories"
			:key="c"
			type="button"
			class="_button"
			:class="[$style.tab, category === c && $style.tabActive]"
			:aria-pressed="category === c"
			@click="category = c"
		>{{ c === 'all' ? i18n.ts._craft.allCategories : categoryName(c) }}</button>
	</div>
	<div :class="$style.list">
		<div v-for="entry in filtered" :key="entry.recipe.key" :class="[$style.recipe, !entry.craftable && $style.recipeDisabled]">
			<img :class="$style.recipeIcon" :src="itemIcon(entry.recipe.result.id)" alt=""/>
			<div :class="$style.recipeBody">
				<div :class="$style.recipeName">
					{{ itemName(entry.recipe.result.id) }}<span v-if="entry.recipe.result.count > 1"> x{{ entry.recipe.result.count }}</span>
					<i v-if="entry.recipe.needs === 'table'" class="ti ti-tool" style="margin-left: 6px; opacity: 0.6;" :title="i18n.ts._craft.craftingTableRequired"></i>
					<i v-else-if="entry.recipe.needs === 'furnace'" class="ti ti-flame" style="margin-left: 6px; opacity: 0.6;" :title="i18n.ts._craft.furnaceRequired"></i>
				</div>
				<div :class="$style.recipeIngredients">
					<span v-for="(ing, i) in entry.recipe.ingredients" :key="i" :class="$style.recipeIngredient">
						<img :class="$style.recipeIngredientIcon" :src="itemIcon(ingredientIcon(ing))" alt=""/>
						{{ ingredientName(ing) }} x{{ ing.count }}
					</span>
				</div>
			</div>
			<MkButton :disabled="!entry.craftable" small primary @click="doCraft(entry.recipe)">{{ i18n.ts._craft.craftButton }}</MkButton>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { i18n } from '@/i18n.js';
import MkButton from '@/components/MkButton.vue';
import type { Ingredient, Recipe } from '@/utility/craft/constants.js';
import type { CraftEngine } from '@/utility/craft/engine.js';
import { itemIcon } from '@/utility/craft/icons.js';
import { categoryName, itemName } from './names.js';

const props = defineProps<{
	engine: CraftEngine;
	version: number;
	mode: 'crafting' | 'furnace';
}>();

const categories = ['all', 'basic', 'building', 'furniture', 'dyes', 'tools', 'weapons', 'armor', 'blocks', 'food', 'smelting'] as const;
const category = ref<string>(props.mode === 'furnace' ? 'smelting' : 'all');

const nearTable = computed(() => {
	void props.version;
	return props.engine.nearTable;
});

const nearFurnace = computed(() => {
	void props.version;
	return props.engine.nearFurnace;
});

const recipes = computed(() => {
	void props.version;
	return props.engine.recipes();
});

const filtered = computed(() => {
	if (category.value === 'all') return recipes.value;
	return recipes.value.filter(r => r.recipe.category === category.value);
});

function ingredientIcon(ing: Ingredient): number {
	const inv = props.engine.player.inventory;
	// 持っている方を優先して表示する
	for (const id of ing.ids) if (inv.count(id) > 0) return id;
	return ing.ids[0];
}

function ingredientName(ing: Ingredient): string {
	return itemName(ingredientIcon(ing));
}

function doCraft(recipe: Recipe) {
	props.engine.craftRecipe(recipe);
}

watch(() => props.mode, (m) => {
	category.value = m === 'furnace' ? 'smelting' : 'all';
});
</script>

<style lang="scss" module>
// ゲーム画面の上に重ねる UI は空の色に合わせるため、テーマ変数ではなく固定色を使う
.root {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.note {
	padding: 6px 10px;
	border-radius: 6px;
	background: rgba(255, 211, 122, 0.15);
	color: #ffd37a;
	font-size: 0.85em;
}

.tabs {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
}

.tab {
	padding: 4px 10px;
	border-radius: 999px;
	background: rgba(255, 255, 255, 0.08);
	color: #fff;
	font-size: 0.8em;
}

.tabActive {
	background: rgba(255, 255, 255, 0.3);
}

.list {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.recipe {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 6px 8px;
	border-radius: 8px;
	background: rgba(255, 255, 255, 0.07);
}

.recipeDisabled {
	opacity: 0.55;
}

.recipeIcon {
	width: 36px;
	height: 36px;
	image-rendering: pixelated;
}

.recipeBody {
	flex: 1;
	min-width: 0;
}

.recipeName {
	font-weight: bold;
	font-size: 0.9em;
	color: #fff;
}

.recipeIngredients {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-top: 2px;
	font-size: 0.8em;
	color: #fff;
	opacity: 0.85;
}

.recipeIngredient {
	display: inline-flex;
	align-items: center;
	gap: 3px;
}

.recipeIngredientIcon {
	width: 16px;
	height: 16px;
	image-rendering: pixelated;
}
</style>
