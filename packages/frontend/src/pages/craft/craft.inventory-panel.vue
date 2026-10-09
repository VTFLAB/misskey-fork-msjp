<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<div :class="$style.top">
		<div :class="$style.armorColumn">
			<XSlot
				v-for="(slot, i) in armorSlots"
				:key="slot.key"
				:version="version"
				:stack="slots[PLAYER.armorSlotStart + i]"
				:picked="picked === PLAYER.armorSlotStart + i"
				:placeholderIcon="slot.icon"
				:label="slot.label"
				@click="clickSlot(PLAYER.armorSlotStart + i)"
			/>
		</div>
		<div :class="$style.summary">
			<div :class="$style.summaryRow"><i class="ti ti-shield"></i> {{ i18n.ts._craft.armor }}: {{ armorPoints }}</div>
			<div :class="$style.summaryRow"><i class="ti ti-star"></i> {{ i18n.tsx._craft.levelsCount({ n: level }) }}</div>
			<MkButton small @click="sortInventory"><i class="ti ti-sort-descending"></i> {{ i18n.ts._craft.sortInventory }}</MkButton>
			<div v-if="detail" :class="$style.detail">
				<div :class="$style.detailName" :style="{ color: detail.color }">{{ detail.name }}</div>
				<div v-if="detail.rarity" :class="$style.detailRarity" :style="{ color: detail.color }">{{ detail.rarity }}</div>
				<div v-for="e in detail.enchants" :key="e" :class="$style.detailEnchant">{{ e }}</div>
				<div v-if="detail.durability != null" :class="$style.detailLine">{{ i18n.ts._craft.durability }}: {{ detail.durability }}</div>
				<div v-if="detail.stats.length > 0" :class="$style.detailLine"><span v-for="st in detail.stats" :key="st.icon" style="margin-right: 8px;"><i :class="st.icon"></i> {{ st.text }}</span></div>
				<div :class="$style.detailButtons">
					<MkButton v-if="detail.canEquip" small primary @click="equip">{{ i18n.ts._craft.equip }}</MkButton>
					<MkButton v-if="detail.canUnequip" small @click="unequip">{{ i18n.ts._craft.unequip }}</MkButton>
					<MkButton small danger @click="discard"><i class="ti ti-trash"></i> {{ i18n.ts._craft.trash }}</MkButton>
				</div>
			</div>
		</div>
	</div>
	<div :class="$style.grid">
		<XSlot
			v-for="index in mainIndexes"
			:key="index"
			:version="version"
			:stack="slots[index]"
			:picked="picked === index"
			@click="clickSlot(index)"
		/>
	</div>
	<div :class="$style.grid" style="margin-top: 10px;">
		<XSlot
			v-for="index in hotbarIndexes"
			:key="index"
			:version="version"
			:stack="slots[index]"
			:picked="picked === index"
			:active="index === hotbarIndex"
			:keyLabel="String(index + 1)"
			@click="clickSlot(index)"
		/>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import MkButton from '@/components/MkButton.vue';
import { ITEM_DEFS, PLAYER } from '@/utility/craft/constants.js';
import type { CraftEngine } from '@/utility/craft/engine.js';
import type { ItemStack } from '@/utility/craft/types.js';
import { remainingDurability } from '@/utility/craft/items.js';
import XSlot from './craft.item-slot.vue';
import { enchantList, itemName, rarityColor, rarityName, stackRarity } from './names.js';

const props = defineProps<{
	engine: CraftEngine;
	version: number;
}>();

const picked = ref<number | null>(null);

const armorSlots = [
	{ key: 'helmet', icon: 'ti ti-helmet', label: i18n.ts._craft.helmet },
	{ key: 'chestplate', icon: 'ti ti-shirt', label: i18n.ts._craft.chestplate },
	{ key: 'leggings', icon: 'ti ti-hanger', label: i18n.ts._craft.leggings },
	{ key: 'boots', icon: 'ti ti-shoe', label: i18n.ts._craft.boots },
];

const mainIndexes = Array.from({ length: PLAYER.inventorySize - PLAYER.hotbarSize }, (_, i) => i + PLAYER.hotbarSize);
const hotbarIndexes = Array.from({ length: PLAYER.hotbarSize }, (_, i) => i);

