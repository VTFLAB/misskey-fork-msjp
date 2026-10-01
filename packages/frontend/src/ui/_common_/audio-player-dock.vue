<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div
	v-if="dockShown"
	v-show="!hidden"
	:class="[$style.root, { [$style.expanded]: mode === 'expanded', [$style.collapsed]: mode === 'collapsed', [$style.collapsedWithVideo]: mode === 'collapsed' && isYoutubeCurrent, _shadow: mode !== 'expanded' }]"
	class="_panel"
	role="region"
	:aria-label="i18n.ts._audioPlayer.title"
>
	<div v-if="mode === 'expanded'" :class="$style.exHeader">
		<button class="_button" :class="$style.controlButton" :aria-label="i18n.ts._audioPlayer.collapse" @click="expanded = false">
			<i class="ti ti-chevron-down"></i>
		</button>
		<div :class="$style.exHeaderTitle">{{ i18n.ts._audioPlayer.title }}</div>
		<button class="_button" :class="$style.controlButton" :aria-label="i18n.ts._audioPlayer.close" @click="closeDock">
			<i class="ti ti-x"></i>
		</button>
	</div>

	<!-- YouTube の曲の再生中だけ表示する動画枠 (bsky-fork 独自)。中身は audio-player-youtube.ts が
	IFrame Player に置き換えて管理するため、この要素の子にはバインディングを持たせない。
	表示形態を切り替えてもプレイヤーを作り直さないよう、この要素は常に同じ位置に置いて v-show で隠す。
	YouTube の埋め込みプレイヤーは 200x200px 以上を表示したまま再生する必要があるので、収納中も隠さない -->
	<div v-show="isYoutubeCurrent" ref="youtubeHostEl" :class="$style.video"></div>

	<!-- スマホ幅で収納しているとき: 右下の小さなボタン (YouTube の曲なら最小サイズの動画枠も) だけを出す -->
	<template v-if="mode === 'collapsed'">
		<div :class="$style.collapsedBar">
			<button class="_button" :class="$style.artwork" tabindex="-1" aria-hidden="true" @click="expanded = true">
				<img v-if="artworkUrl" :src="artworkUrl" :class="$style.artworkImg" alt=""/>
				<i v-else class="ti ti-music" :class="$style.artworkIcon"></i>
			</button>
			<button class="_button" :class="[$style.controlButton, $style.playButton]" :aria-label="audioPlayerState.playing ? i18n.ts._audioPlayer.pause : i18n.ts._audioPlayer.play" @click="toggle">
				<i v-if="audioPlayerState.playing" class="ti ti-player-pause"></i>
				<i v-else class="ti ti-player-play"></i>
			</button>
			<button class="_button" :class="$style.controlButton" :aria-label="i18n.ts._audioPlayer.expand" @click="expanded = true">
				<i class="ti ti-chevron-up"></i>
			</button>
		</div>
		<div :class="$style.collapsedProgress" :style="{ width: `${seekValue * 100}%` }"></div>
	</template>

	<!-- スマホ幅で全面展開しているとき: プレイヤーの下にキュー・プレイリストを並べる -->
	<template v-else-if="mode === 'expanded'">
		<div :class="$style.exInfo">
			<div v-if="!isYoutubeCurrent" :class="$style.exArtwork">
				<img v-if="artworkUrl" :src="artworkUrl" :class="$style.artworkImg" alt=""/>
				<i v-else class="ti ti-music" :class="$style.artworkIcon"></i>
			</div>
			<div :class="$style.exMeta">
				<div :class="$style.title" :title="currentTitle">{{ currentTrack ? currentTitle : i18n.ts._audioPlayer.notPlaying }}</div>
				<div v-if="trackUnavailableLabel(currentTrack)" :class="[$style.artist, $style.unavailable]">{{ trackUnavailableLabel(currentTrack) }}</div>
				<div v-else :class="$style.artist" :title="currentArtist">{{ currentArtist }}</div>
			</div>
			<button v-if="currentTrack" class="_button" :class="$style.controlButton" :aria-label="i18n.ts._nowPlaying.post" @click="postNowPlaying">
				<i class="ti ti-music"></i>
			</button>
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
		</div>

		<div :class="$style.exTransport">
			<button class="_button" :class="$style.controlButton" :aria-label="loopLabel" @click="cycleLoop">
				<i :class="[audioPlayerState.loop === 'one' ? 'ti ti-repeat-once' : 'ti ti-repeat', { [$style.loopActive]: audioPlayerState.loop !== 'off' }]"></i>
			</button>
			<button class="_button" :class="$style.controlButton" :aria-label="i18n.ts._audioPlayer.previous" @click="prev">
				<i class="ti ti-player-track-prev"></i>
			</button>
			<button class="_button" :class="[$style.controlButton, $style.exPlayButton]" :aria-label="audioPlayerState.playing ? i18n.ts._audioPlayer.pause : i18n.ts._audioPlayer.play" @click="toggle">
				<i v-if="audioPlayerState.playing" class="ti ti-player-pause"></i>
				<i v-else class="ti ti-player-play"></i>
			</button>
			<button class="_button" :class="$style.controlButton" :aria-label="i18n.ts.next" @click="next">
				<i class="ti ti-player-track-next"></i>
			</button>
			<button class="_button" :class="$style.controlButton" :aria-label="audioPlayerState.muted || audioPlayerState.volume === 0 ? i18n.ts.unmute : i18n.ts.mute" @click="toggleMute">
				<i v-if="audioPlayerState.muted || audioPlayerState.volume === 0" class="ti ti-volume-3"></i>
				<i v-else-if="audioPlayerState.volume < 0.5" class="ti ti-volume-2"></i>
				<i v-else class="ti ti-volume"></i>
			</button>
		</div>

		<MkAudioPlayerQueue :class="$style.exQueue"/>
	</template>

	<template v-else>
		<div :class="$style.topRow">
			<button class="_button" :class="$style.artwork" :aria-label="i18n.ts._audioPlayer.queueAndPlaylists" @click="openWindow">
				<img v-if="artworkUrl" :src="artworkUrl" :class="$style.artworkImg" alt=""/>
				<i v-else class="ti ti-music" :class="$style.artworkIcon"></i>
			</button>

			<button class="_button" :class="$style.meta" :aria-label="i18n.ts._audioPlayer.queueAndPlaylists" @click="openWindow">
				<div :class="$style.title" :title="currentTitle">{{ currentTrack ? currentTitle : i18n.ts._audioPlayer.notPlaying }}</div>
				<div v-if="trackUnavailableLabel(currentTrack)" :class="[$style.artist, $style.unavailable]">{{ trackUnavailableLabel(currentTrack) }}</div>
				<div v-else :class="$style.artist" :title="currentArtist">{{ currentArtist }}</div>
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
				<button v-tooltip="i18n.ts._audioPlayer.queueAndPlaylists" class="_button" :class="$style.controlButton" :aria-label="i18n.ts._audioPlayer.queueAndPlaylists" @click="openWindow">
					<i class="ti ti-playlist"></i>
				</button>
				<button class="_button" :class="$style.controlButton" :aria-label="i18n.ts._audioPlayer.close" @click="closeDock">
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

			<button v-tooltip="loopLabel" class="_button" :class="$style.controlButton" :aria-label="loopLabel" @click="cycleLoop">
				<i :class="[audioPlayerState.loop === 'one' ? 'ti ti-repeat-once' : 'ti ti-repeat', { [$style.loopActive]: audioPlayerState.loop !== 'off' }]"></i>
			</button>
		</div>
	</template>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, useTemplateRef, watch, onBeforeUnmount, onMounted } from 'vue';
