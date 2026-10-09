<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<button
	type="button"
	class="_button"
	:class="[$style.slot, active && $style.slotActive, picked && $style.slotPicked, large && $style.slotLarge]"
	:style="rarityStyle"
	:title="title"
	:aria-label="title"
	:aria-pressed="active || picked"
	@click="emit('click')"
>
	<img v-if="stack" :class="$style.icon" :src="itemIcon(stack.id, { enchanted })" alt=""/>
	<i v-else-if="placeholderIcon" :class="[placeholderIcon, $style.placeholder]"></i>
	<span v-if="count > 1" :class="$style.count">{{ count }}</span>
	<span v-if="keyLabel" :class="$style.key">{{ keyLabel }}</span>
	<div v-if="durability < 1" :class="$style.durability"><div :class="$style.durabilityFill" :style="{ width: `${Math.round(durability * 100)}%`, background: durabilityColor }"></div></div>
</button>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { i18n } from '@/i18n.js';
import type { ItemStack } from '@/utility/craft/types.js';
import { itemIcon } from '@/utility/craft/icons.js';
import { durabilityRatio, hasEnchants } from '@/utility/craft/items.js';
import { itemName, rarityColor, stackRarity } from './names.js';

const props = withDefaults(defineProps<{
	stack: ItemStack;
	active?: boolean;
	picked?: boolean;
	large?: boolean;
	keyLabel?: string;
	placeholderIcon?: string;
	label?: string;
	/** 同じ stack オブジェクトの中身 (count・耐久) が変わったときに描き直すための番号 */
	version?: number;
}>(), {
	active: false,
	picked: false,
	large: false,
	keyLabel: undefined,
	placeholderIcon: undefined,
	label: undefined,
	version: 0,
});

const emit = defineEmits<{
	(ev: 'click'): void;
}>();

const title = computed(() => props.stack ? itemName(props.stack.id) : (props.label ?? i18n.ts._craft.emptySlot));
const durability = computed(() => {
	void props.version;
	return durabilityRatio(props.stack);
});
const count = computed(() => {
	void props.version;
	return props.stack?.count ?? 0;
});
const enchanted = computed(() => {
	void props.version;
	return hasEnchants(props.stack);
});
const durabilityColor = computed(() => durability.value > 0.5 ? '#6fd36f' : durability.value > 0.2 ? '#f0c040' : '#ff5a5a');
const rarityStyle = computed(() => {
	void props.version;
	if (props.stack == null) return undefined;
	const r = stackRarity(props.stack);
	return r === 'common' ? undefined : { borderColor: rarityColor(r), boxShadow: `inset 0 0 8px ${rarityColor(r)}` };
});
</script>

<style lang="scss" module>
// ゲーム画面の上に重ねる UI は空の色に合わせるため、テーマ変数ではなく固定色を使う
.slot {
	position: relative;
	width: 40px;
	height: 40px;
	border-radius: 6px;
	border: 2px solid rgba(255, 255, 255, 0.25);
	background: rgba(0, 0, 0, 0.3);
	cursor: pointer;

	&:hover {
		border-color: rgba(255, 255, 255, 0.6);
	}
}

.slotLarge {
	width: 56px;
	height: 56px;
}

.slotActive {
	border-color: #fff;
	box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.4);
}

.slotPicked {
	border-color: #ffd37a;
	box-shadow: 0 0 0 2px rgba(255, 211, 122, 0.6);
}

.icon {
	position: absolute;
	inset: 4px;
	width: calc(100% - 8px);
	height: calc(100% - 8px);
	image-rendering: pixelated;
	pointer-events: none;
}

.placeholder {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	color: rgba(255, 255, 255, 0.3);
	font-size: 18px;
	pointer-events: none;
}

.count {
	position: absolute;
	right: 3px;
	bottom: 1px;
	font-size: 11px;
	font-weight: bold;
	color: #fff;
	text-shadow: 0 0 2px #000, 0 0 2px #000;
}

.key {
	position: absolute;
	left: 3px;
	top: 0;
	font-size: 9px;
	color: rgba(255, 255, 255, 0.7);
	text-shadow: 0 0 2px #000;
}

.durability {
	position: absolute;
	left: 5px;
	right: 5px;
	bottom: 3px;
	height: 3px;
	background: rgba(0, 0, 0, 0.6);
}

.durabilityFill {
	height: 100%;
}
</style>
