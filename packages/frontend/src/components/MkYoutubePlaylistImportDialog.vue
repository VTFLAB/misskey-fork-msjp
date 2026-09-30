<!--
SPDX-FileCopyrightText: misskey-bsky-integration fork
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="440"
	:height="620"
	:withOkButton="false"
	@close="close()"
	@closed="emit('closed')"
>
	<template #header>
		<i class="ti ti-brand-youtube" style="margin-right: 6px;"></i>{{ i18n.ts._audioPlayer.importYoutubePlaylist }}
	</template>

	<div class="_spacer" style="--MI_SPACER-min: 16px; --MI_SPACER-max: 20px;">
		<div class="_gaps_m">
			<div :class="$style.urlRow">
				<MkInput v-model="sourceUrl" :class="$style.urlInput" type="url" :placeholder="i18n.ts._audioPlayer.youtubePlaylistUrlPlaceholder" :disabled="busy">
					<template #prefix><i class="ti ti-link"></i></template>
				</MkInput>
				<MkButton :disabled="!sourceUrl || busy" @click="load">{{ i18n.ts._audioPlayer.load }}</MkButton>
			</div>

			<MkInfo v-if="errorMessage" warn>{{ errorMessage }}</MkInfo>

			<!-- プレイリストの読み取りには YouTube の埋め込みプレイヤーを使う (規約上、プレイヤーは表示しておく)。
			中身は YT.Player が iframe に置き換えるので、この要素の子にはバインディングを持たせない -->
			<div v-show="playerShown" ref="playerHostEl" :class="$style.player"></div>

			<div v-if="phase === 'reading'" :class="$style.status"><MkLoading :em="true"/> {{ i18n.ts._audioPlayer.readingPlaylist }}</div>
			<div v-else-if="phase === 'fetching'" :class="$style.status">
				<MkLoading :em="true"/> {{ i18n.tsx._audioPlayer.fetchingTrackInfo({ done: fetchedCount, total: videoIds.length }) }}
			</div>

			<template v-if="phase === 'ready'">
				<div :class="$style.summary">
					<div>{{ i18n.tsx._audioPlayer.nTracks({ n: tracks.length }) }}</div>
					<div v-if="unplayableCount > 0" :class="$style.summaryWarn">
						<i class="ti ti-ban"></i> {{ i18n.tsx._audioPlayer.includesUnplayable({ n: unplayableCount }) }}
					</div>
					<div v-if="truncated" :class="$style.summaryWarn">
						<i class="ti ti-alert-triangle"></i> {{ i18n.tsx._audioPlayer.importTruncated({ max: EMBED_PLAYLIST_LIMIT }) }}
					</div>
				</div>

				<MkInput v-if="canUsePlaylists()" v-model="playlistName">
					<template #label>{{ i18n.ts._audioPlayer.playlistName }}</template>
				</MkInput>

				<div :class="$style.actions">
					<MkButton v-if="canUsePlaylists()" primary :disabled="saving || playlistName.trim() === ''" @click="saveAsPlaylist">
						<i class="ti ti-device-floppy"></i> {{ i18n.ts._audioPlayer.saveAsPlaylist }}
					</MkButton>
					<MkButton :disabled="saving" @click="addToQueue">
						<i class="ti ti-playlist"></i> {{ i18n.ts._audioPlayer.addToQueue }}
					</MkButton>
				</div>
			</template>

			<div :class="$style.note">{{ i18n.ts._audioPlayer.importYoutubePlaylistNote }}</div>
		</div>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, ref, useTemplateRef } from 'vue';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkInput from '@/components/MkInput.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import { createYoutubeTrack, enqueue, isUnplayableTrack } from '@/utility/audio-player.js';
import type { AudioTrack } from '@/utility/audio-player.js';
import { canUsePlaylists, createPlaylist, errorMessage as toErrorMessage, PLAYLIST_MAX_TRACKS, PLAYLIST_NAME_MAX_LENGTH } from '@/utility/audio-playlists.js';
import { extractYoutubePlaylistId, loadYoutubeIframeApi, YT_STATE } from '@/utility/youtube-iframe-api.js';
import type { YTPlayer } from '@/utility/youtube-iframe-api.js';
import { lookupYoutubeVideos } from '@/utility/youtube-metadata.js';

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

// 埋め込みプレイヤーがプレイリストを読み込むのを待つ上限
const READ_TIMEOUT_MS = 20 * 1000;
// 埋め込みプレイヤーの getPlaylist が返すのは先頭 200 件まで (実測。開始位置 index や開始動画を
// ずらしても同じ 200 件が返り、続きは取れない)。ちょうどこの件数なら続きがある可能性が高いので知らせる
const EMBED_PLAYLIST_LIMIT = 200;

const dialog = useTemplateRef('dialog');
const playerHostEl = useTemplateRef('playerHostEl');

const sourceUrl = ref('');
const errorMessage = ref<string | null>(null);
const phase = ref<'idle' | 'reading' | 'fetching' | 'ready'>('idle');
const playerShown = ref(false);
const videoIds = ref<string[]>([]);
const fetchedCount = ref(0);
const tracks = ref<AudioTrack[]>([]);
const truncated = ref(false);
const playlistName = ref('');
const saving = ref(false);

const busy = computed(() => phase.value === 'reading' || phase.value === 'fetching');
const unplayableCount = computed(() => tracks.value.filter(isUnplayableTrack).length);

let player: YTPlayer | null = null;
let playerReady: Promise<YTPlayer> | null = null;
let disposed = false;
// 読み込み中にプレイヤーが返したエラー (存在しない・非公開のリスト、先頭の動画が埋め込み不可など)
let playerError: number | null = null;