import { hms } from '@/filters/hms.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import MkMediaRange from '@/components/MkMediaRange.vue';
import MkAudioPlayerQueue from '@/components/MkAudioPlayerQueue.vue';
import {
	audioPlayerState,
	dockShown,
	dockOpenRequest,
	closeDock,
	isYoutubeCurrent,
	currentTrack,
	trackArtworkUrl,
	trackTitle,
	trackArtist,
	trackUnavailableLabel,
	toggle,
	next,
	prev,
	seek,
	setVolume,
	toggleMute,
	cycleLoop,
} from '@/utility/audio-player.js';
import { postNowPlayingForMisskeyTrack } from '@/utility/now-playing.js';
import { openAudioPlayerWindow } from '@/utility/audio-player-window.js';
import { attachYoutubeHost, detachYoutubeHost } from '@/utility/audio-player-youtube.js';
import { schedulePlaylistMaintenance } from '@/utility/audio-playlists.js';
import { deviceKind } from '@/utility/device-kind.js';

defineProps<{
	// スマホ幅でサイドメニュー・ウィジェットのドロワーを開いている間は隠す (プレイヤーの方が前面に来て
	// ドロワーを操作できなくなるため)。v-if だと YouTube プレイヤーが作り直されるので v-show で隠し、再生は続ける
	hidden?: boolean;
}>();

const zIndex = os.claimZIndex('high');

// スマホ幅では画面下部に常駐させると邪魔になるので、全面展開 (プレイヤー + キュー・プレイリスト) と
// 右下の小さなボタンへの収納を切り替える。PC 幅では従来どおりのミニプレイヤー
const MOBILE_THRESHOLD = 500;
const isMobile = ref(deviceKind === 'smartphone' || window.innerWidth <= MOBILE_THRESHOLD);

function onResize() {
	isMobile.value = deviceKind === 'smartphone' || window.innerWidth <= MOBILE_THRESHOLD;
}

const expanded = ref(false);
const mode = computed<'normal' | 'expanded' | 'collapsed'>(() => {
	if (!isMobile.value) return 'normal';
	return expanded.value ? 'expanded' : 'collapsed';
});

