<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<div v-if="!nearTable" :class="$style.note"><i class="ti ti-info-circle"></i> {{ i18n.ts._craft.enchantingTableRequired }}</div>
	<div :class="$style.wallet">
		<span><i class="ti ti-star"></i> {{ i18n.tsx._craft.levelsCount({ n: level }) }}</span>
		<span><img :class="$style.walletIcon" :src="itemIcon(ITEM.lapis)" alt=""/> {{ itemName(ITEM.lapis) }} x{{ lapis }}</span>
	</div>

	<div :class="$style.section">
		<div :class="$style.sectionTitle"><i class="ti ti-gift"></i> {{ i18n.ts._craft.gacha }}</div>
		<div :class="$style.sectionDescription">{{ i18n.ts._craft.gachaDescription }}</div>
		<div :class="$style.tiers">
			<div v-for="t in tiers" :key="t.tier" :class="[$style.tier, $style[`tier${t.tier}`]]">
				<div :class="$style.tierName">{{ t.name }}</div>
				<div :class="$style.tierCost">{{ i18n.tsx._craft.gachaCost({ levels: t.levels, lapis: t.lapis }) }}</div>
				<MkButton :disabled="rolling || !nearTable || level < t.levels || lapis < t.lapis" primary small @click="roll(t.tier)">{{ rolling ? i18n.ts._craft.gachaRolling : i18n.ts._craft.gachaRoll }}</MkButton>
			</div>
		</div>
		<div v-if="rolling" :class="$style.rolling">
			<img :class="$style.rollingIcon" :src="rollingIcon" alt=""/>
		</div>
		<div v-else-if="result" :class="$style.result" :style="{ borderColor: result.color, boxShadow: `0 0 24px ${result.color}` }">
			<div :class="$style.resultTitle">{{ i18n.ts._craft.gachaResult }}</div>
			<XSlot :version="version" :stack="result.stack" large/>
			<div :class="$style.resultName" :style="{ color: result.color }">{{ result.name }}</div>
			<div :class="$style.resultRarity" :style="{ color: result.color }">{{ result.rarity }}</div>
			<div v-for="e in result.enchants" :key="e" :class="$style.resultEnchant">{{ e }}</div>
		</div>
		<div v-if="message" :class="$style.message">{{ message }}</div>
	</div>

	<div :class="$style.section">
		<div :class="$style.sectionTitle"><i class="ti ti-wand"></i> {{ i18n.ts._craft.enchantHeld }}</div>
		<div :class="$style.sectionDescription">{{ i18n.ts._craft.enchantHeldDescription }}</div>
		<div :class="$style.held">
			<XSlot :version="version" :stack="held" large/>
			<div v-if="held" :class="$style.heldInfo">
				<div :class="$style.heldName">{{ itemName(held.id) }}</div>
				<div v-for="e in heldEnchants" :key="e" :class="$style.resultEnchant">{{ e }}</div>
			</div>
		</div>
		<div :class="$style.tierButtons">
			<MkButton v-for="t in tiers" :key="t.tier" :disabled="rolling || !nearTable || held == null || level < t.levels || lapis < t.lapis" small @click="enchantHeld(t.tier)">{{ t.name }} ({{ i18n.tsx._craft.gachaCost({ levels: t.levels, lapis: t.lapis }) }})</MkButton>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, onUnmounted, ref } from 'vue';
import { i18n } from '@/i18n.js';
import MkButton from '@/components/MkButton.vue';
import { GACHA_TIERS, ITEM, ITEM_DEFS } from '@/utility/craft/constants.js';
import type { GachaTier } from '@/utility/craft/constants.js';
import type { CraftEngine } from '@/utility/craft/engine.js';
import { itemIcon } from '@/utility/craft/icons.js';
import type { ItemStack } from '@/utility/craft/types.js';
import XSlot from './craft.item-slot.vue';
import { enchantList, enchantName, itemName, rarityColor, rarityName, stackRarity } from './names.js';

const props = defineProps<{
	engine: CraftEngine;
	version: number;
}>();

const emit = defineEmits<{
	(ev: 'changed'): void;
}>();

const tiers = ([1, 2, 3] as GachaTier[]).map(tier => ({
	tier,
	name: tier === 1 ? i18n.ts._craft.gachaTier1 : tier === 2 ? i18n.ts._craft.gachaTier2 : i18n.ts._craft.gachaTier3,
	levels: GACHA_TIERS[tier].levels,
	lapis: GACHA_TIERS[tier].lapis,
}));

const rolling = ref(false);
const rollingIcon = ref('');
const message = ref<string | null>(null);
const result = ref<{ stack: ItemStack; name: string; rarity: string; color: string; enchants: string[] } | null>(null);
let rollTimer: number | null = null;

const nearTable = computed(() => {
	void props.version;
	return props.engine.nearEnchantingTable;
});

const level = computed(() => {
	void props.version;
	return props.engine.player.stats.level;
});

const lapis = computed(() => {
	void props.version;
	return props.engine.player.inventory.count(ITEM.lapis);
});

const held = computed<ItemStack>(() => {
	void props.version;
	return props.engine.player.selectedStack;
});

