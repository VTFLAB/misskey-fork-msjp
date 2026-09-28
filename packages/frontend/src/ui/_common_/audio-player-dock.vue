<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div v-if="hasQueue" :class="$style.root" class="_panel _shadow" role="region" :aria-label="i18n.ts._audioPlayer.title">
	<div :class="$style.topRow">
		<button class="_button" :class="$style.artwork" :aria-label="i18n.ts._audioPlayer.expand" @click="openWindow">
			<img v-if="artworkUrl" :src="artworkUrl" :class="$style.artworkImg" alt=""/>
			<i v-else class="ti ti-music" :class="$style.artworkIcon"></i>
		</button>

		<button class="_button" :class="$style.meta" :aria-label="i18n.ts._audioPlayer.expand" @click="openWindow">
			<div :class="$style.title" :title="trackTitle">{{ trackTitle }}</div>
			<div :class="$style.artist" :title="trackArtist">{{ trackArtist }}</div>
		</button>

		<div :class="$style.transport">
			<button class="_button" :class="$style.controlButton" :aria-label="i18n.ts._audioPlayer.previous" @click="prev">
				<i class="ti ti-player-track-prev"></i>
			</button>
			<button class="_button" :class="[$style.controlButton, $style.playButton]" :aria-label="audioPlayerState.playing ? i18n.ts._audioPlayer.pause : i18n.ts._audioPlayer.play" @click="toggle">
				<i v-if="audioPlayerState.playing" class="ti ti-player-pause"></i>
				<i v-else class="ti ti-player-play"></i>
			</button>
			<button class="_button" :class="$style.controlButton" :aria-label="i18n.ts.next" @click="next">
				<i class="ti ti-player-track-next"></i>
			</button>
		</div>

		<div :class="$style.secondary">
			<button v-if="currentTrack" v-tooltip="i18n.ts._nowPlaying.post" class="_button" :class="$style.controlButton" :aria-label="i18n.ts._nowPlaying.post" @click="postNowPlaying">
				<i class="ti ti-music"></i>
			</button>
			<button class="_button" :class="$style.controlButton" :aria-label="i18n.ts._audioPlayer.expand" @click="openWindow">
				<i class="ti ti-arrows-maximize"></i>
			</button>
			<button class="_button" :class="$style.controlButton" :aria-label="i18n.ts._audioPlayer.close" @click="clear">
				<i class="ti ti-x"></i>
			</button>
		</div>
	</div>

	<div :class="$style.bottomRow">
		<span :class="$style.time">{{ hms(audioPlayerState.currentTime * 1000) }}</span>
		<MkMediaRange
			v-model="seekValue"
			:buffer="audioPlayerState.buffered"
			:ariaLabel="i18n.ts._audioPlayer.title"
			:class="$style.seek"
		/>
		<span :class="$style.time">{{ hms(audioPlayerState.duration * 1000) }}</span>

		<div :class="$style.volumeGroup">
			<button class="_button" :class="$style.controlButton" :aria-label="audioPlayerState.muted || audioPlayerState.volume === 0 ? i18n.ts.unmute : i18n.ts.mute" @click="toggleMute">
				<i v-if="audioPlayerState.muted || audioPlayerState.volume === 0" class="ti ti-volume-3"></i>
				<i v-else-if="audioPlayerState.volume < 0.5" class="ti ti-volume-2"></i>
				<i v-else class="ti ti-volume"></i>
			</button>
			<MkMediaRange v-model="volumeValue" :ariaLabel="i18n.ts.volume" :class="$style.volumeSeek"/>
		</div>

		<button class="_button" :class="$style.controlButton" :aria-label="loopLabel" @click="cycleLoop">
			<i class="ti ti-repeat" :class="{ [$style.loopActive]: audioPlayerState.loop !== 'off' }"></i>
		</button>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { hms } from '@/filters/hms.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import MkMediaRange from '@/components/MkMediaRange.vue';
import {
	audioPlayerState,
	hasQueue,
	currentTrack,
	trackArtworkUrl,
	toggle,
	next,
	prev,
	seek,
	setVolume,
	toggleMute,
	cycleLoop,
	clear,
} from '@/utility/audio-player.js';
import { postNowPlayingForMisskeyTrack } from '@/utility/now-playing.js';

const zIndex = os.claimZIndex('high');

const trackTitle = computed(() => {
	const track = currentTrack.value;
	if (track == null) return '';
	return track.file.comment || track.file.name;
});

const trackArtist = computed(() => {
	const user = currentTrack.value?.user;
	if (user == null) return '';
	return user.name || user.username;
});

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

const volumeValue = computed({
	get: () => audioPlayerState.volume,
	set: (v: number) => {
		setVolume(v);
	},
});

const loopLabel = computed(() => {
	switch (audioPlayerState.loop) {
		case 'one': return i18n.ts._audioPlayer.loopOne;
		case 'all': return i18n.ts._audioPlayer.loopAll;
		default: return i18n.ts._audioPlayer.loopOff;
	}
});

let windowOpening = false;

async function openWindow() {
	if (windowOpening) return;
	windowOpening = true;
	try {
		const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkAudioPlayerWindow.vue').then(x => x.default), {}, {
			closed: () => {
				dispose();
				windowOpening = false;
			},
		});
	} catch (err) {
		// e.g. the dynamic import failed; do not leave the expand button latched.
		windowOpening = false;
		throw err;
	}
}
</script>

<style lang="scss" module>
.root {
	position: fixed;
	z-index: v-bind(zIndex);
	bottom: calc(var(--MI-minBottomSpacing) + var(--MI-margin));
	right: var(--MI-margin);
	width: min(520px, calc(100vw - var(--MI-margin) * 2));
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 10px 12px 8px;
	border-radius: 12px;
}

@media (max-width: 500px) {
	.root {
		left: var(--MI-margin);
		right: var(--MI-margin);
		width: auto;
	}
}

.topRow {
	display: flex;
	align-items: center;
	gap: 10px;
	min-width: 0;
}

.artwork {
	flex-shrink: 0;
	width: 44px;
	height: 44px;
	border-radius: 8px;
	overflow: clip;
	display: grid;
	place-items: center;
	background: var(--MI_THEME-buttonBg);
}

.artworkImg {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.artworkIcon {
	font-size: 1.2em;
	opacity: 0.7;
}

.meta {
	flex: 1 1 auto;
	min-width: 0;
	display: block;
	text-align: left;
}

.title {
	font-size: 0.9em;
	font-weight: bold;
	line-height: 1.3;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.artist {
	font-size: 0.8em;
	line-height: 1.3;
	opacity: 0.7;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.transport,
.secondary {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	gap: 2px;
}

.secondary {
	margin-left: 4px;
	padding-left: 6px;
	border-left: 1px solid var(--MI_THEME-divider);
}

.bottomRow {
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
}

.seek {
	flex: 1 1 auto;
	min-width: 60px;
}

.time {
	flex-shrink: 0;
	font-size: 0.75em;
	font-variant-numeric: tabular-nums;
	opacity: 0.7;
}

.controlButton {
	padding: 6px;
	border-radius: 6px;
	line-height: 1;

	&:hover {
		background-color: var(--MI_THEME-accentedBg);
		color: var(--MI_THEME-accent);
	}

	&:focus-visible {
		outline: none;
	}
}

.playButton {
	font-size: 1.15em;
}

.loopActive {
	color: var(--MI_THEME-accent);
}

.volumeGroup {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	gap: 2px;
	margin-left: 4px;
}

.volumeSeek {
	width: 80px;
}

@media (max-width: 500px) {
	.volumeSeek {
		display: none;
	}
}
</style>