function ensurePlayer(): Promise<YTPlayer> {
	if (playerReady != null) return playerReady;
	playerReady = (async () => {
		const YT = await loadYoutubeIframeApi();
		const host = playerHostEl.value;
		if (host == null || disposed) throw new Error('disposed');
		const target = window.document.createElement('div');
		host.replaceChildren(target);
		return await new Promise<YTPlayer>((resolve) => {
			const created: YTPlayer = new YT.Player(target, {
				width: '100%',
				height: '100%',
				playerVars: { rel: 0, playsinline: 1, iv_load_policy: 3 },
				events: {
					onReady: () => resolve(created),
					onError: (ev) => {
						playerError = ev.data;
					},
				},
			});
			player = created;
		});
	})();
	playerReady.catch(() => {
		playerReady = null;
	});
	return playerReady;
}

// 埋め込みプレイヤーにプレイリストを読み込ませ、動画 ID の一覧を取り出す (IFrame Player API の getPlaylist)
async function readPlaylist(listId: string): Promise<string[]> {
	const p = await ensurePlayer();
	playerError = null;
	p.cuePlaylist({ list: listId, listType: 'playlist' });
	const startedAt = Date.now();
	while (Date.now() - startedAt < READ_TIMEOUT_MS) {
		await new Promise(resolve => window.setTimeout(resolve, 500));
		if (disposed) throw new Error('disposed');
		if (playerError != null) break;
		const ids = p.getPlaylist();
		if (Array.isArray(ids) && ids.length > 0 && p.getPlayerState() === YT_STATE.CUED) return ids;
	}
	const ids = p.getPlaylist();
	if (Array.isArray(ids) && ids.length > 0) return ids;
	throw new Error(i18n.ts._audioPlayer.playlistReadFailed);
}

async function load() {
	errorMessage.value = null;
	const parsed = extractYoutubePlaylistId(sourceUrl.value);
	if (parsed == null) {
		errorMessage.value = i18n.ts._audioPlayer.invalidYoutubePlaylistUrl;
		return;
	}
	if ('error' in parsed) {
		errorMessage.value = i18n.ts._audioPlayer.youtubeMixNotSupported;
		return;
	}

	phase.value = 'reading';
	playerShown.value = true;
	tracks.value = [];
	try {
		const allIds = await readPlaylist(parsed.id);
		truncated.value = allIds.length >= EMBED_PLAYLIST_LIMIT;
		videoIds.value = allIds.slice(0, Math.min(EMBED_PLAYLIST_LIMIT, PLAYLIST_MAX_TRACKS)).filter(id => /^[A-Za-z0-9_-]{11}$/.test(id));

		phase.value = 'fetching';
		fetchedCount.value = 0;
		const service = parsed.isMusic ? 'youtubeMusic' as const : 'youtube' as const;
		const now = Date.now();
		const lookup = $i != null
			? await lookupYoutubeVideos(videoIds.value, { playlistId: parsed.id, onProgress: done => { fetchedCount.value = done; } })
			: { videos: new Map(), playlistTitle: null };

		tracks.value = videoIds.value.map(videoId => {
			const info = lookup.videos.get(videoId);
			const known = info != null && info.status !== 'error';
			return createYoutubeTrack({
				videoId,
				title: info?.title ?? `YouTube (${videoId})`,
				author: info?.author ?? null,
				thumbnailUrl: info?.thumbnailUrl ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
				url: parsed.isMusic ? `https://music.youtube.com/watch?v=${videoId}` : `https://www.youtube.com/watch?v=${videoId}`,
				service,
				fetchedAt: known ? now : undefined,
				unavailable: info?.status === 'removed' || info?.status === 'private' ? info.status : null,
			});
		});
		playlistName.value = (lookup.playlistTitle ?? '').slice(0, PLAYLIST_NAME_MAX_LENGTH);
		phase.value = 'ready';
	} catch (err) {
		if (disposed) return;
		phase.value = 'idle';
		errorMessage.value = toErrorMessage(err);
	}
}

async function saveAsPlaylist() {
	const name = playlistName.value.trim();
	if (name === '' || tracks.value.length === 0) return;
	saving.value = true;
	try {
		await createPlaylist(name, tracks.value);
		os.toast(i18n.ts._audioPlayer.addedToPlaylist);
		close();
	} catch (err) {
		os.alert({ type: 'error', text: toErrorMessage(err) });
	} finally {
		saving.value = false;
	}
}

function addToQueue() {
	if (tracks.value.length === 0) return;
	enqueue(tracks.value);
	close();
}

function close() {
	dialog.value?.close();
}

onBeforeUnmount(() => {
	disposed = true;
	try {
		player?.destroy();
	} catch {
		// ignore
	}
	player = null;
});
</script>

<style lang="scss" module>
.urlRow {
	display: flex;
	gap: 8px;
	align-items: flex-end;
}

.urlInput {
	flex: 1;
	min-width: 0;
}

.player {
	width: 100%;
	aspect-ratio: 16 / 9;
	// YouTube の埋め込みプレイヤーは 200x200px 以上の表示領域が必要
	min-height: 200px;
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

.status {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 0.9em;
	opacity: 0.8;
}

.summary {
	display: flex;
	flex-direction: column;
	gap: 4px;
	font-weight: bold;
}

.summaryWarn {
	font-weight: normal;
	font-size: 0.9em;
	color: var(--MI_THEME-warn);
}

.actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.note {
	font-size: 0.8em;
	opacity: 0.7;
}
</style>