const heldEnchants = computed(() => enchantList(held.value));

const equipmentIds = Object.values(ITEM_DEFS).filter(d => d.kind === 'tool' || d.kind === 'armor' || d.kind === 'bow').map(d => d.id);

function roll(tier: GachaTier) {
	if (rolling.value) return;
	const res = props.engine.rollGacha(tier);
	message.value = null;
	result.value = null;
	if (!res.ok) {
		message.value = res.reason === 'full' ? i18n.ts._craft.gachaInventoryFull : res.reason === 'noTable' ? i18n.ts._craft.enchantingTableRequired : i18n.ts._craft.gachaNotEnough;
		return;
	}
	emit('changed');
	// 1.2 秒ほどアイコンを回してから結果を見せる
	rolling.value = true;
	props.engine.playUiSound('gachaRoll');
	let ticks = 0;
	const spin = () => {
		rollingIcon.value = itemIcon(equipmentIds[Math.floor(Math.random() * equipmentIds.length)]);
		ticks++;
		if (ticks < 14) {
			rollTimer = window.setTimeout(spin, 50 + ticks * 8);
		} else {
			rolling.value = false;
			rollTimer = null;
			const rarity = stackRarity(res.item);
			result.value = {
				stack: res.item,
				name: itemName(res.item.id),
				rarity: rarityName(rarity),
				color: rarityColor(rarity),
				enchants: enchantList(res.item),
			};
		}
	};
	spin();
}

function enchantHeld(tier: GachaTier) {
	const res = props.engine.enchantHeld(tier);
	result.value = null;
	if (!res.ok) {
		message.value = res.reason === 'notApplicable' ? i18n.ts._craft.enchantNotApplicable : res.reason === 'noTable' ? i18n.ts._craft.enchantingTableRequired : i18n.ts._craft.gachaNotEnough;
		return;
	}
	message.value = i18n.tsx._craft.enchantResult({
		name: itemName(res.stack.id),
		enchants: res.added.map(([id, lvl]) => enchantName(id, lvl)).join('、'),
	});
	emit('changed');
}

onUnmounted(() => {
	if (rollTimer != null) window.clearTimeout(rollTimer);
});
</script>

<style lang="scss" module>
// ゲーム画面の上に重ねる UI は空の色に合わせるため、テーマ変数ではなく固定色を使う
.root {
	display: flex;
	flex-direction: column;
	gap: 12px;
	color: #fff;
}

.note {
	padding: 6px 10px;
	border-radius: 6px;
	background: rgba(255, 211, 122, 0.15);
	color: #ffd37a;
	font-size: 0.85em;
}

.wallet {
	display: flex;
	gap: 16px;
	font-size: 0.9em;
	opacity: 0.9;
}

.walletIcon {
	width: 16px;
	height: 16px;
	vertical-align: middle;
	image-rendering: pixelated;
}

.section {
	padding: 10px;
	border-radius: 8px;
	background: rgba(255, 255, 255, 0.07);
}

.sectionTitle {
	font-weight: bold;
}

.sectionDescription {
	font-size: 0.8em;
	opacity: 0.75;
	margin-bottom: 8px;
}

.tiers {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 6px;
}

.tier {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 4px;
	padding: 8px 4px;
	border-radius: 8px;
	border: 2px solid rgba(255, 255, 255, 0.2);
	text-align: center;
}

.tier1 {
	border-color: rgba(255, 255, 255, 0.3);
}

.tier2 {
	border-color: #5ab0ff;
}

.tier3 {
	border-color: #ffb347;
}

.tierName {
	font-weight: bold;
	font-size: 0.9em;
}

.tierCost {
	font-size: 0.75em;
	opacity: 0.8;
}

.rolling {
	display: flex;
	justify-content: center;
	padding: 12px;
}

.rollingIcon {
	width: 56px;
	height: 56px;
	image-rendering: pixelated;
	animation: craft-roll 0.3s linear infinite;
}

@keyframes craft-roll {
	from { transform: rotate(0deg) scale(1); }
	50% { transform: rotate(180deg) scale(1.2); }
	to { transform: rotate(360deg) scale(1); }
}

.result {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 4px;
	margin-top: 10px;
	padding: 12px;
	border-radius: 10px;
	border: 2px solid;
	background: rgba(0, 0, 0, 0.4);
	animation: craft-pop 0.4s ease-out;
}

@keyframes craft-pop {
	from { transform: scale(0.6); opacity: 0; }
	to { transform: scale(1); opacity: 1; }
}

.resultTitle {
	font-size: 0.8em;
	opacity: 0.8;
}

.resultName {
	font-weight: bold;
}

.resultRarity {
	font-size: 0.85em;
}

.resultEnchant {
	font-size: 0.85em;
	color: #c9a6ff;
}

.message {
	margin-top: 8px;
	font-size: 0.85em;
	color: #ffd37a;
}

.held {
	display: flex;
	align-items: center;
	gap: 10px;
	margin-bottom: 8px;
}

.heldName {
	font-weight: bold;
	font-size: 0.9em;
}

.tierButtons {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}
</style>
