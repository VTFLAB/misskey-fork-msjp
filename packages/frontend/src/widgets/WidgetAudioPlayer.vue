<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_panel mkw-audio-player" :class="$style.root">
	<div v-if="currentTrack" :class="$style.nowPlaying">
		<img v-if="artworkUrl" :src="artworkUrl" :class="$style.artwork" alt=""/>
		<i v-else class="ti ti-music" :class="$style.artworkIcon"></i>
		<div :class="$style.meta">
			<div :class="$style.title">{{ currentTitle }}</div>
			<div :class="$style.artist">{{ currentArtist }}</div>
		</div>
	</div>
	<div v-else :class="$style.empty">
		<i class="ti ti-music"></i>
	</div>

	<MkMediaRange v-model="seekValue" :buffer="audioPlayerState.buffered" :ariaLabel="i18n.ts._audioPlayer.title" :class="$style.seek"/>

	<div :class="$style.controls">
		<button class="_button" :class="$style.controlButton" :aria-label="i18n.ts._audioPlayer.previous" @click="prev">
			<i class="ti ti-player-track-prev"></i>
		</button>
		<button class="_button" :class="$style.controlButton" :aria-label="audioPlayerState.playing ? i18n.ts._audioPlayer.pause : i18n.ts._audioPlayer.play" @click="toggle">
			<i v-if="audioPlayerState.playing" class="ti ti-player-pause"></i>
			<i v-else class="ti ti-player-play"></i>
		</button>
		<button class="_button" :class="$style.controlButton" :aria-label="i18n.ts.next" @click="next">
			<i class="ti ti-player-track-next"></i>
		</button>
		<button v-tooltip="loopLabel" class="_button" :class="$style.controlButton" :aria-label="loopLabel" @click="cycleLoop">
			<i :class="[audioPlayerState.loop === 'one' ? 'ti ti-repeat-once' : 'ti ti-repeat', { [$style.loopActive]: audioPlayerState.loop !== 'off' }]"></i>
		</button>
		<button v-if="currentTrack" v-tooltip="i18n.ts._nowPlaying.post" class="_button" :class="$style.controlButton" :aria-label="i18n.ts._nowPlaying.post" @click="postNowPlaying">
			<i class="ti ti-music"></i>
		</button>
	</div>

	<div v-if="audioPlayerState.queue.length > 0" :class="$style.queue">
		<button
			v-for="(track, i) in audioPlayerState.queue"
			:key="`${track.id}:${i}`"
			class="_button"
			:class="[$style.queueItem, { [$style.queueItemActive]: i === audioPlayerState.index }]"
			@click="playAt(i)"
		>
			<span :class="$style.queueItemTitle">{{ trackTitle(track) }}</span>
		</button>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { useWidgetPropsManager } from './widget.js';
import type { WidgetComponentEmits, WidgetComponentExpose, WidgetComponentProps } from './widget.js';
import type { FormWithDefault, GetFormResultType } from '@/utility/form.js';
import { i18n } from '@/i18n.js';
import MkMediaRange from '@/components/MkMediaRange.vue';
import {
	audioPlayerState,
	currentTrack,
	trackArtworkUrl,
	trackTitle,
	trackArtist,
	toggle,
	next,
	prev,
	seek,
	cycleLoop,
	playAt,
} from '@/utility/audio-player.js';
import { postNowPlayingForMisskeyTrack } from '@/utility/now-playing.js';

const name = 'audioPlayer';

const widgetPropsDef = {
} satisfies FormWithDefault;

type WidgetProps = GetFormResultType<typeof widgetPropsDef>;

const props = defineProps<WidgetComponentProps<WidgetProps>>();
const emit = defineEmits<WidgetComponentEmits<WidgetProps>>();

const { widgetProps, configure } = useWidgetPropsManager(name,
	widgetPropsDef,
	props,
	emit,
);

const currentTitle = computed(() => trackTitle(currentTrack.value));

const currentArtist = computed(() => trackArtist(currentTrack.value));

const artworkUrl = computed(() => trackArtworkUrl(currentTrack.value));

async function postNowPlaying() {
	if (currentTrack.value == null) return;
	await postNowPlayingForMisskeyTrack(currentTrack.value);
}

const seekValue = computed({
	get: () => audioPlayerState.duration > 0 ? audioPlayerState.currentTime / audioPlayerState.duration : 0,
	set: (v: number) => {
		seek(v * audioPlayerState.duration);
	},
});

const loopLabel = computed(() => {
	switch (audioPlayerState.loop) {
		case 'one': return i18n.ts._audioPlayer.loopOne;
		case 'all': return i18n.ts._audioPlayer.loopAll;
		default: return i18n.ts._audioPlayer.loopOff;
	}
});

defineExpose<WidgetComponentExpose>({
	name,
	configure,
	id: props.widget ? props.widget.id : null,
});
</script>

<style lang="scss" module>
.root {
	padding: 12px;
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.nowPlaying {
	display: flex;
	align-items: center;
	gap: 8px;
}

.artwork {
	width: 42px;
	height: 42px;
	border-radius: 6px;
	object-fit: cover;
	flex-shrink: 0;
}

.artworkIcon {
	width: 42px;
	height: 42px;
	flex-shrink: 0;
	display: grid;
	place-items: center;
	opacity: 0.7;
	background: var(--MI_THEME-buttonBg);
	border-radius: 6px;
}

.empty {
	display: grid;
	place-items: center;
	height: 42px;
	opacity: 0.5;
}

.meta {
	min-width: 0;
}

.title {
	font-size: 0.9em;
	font-weight: bold;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.artist {
	font-size: 0.8em;
	opacity: 0.7;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.controls {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 4px;
}

.controlButton {
	padding: 6px;
	border-radius: 4px;

	&:hover {
		background-color: var(--MI_THEME-accentedBg);
		color: var(--MI_THEME-accent);
	}

	&:focus-visible {
		outline: none;
	}
}

.loopActive {
	color: var(--MI_THEME-accent);
}

.queue {
	max-height: 140px;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.queueItem {
	display: block;
	width: 100%;
	text-align: left;
	padding: 4px 6px;
	border-radius: 4px;
	font-size: 0.85em;

	&:hover {
		background-color: var(--MI_THEME-buttonBg);
	}
}

.queueItemActive {
	background-color: var(--MI_THEME-accentedBg);
	color: var(--MI_THEME-accent);
}

.queueItemTitle {
	display: block;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
</style>
