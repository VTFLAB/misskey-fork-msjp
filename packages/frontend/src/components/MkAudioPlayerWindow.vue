<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkWindow
	ref="windowEl"
	:initialWidth="480"
	:initialHeight="560"
	:canResize="true"
	@closed="emit('closed')"
>
	<template #header>
		<i class="ti ti-music" style="margin-right: 6px;"></i>{{ i18n.ts._audioPlayer.title }}
	</template>

	<div :class="$style.root">
		<div :class="$style.player">
			<div v-if="currentTrack" :class="$style.nowPlaying">
				<img v-if="artworkUrl" :src="artworkUrl" :class="$style.artwork" alt=""/>
				<i v-else class="ti ti-music" :class="$style.artworkIcon"></i>
				<div :class="$style.meta">
					<div :class="$style.title">{{ trackTitle }}</div>
					<div :class="$style.artist">{{ trackArtist }}</div>
					<MkA v-if="currentTrack.noteId" :to="`/notes/${currentTrack.noteId}`" :class="$style.noteLink">{{ i18n.ts._audioPlayer.openNote }}</MkA>
				</div>
			</div>

			<div :class="$style.seekRow">
				<span :class="$style.time">{{ hms(audioPlayerState.currentTime * 1000) }}</span>
				<MkMediaRange v-model="seekValue" :buffer="audioPlayerState.buffered" :ariaLabel="i18n.ts._audioPlayer.title" :class="$style.seek"/>
				<span :class="$style.time">{{ hms(audioPlayerState.duration * 1000) }}</span>
			</div>

			<div :class="$style.mainControls">
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
				<button class="_button" :class="$style.controlButton" :aria-label="loopLabel" @click="cycleLoop">
					<i class="ti ti-repeat" :class="{ [$style.loopActive]: audioPlayerState.loop !== 'off' }"></i>
				</button>
				<button v-if="currentTrack" v-tooltip="i18n.ts._nowPlaying.post" class="_button" :class="$style.controlButton" :aria-label="i18n.ts._nowPlaying.post" @click="postNowPlaying">
					<i class="ti ti-music"></i>
				</button>
			</div>

			<div :class="$style.volumeRow">
				<button class="_button" :class="$style.controlButton" :aria-label="audioPlayerState.muted || audioPlayerState.volume === 0 ? i18n.ts.unmute : i18n.ts.mute" @click="toggleMute">
					<i v-if="audioPlayerState.muted || audioPlayerState.volume === 0" class="ti ti-volume-3"></i>
					<i v-else-if="audioPlayerState.volume < 0.5" class="ti ti-volume-2"></i>
					<i v-else class="ti ti-volume"></i>
				</button>
				<MkMediaRange v-model="volumeValue" :ariaLabel="i18n.ts.volume" :class="$style.volumeSeek"/>
			</div>
		</div>

		<div :class="$style.queueHeader">
			<span :class="$style.queueTitle"><i class="ti ti-playlist"></i> {{ i18n.ts._audioPlayer.queue }} ({{ audioPlayerState.queue.length }})</span>
			<button class="_textButton" :disabled="audioPlayerState.queue.length === 0" @click="clear">{{ i18n.ts._audioPlayer.clearQueue }}</button>
		</div>

		<div :class="$style.queue">
			<div
				v-for="(track, i) in audioPlayerState.queue"
				:key="`${track.id}:${i}`"
				:class="[$style.queueItem, { [$style.queueItemActive]: i === audioPlayerState.index }]"
			>
				<button class="_button" :class="$style.queueItemMain" @click="playAt(i)">
					<img v-if="trackArtworkUrl(track)" :src="trackArtworkUrl(track) ?? undefined" :class="$style.queueItemArtwork" alt=""/>
					<i v-else class="ti ti-music" :class="$style.queueItemArtworkIcon"></i>
					<div :class="$style.queueItemMeta">
						<div :class="$style.queueItemTitle">{{ track.file.comment || track.file.name }}</div>
						<div :class="$style.queueItemArtist">{{ track.user ? (track.user.name || track.user.username) : '' }}</div>
					</div>
				</button>
				<MkA v-if="track.noteId" :to="`/notes/${track.noteId}`" :class="$style.queueItemNoteLink" :aria-label="i18n.ts._audioPlayer.openNote">
					{{ i18n.ts._audioPlayer.openNote }}
				</MkA>
				<button class="_button" :class="$style.queueItemRemove" :aria-label="i18n.ts._audioPlayer.removeFromQueue" @click="remove(i)">
					<i class="ti ti-x"></i>
				</button>
			</div>
		</div>
	</div>