const slots = computed<ItemStack[]>(() => {
	void props.version;
	return [...props.engine.player.inventory.slots];
});

const hotbarIndex = computed(() => {
	void props.version;
	return props.engine.player.hotbarIndex;
});

const armorPoints = computed(() => {
	void props.version;
	return props.engine.player.inventory.armorPoints();
});

const level = computed(() => {
	void props.version;
	return props.engine.player.stats.level;
});

const detail = computed(() => {
	void props.version;
	if (picked.value == null) return null;
	const stack = props.engine.player.inventory.slots[picked.value];
	if (stack == null) return null;
	const def = ITEM_DEFS[stack.id];
	const rarity = stackRarity(stack);
	const durability = remainingDurability(stack);
	let stats: { icon: string; text: string }[] = [];
	if (def?.tool) stats = [{ icon: 'ti ti-sword', text: String(def.tool.attack) }, { icon: 'ti ti-pick', text: `x${def.tool.speed}` }];
	else if (def?.armor) stats = [{ icon: 'ti ti-shield', text: String(def.armor.points) }];
	else if (def?.food) stats = [{ icon: 'ti ti-meat', text: String(def.food.nutrition) }];
	return {
		name: itemName(stack.id),
		color: rarity === 'common' ? '#fff' : rarityColor(rarity),
		rarity: rarity === 'common' ? null : rarityName(rarity),
		enchants: enchantList(stack),
		durability: durability != null ? `${durability} / ${def?.durability}` : null,
		stats,
		canEquip: def?.armor != null && picked.value < PLAYER.armorSlotStart,
		canUnequip: picked.value >= PLAYER.armorSlotStart,
	};
});

function clickSlot(index: number) {
	const inv = props.engine.player.inventory;
	if (picked.value == null) {
		if (inv.slots[index] != null) picked.value = index;
		return;
	}
	if (picked.value === index) {
		picked.value = null;
		return;
	}
	props.engine.moveItem(picked.value, index);
	picked.value = null;
}

function sortInventory() {
	props.engine.sortInventory();
	picked.value = null;
}

function equip() {
	if (picked.value == null) return;
	props.engine.equipFromSlot(picked.value);
	picked.value = null;
}

function unequip() {
	if (picked.value == null) return;
	const inv = props.engine.player.inventory;
	const empty = inv.slots.findIndex((s, i) => s == null && i < PLAYER.inventorySize);
	if (empty < 0) return;
	props.engine.moveItem(picked.value, empty);
	picked.value = null;
}

async function discard() {
	if (picked.value == null) return;
	const stack = props.engine.player.inventory.slots[picked.value];
	if (stack == null) return;
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.tsx._craft.trashConfirm({ name: `${itemName(stack.id)} x${stack.count}` }),
	});
	if (canceled) return;
	props.engine.discardItem(picked.value);
	picked.value = null;
}

watch(() => props.version, () => {
	if (picked.value != null && props.engine.player.inventory.slots[picked.value] == null) picked.value = null;
});
</script>

<style lang="scss" module>
// ゲーム画面の上に重ねる UI は空の色に合わせるため、テーマ変数ではなく固定色を使う
.root {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 10px;
}

.top {
	display: flex;
	gap: 12px;
	width: 100%;
	max-width: 392px;
}

.armorColumn {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.summary {
	flex: 1;
	min-width: 0;
	font-size: 0.85em;
	color: #fff;
}

.summaryRow {
	opacity: 0.85;
	margin-bottom: 4px;
}

.detail {
	margin-top: 6px;
	padding: 8px 10px;
	border-radius: 8px;
	background: rgba(255, 255, 255, 0.08);
}

.detailName {
	font-weight: bold;
}

.detailRarity {
	font-size: 0.85em;
}

.detailEnchant {
	color: #c9a6ff;
	font-size: 0.9em;
}

.detailLine {
	opacity: 0.8;
	font-size: 0.9em;
}

.detailButtons {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin-top: 6px;
}

.grid {
	display: grid;
	grid-template-columns: repeat(9, 40px);
	gap: 4px;
}
</style>