function onKeydown(ev: KeyboardEvent) {
	if (ev.key === 'Escape' && mode.value === 'expanded') expanded.value = false;
}

// ナビゲーションから呼び出されたときは、空のキューでも操作できるよう全面展開する
watch(dockOpenRequest, () => {
	expanded.value = true;
});

// キューが空になって閉じたら、次に表示するときは収納状態から始める
watch(dockShown, (shown) => {
	if (!shown) expanded.value = false;
});

// キューが空になるとルート要素ごと消えるので、動画枠の出入りに合わせて YouTube プレイヤーを付け外しする
const youtubeHostEl = useTemplateRef('youtubeHostEl');
watch(youtubeHostEl, (el, oldEl) => {
	if (oldEl != null) detachYoutubeHost(oldEl);
	if (el != null) attachYoutubeHost(el);
}, { immediate: true });

onMounted(() => {
	window.addEventListener('resize', onResize, { passive: true });
	window.addEventListener('keydown', onKeydown);
	// YouTube の曲情報の定期更新 (1 日 1 回、起動からしばらく後に少しずつ)
	schedulePlaylistMaintenance();
});

onBeforeUnmount(() => {
	window.removeEventListener('resize', onResize);
	window.removeEventListener('keydown', onKeydown);
	if (youtubeHostEl.value != null) detachYoutubeHost(youtubeHostEl.value);
});

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

function openWindow() {
	// スマホ幅ではウィンドウを重ねず、全面展開した画面でキュー・プレイリストを見せる
	if (isMobile.value) {
		expanded.value = true;
		return;
	}
	openAudioPlayerWindow();
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

.collapsed {
	left: auto;
	width: auto;
	padding: 6px;
	border-radius: 999px;

	.artwork {
		width: 40px;
		height: 40px;
		border-radius: 999px;
	}
}

.collapsedWithVideo {
	border-radius: 12px;

	.video {
		// YouTube の埋め込みプレイヤーに必要な最小の表示領域
		width: 224px;
		height: 200px;
		aspect-ratio: auto;
		margin-bottom: 0;
	}
}

.collapsedBar {
	display: flex;
	align-items: center;
	gap: 2px;
}

.collapsedProgress {
	position: absolute;
	left: 0;
	bottom: 0;
	height: 2px;
	background: var(--MI_THEME-accent);
	pointer-events: none;
}

// ._panel の overflow: clip より強くするため .root と重ねる (横向きなど高さが足りないときは全体をスクロール)
.root.expanded {
	inset: 0;
	width: auto;
	gap: 10px;
	padding: max(8px, env(safe-area-inset-top)) 14px max(12px, env(safe-area-inset-bottom));
	border-radius: 0;
	overflow-y: auto;
	overscroll-behavior: contain;

	.video {
		flex-shrink: 0;
		// 横向きで動画が画面を埋めて操作ボタンが隠れないよう、高さが 40dvh を超えない幅に抑える
		// (下限は .video の min-height)
		max-width: calc(40dvh * 16 / 9);
		align-self: center;
		margin-bottom: 0;
	}
}

.exHeader {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	gap: 6px;
}

.exHeaderTitle {
	flex: 1;
	min-width: 0;
	text-align: center;
	font-size: 0.9em;
	font-weight: bold;
	opacity: 0.8;
}

.exInfo {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	gap: 12px;
	min-width: 0;
}

.exArtwork {
	flex-shrink: 0;
	width: 64px;
	height: 64px;
	border-radius: 8px;
	overflow: clip;
	display: grid;
	place-items: center;
	background: var(--MI_THEME-buttonBg);
}

.exMeta {
	flex: 1;
	min-width: 0;

	.title {
		font-size: 1em;
	}

	.artist {
		font-size: 0.85em;
	}
}

.exTransport {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	justify-content: space-evenly;
	font-size: 1.2em;

	.controlButton {
		padding: 10px;
		border-radius: 999px;
	}
}

.exPlayButton.controlButton {
	padding: 14px;
	font-size: 1.3em;
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);

	&:hover {
		background: var(--MI_THEME-accent);
		color: var(--MI_THEME-fgOnAccent);
	}
}

.exQueue {
	flex: 1;
	min-height: 240px;
	padding-top: 10px;
	border-top: 1px solid var(--MI_THEME-divider);
}

.video {
	width: 100%;
	aspect-ratio: 16 / 9;
	// YouTube の埋め込みプレイヤーは 200x200px 以上の表示領域が必要
	min-height: 200px;
	margin-bottom: 4px;
	border-radius: 8px;
	overflow: clip;
	background: #000;

	> :global(iframe) {
		display: block;
		width: 100%;
		height: 100%;
		border: none;
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

.unavailable {
	color: var(--MI_THEME-warn);
	opacity: 1;
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
</style>