</MkWindow>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { hms } from '@/filters/hms.js';
import { i18n } from '@/i18n.js';
import MkWindow from '@/components/MkWindow.vue';
import MkMediaRange from '@/components/MkMediaRange.vue';
import {
	audioPlayerState,
	currentTrack,
	trackArtworkUrl,
	toggle,
	next,
	prev,
	seek,
	setVolume,
	toggleMute,
	cycleLoop,
	playAt,
	remove,
	clear,
} from '@/utility/audio-player.js';
import { postNowPlayingForMisskeyTrack } from '@/utility/now-playing.js';

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

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
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	height: 100%;
	padding: 16px;
	box-sizing: border-box;
	gap: 12px;
}

.player {
	flex-shrink: 0;
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.nowPlaying {
	display: flex;
	align-items: center;
	gap: 12px;
}

.artwork {
	width: 64px;
	height: 64px;
	border-radius: 8px;
	object-fit: cover;
	flex-shrink: 0;
}

.artworkIcon {
	width: 64px;
	height: 64px;
	flex-shrink: 0;
	display: grid;
	place-items: center;
	font-size: 1.6em;
	opacity: 0.7;
	background: var(--MI_THEME-buttonBg);
	border-radius: 8px;
}

.meta {
	min-width: 0;
}

.title {
	font-weight: bold;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.artist {
	opacity: 0.7;
	font-size: 0.9em;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.noteLink {
	font-size: 0.85em;
}

.seekRow {
	display: flex;
	align-items: center;
	gap: 8px;
}

.seek {
	flex: 1;
}

.time {
	font-size: 0.8em;
	opacity: 0.7;
	flex-shrink: 0;
}

.mainControls {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
}

.volumeRow {
	display: flex;
	align-items: center;
	gap: 6px;
}

.volumeSeek {
	flex: 1;
	max-width: 160px;
}

.controlButton {
	padding: 8px;
	border-radius: 6px;

	&:hover {
		background-color: var(--MI_THEME-accentedBg);
		color: var(--MI_THEME-accent);
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	&:focus-visible {
		outline: none;
	}
}

.playButton {
	font-size: 1.3em;
}

.loopActive {
	color: var(--MI_THEME-accent);
}

.queueHeader {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	justify-content: space-between;
	border-top: solid 0.5px var(--MI_THEME-divider);
	padding-top: 8px;
}

.queueTitle {
	font-weight: bold;
}

.queue {
	flex: 1;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.queueItem {
	display: flex;
	align-items: center;
	gap: 4px;
	border-radius: 6px;

	&:hover {
		background-color: var(--MI_THEME-buttonBg);
	}
}

.queueItemActive {
	background-color: var(--MI_THEME-accentedBg);
	color: var(--MI_THEME-accent);
}

.queueItemMain {
	flex: 1;
	min-width: 0;
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px;
	text-align: left;
}

.queueItemArtwork {
	width: 36px;
	height: 36px;
	border-radius: 4px;
	object-fit: cover;
	flex-shrink: 0;
}

.queueItemArtworkIcon {
	width: 36px;
	height: 36px;
	flex-shrink: 0;
	display: grid;
	place-items: center;
	opacity: 0.7;
	background: var(--MI_THEME-buttonBg);
	border-radius: 4px;
}

.queueItemMeta {
	min-width: 0;
}

.queueItemTitle {
	font-size: 0.9em;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.queueItemArtist {
	font-size: 0.8em;
	opacity: 0.7;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.queueItemNoteLink {
	flex-shrink: 0;
	font-size: 0.8em;
	padding: 4px 6px;
}

.queueItemRemove {
	flex-shrink: 0;
	padding: 6px;
	border-radius: 4px;

	&:hover {
		background-color: var(--MI_THEME-accentedBg);
		color: var(--MI_THEME-accent);
	}
}
</style>
