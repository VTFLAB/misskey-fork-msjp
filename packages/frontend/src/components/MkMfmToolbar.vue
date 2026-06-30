<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<div :class="$style.header">
		<button
			v-tooltip="i18n.ts._mfmToolbar.title"
			class="_button"
			:class="[
				$style.headerButton,
				{ [$style.headerButtonActive]: showModel },
			]"
			@click="showModel = !showModel"
		>
			<i class="ti ti-icons"></i>
			<span :class="$style.headerLabel">{{
				i18n.ts._mfmToolbar.functions
			}}</span>
		</button>
	</div>
	<div :class="$style.groups">
		<div v-for="category in categories" :key="category" :class="$style.group">
			<button
				v-for="entry in entriesByCategory[category]"
				:key="entry.key"
				v-tooltip="(i18n.ts._mfmToolbar as Record<string, string>)[entry.key]"
				class="_button"
				:class="$style.button"
				:aria-label="
					(i18n.ts._mfmToolbar as Record<string, string>)[entry.key]
				"
				:disabled="textareaEl == null"
				@click="apply(entry)"
			>
				<i :class="entry.icon"></i>
			</button>
		</div>
	</div>
	<div v-if="showModel" :class="$style.functions">
		<button
			v-for="tag in MFM_TAGS"
			:key="tag"
			v-tooltip="tag"
			class="_button"
			:class="$style.button"
			:aria-label="tag"
			:disabled="textareaEl == null"
			@click="applyFunction(tag)"
		>
			<i :class="MFM_FUNCTION_ICONS[tag] ?? 'ti ti-icons'"></i>
		</button>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, nextTick } from 'vue';
import { MFM_TAGS } from '@@/js/const.js';
import type { MfmSyntaxEntry } from '@/utility/mfm-syntax.js';
import { MFM_SYNTAX_ENTRIES } from '@/utility/mfm-syntax.js';
import { i18n } from '@/i18n.js';

const MFM_FUNCTION_ICONS: Record<string, string> = {
	tada: 'ti ti-confetti',
	jelly: 'ti ti-wave-sine',
	twitch: 'ti ti-bolt',
	shake: 'ti ti-wave-square',
	spin: 'ti ti-rotate',
	jump: 'ti ti-arrow-bounce',
	bounce: 'ti ti-ball-volleyball',
	flip: 'ti ti-flip-horizontal',
	x2: 'ti ti-arrows-vertical',
	x3: 'ti ti-arrows-up-down',
	x4: 'ti ti-arrows-maximize',
	scale: 'ti ti-resize',
	position: 'ti ti-target',
	fg: 'ti ti-color-swatch',
	bg: 'ti ti-palette',
	border: 'ti ti-border-all',
	font: 'ti ti-typography',
	blur: 'ti ti-blur',
	rainbow: 'ti ti-rainbow',
	sparkle: 'ti ti-sparkles',
	rotate: 'ti ti-rotate-clockwise-2',
	ruby: 'ti ti-letter-r',
	unixtime: 'ti ti-clock-code',
};

const props = defineProps<{
	textareaEl: HTMLTextAreaElement | null;
	text: string;
}>();

const emit = defineEmits<{
	(ev: 'update:text', value: string): void;
	(ev: 'changed'): void;
}>();

const showModel = defineModel<boolean>('show', { default: false });

const categories = ['format', 'block', 'inline'] as const;

const entriesByCategory = computed(() => {
	const map = Object.fromEntries(
		categories.map((c) => [c, [] as MfmSyntaxEntry[]]),
	);
	for (const entry of MFM_SYNTAX_ENTRIES) {
		if (entry.category in map) {
			map[entry.category].push(entry);
		}
	}
	return map;
});

function apply(entry: MfmSyntaxEntry) {
	const el = props.textareaEl;
	if (el == null) return;

	const start = el.selectionStart;
	const end = el.selectionEnd;
	const result = entry.insert(props.text, start, end);

	emit('update:text', result.text);

	nextTick(() => {
		if (props.textareaEl == null) return;
		props.textareaEl.focus();
		props.textareaEl.setSelectionRange(result.start, result.end);
		emit('changed');
	});
}

function applyFunction(tag: string) {
	const el = props.textareaEl;
	if (el == null) return;

	const start = el.selectionStart;
	const end = el.selectionEnd;
	const selected = props.text.slice(start, end);
	const inserted = `$[${tag} ${selected}]`;
	const newText = `${props.text.slice(0, start)}${inserted}${props.text.slice(end)}`;

	emit('update:text', newText);

	nextTick(() => {
		if (props.textareaEl == null) return;
		props.textareaEl.focus();
		const cursor = start + inserted.length;
		props.textareaEl.setSelectionRange(cursor, cursor);
		emit('changed');
	});
}
</script>

<style lang="scss" module>
.root {
	padding: 8px;
	border-top: 1px solid var(--MI_THEME-divider);
	background: var(--MI_THEME-panel);
}

.header {
	display: flex;
	align-items: center;
	gap: 4px;
	margin-bottom: 6px;
}

.headerButton {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 4px 8px;
	border-radius: 6px;
	font-size: 12px;
	color: var(--MI_THEME-fg);
	background: transparent;
	transition: background 0.2s;

	&:hover {
		background: var(--MI_THEME-accentedBg);
	}

	&:active {
		background: var(--MI_THEME-accent);
	}
}

.headerButtonActive {
	background: var(--MI_THEME-accentedBg);
}

.headerLabel {
	font-weight: 600;
}

.groups {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 8px;
}

.group {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;

	&:not(:last-child) {
		padding-right: 8px;
		border-right: 1px solid var(--MI_THEME-divider);
	}
}

.button {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 32px;
	height: 32px;
	border-radius: 6px;
	font-size: 16px;
	color: var(--MI_THEME-fg);
	background: transparent;
	transition: background 0.2s;

	&:hover {
		background: var(--MI_THEME-accentedBg);
	}

	&:active {
		background: var(--MI_THEME-accent);
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
}

.functions {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	margin-top: 8px;
	padding-top: 8px;
	border-top: 1px solid var(--MI_THEME-divider);
}
</style>
