<!--
SPDX-FileCopyrightText: misskey-bsky-integration fork
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<div v-for="channel in channels" :key="channel.id" :class="[$style.row, { [$style.active]: channel.id === radioState.channel?.id }]">
		<button class="_button" :class="$style.main" :aria-current="channel.id === radioState.channel?.id ? 'true' : undefined" @click="emit('play', channel)">
			<span :class="$style.indicator">
				<i v-if="channel.id === radioState.channel?.id && radioState.status === 'playing'" class="ti ti-volume"></i>
				<MkLoading v-else-if="channel.id === radioState.channel?.id && radioState.status === 'connecting'" :em="true" :class="$style.loading"/>
				<i v-else class="ti ti-player-play"></i>
			</span>
			<span :class="$style.text">
				<span :class="$style.title">{{ channel.title }}</span>
				<span v-if="showPlace" :class="$style.sub">{{ channelSubtitle(channel) }}</span>
			</span>
		</button>
		<button
			v-if="canFavorite"
			v-tooltip="isRadioFavorite(channel.id) ? i18n.ts._radio.removeFavorite : i18n.ts._radio.addFavorite"
			class="_button"
			:class="[$style.fav, { [$style.favOn]: isRadioFavorite(channel.id) }]"
			:aria-label="i18n.ts._radio.favorite"
			:aria-pressed="isRadioFavorite(channel.id)"
			@click="toggleFavorite(channel)"
		>
			<i :class="isRadioFavorite(channel.id) ? 'ti ti-heart-filled' : 'ti ti-heart'"></i>
		</button>
	</div>
</div>
</template>

<script lang="ts" setup>
import type { RadioChannel } from '@/utility/radio-garden.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { radioState } from '@/utility/radio-player.js';
import { canUseRadioFavorites, channelSubtitle, isRadioFavorite, setRadioFavorite } from '@/utility/radio-garden.js';

withDefaults(defineProps<{
	channels: RadioChannel[];
	showPlace?: boolean;
}>(), {
	showPlace: true,
});

const emit = defineEmits<{
	(ev: 'play', channel: RadioChannel): void;
}>();

const canFavorite = canUseRadioFavorites();

function toggleFavorite(channel: RadioChannel): void {
	setRadioFavorite(channel, !isRadioFavorite(channel.id)).catch(() => {
		os.alert({ type: 'error', text: i18n.ts.somethingHappened });
	});
}
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
}

.row {
	display: flex;
	align-items: center;
	border-radius: 6px;

	&:hover {
		background: var(--MI_THEME-buttonBg);
	}

	&.active {
		background: color-mix(in srgb, var(--radioGreen) 14%, transparent);
	}
}

.main {
	flex: 1;
	min-width: 0;
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 4px 6px 8px;
	text-align: left;
}

.indicator {
	flex-shrink: 0;
	width: 18px;
	display: grid;
	place-items: center;
	opacity: 0.6;

	.active & {
		opacity: 1;
		color: var(--radioGreenText);
	}
}

.loading {
	margin: 0;
}

.text {
	min-width: 0;
	display: flex;
	flex-direction: column;
}

.title {
	font-size: 0.9em;
	font-weight: bold;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.sub {
	font-size: 0.75em;
	opacity: 0.7;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.fav {
	flex-shrink: 0;
	padding: 6px 8px;
	opacity: 0.5;

	&:hover {
		opacity: 1;
	}
}

.favOn {
	opacity: 1;
	color: var(--radioGreenText);
}
</style>
