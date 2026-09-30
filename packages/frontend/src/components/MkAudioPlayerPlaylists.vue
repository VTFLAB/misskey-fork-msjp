<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<MkLoading v-if="loading"/>

	<template v-else-if="detail != null">
		<button class="_button" :class="$style.back" @click="closeDetail">
			<i class="ti ti-chevron-left"></i>
			<span :class="$style.backTitle">{{ detail.name }}</span>
		</button>

		<div :class="$style.toolbar">
			<span :class="$style.toolbarMeta">{{ i18n.tsx._audioPlayer.nTracks({ n: detailItems.length }) }}</span>
			<button class="_button" :class="$style.toolButton" :disabled="detailItems.length === 0" @click="playDetail(0)">
				<i class="ti ti-player-play"></i>{{ i18n.ts._audioPlayer.play }}
			</button>
			<button class="_button" :class="$style.toolButton" @click="openDetailAddMenu">
				<i class="ti ti-plus"></i>{{ i18n.ts._audioPlayer.add }}
			</button>
			<button class="_button" :class="$style.toolButton" @click="openDetailMenu">
				<i class="ti ti-dots"></i>{{ i18n.ts._audioPlayer.more }}
			</button>
		</div>

		<div :class="$style.list">
			<div v-if="detailItems.length === 0" :class="$style.empty">{{ i18n.ts._audioPlayer.emptyPlaylist }}</div>
			<MkDraggable
				v-else
				v-model="detailItems"
				direction="vertical"
				manualDragStart
			>
				<template #default="{ item, index, dragStart }">
					<div :class="[$style.item, { [$style.itemUnplayable]: isUnplayableTrack(item.track) }]">
						<span :class="$style.handle" :draggable="true" @dragstart.stop="dragStart"><i class="ti ti-grip-vertical"></i></span>
						<button class="_button" :class="$style.itemMain" @click="playDetail(index)">
							<img v-if="trackArtworkUrl(item.track)" :src="trackArtworkUrl(item.track) ?? undefined" :class="$style.artwork" alt=""/>
							<i v-else class="ti ti-music" :class="$style.artworkIcon"></i>
							<div :class="$style.itemMeta">
								<div :class="$style.itemTitle">{{ trackTitle(item.track) }}</div>
								<div v-if="trackUnavailableLabel(item.track)" :class="$style.unavailableLabel"><i class="ti ti-ban"></i> {{ trackUnavailableLabel(item.track) }}</div>
								<div v-else :class="$style.itemSub">{{ trackArtist(item.track) }}</div>
							</div>
						</button>
						<button class="_button" :class="$style.iconButton" :aria-label="i18n.ts.menu" @click="openTrackMenu($event, index)">
							<i class="ti ti-dots"></i>
						</button>
						<button class="_button" :class="$style.iconButton" :aria-label="i18n.ts._audioPlayer.removeFromPlaylist" @click="removeTrack(index)">
							<i class="ti ti-x"></i>
						</button>
					</div>
				</template>
			</MkDraggable>
		</div>
	</template>

	<template v-else>
		<div :class="$style.toolbar">
			<span :class="$style.toolbarMeta">{{ i18n.tsx._audioPlayer.nPlaylists({ n: audioPlaylistsState.list.length }) }}</span>
			<button class="_button" :class="$style.toolButton" @click="openYoutubePlaylistImport">
				<i class="ti ti-brand-youtube"></i>{{ i18n.ts._audioPlayer.importShort }}
			</button>
			<button class="_button" :class="$style.toolButton" @click="newPlaylist">
				<i class="ti ti-plus"></i>{{ i18n.ts._audioPlayer.create }}
			</button>
		</div>

		<div :class="$style.list">
			<div v-if="audioPlaylistsState.list.length === 0" :class="$style.empty">{{ i18n.ts._audioPlayer.noPlaylists }}</div>
			<MkDraggable
				v-else
				:modelValue="audioPlaylistsState.list"
				direction="vertical"
				manualDragStart
				@update:modelValue="onReorderPlaylists"
			>
				<template #default="{ item, dragStart }">
					<div :class="$style.item">
						<span :class="$style.handle" :draggable="true" @dragstart.stop="dragStart"><i class="ti ti-grip-vertical"></i></span>
						<button class="_button" :class="$style.itemMain" @click="openDetail(item.id)">
							<i class="ti ti-playlist" :class="$style.artworkIcon"></i>
							<div :class="$style.itemMeta">
								<div :class="$style.itemTitle">{{ item.name }}</div>
								<div :class="$style.itemSub">{{ i18n.tsx._audioPlayer.nTracks({ n: item.trackCount }) }}</div>
							</div>
						</button>
						<button v-tooltip="i18n.ts._audioPlayer.playPlaylist" class="_button" :class="$style.iconButton" :aria-label="i18n.ts._audioPlayer.playPlaylist" :disabled="item.trackCount === 0" @click="playPlaylist(item.id)">
							<i class="ti ti-player-play"></i>
						</button>
						<button class="_button" :class="$style.iconButton" :aria-label="i18n.ts.menu" @click="openPlaylistMenu($event, item)">
							<i class="ti ti-dots"></i>
						</button>
					</div>
				</template>
			</MkDraggable>
		</div>
	</template>
</div>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import type { MenuItem } from '@/types/menu.js';
import type { AudioTrack } from '@/utility/audio-player.js';
import type { AudioPlaylist, AudioPlaylistSummary } from '@/utility/audio-playlists.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import MkDraggable from '@/components/MkDraggable.vue';
import { genId } from '@/utility/id.js';
import { promptYoutubeTrack, openYoutubePlaylistImport } from '@/utility/youtube-track.js';
import { audioPlayerState, trackArtworkUrl, trackTitle, trackArtist, trackNoteId, isUnplayableTrack, trackUnavailableLabel, playTracks, enqueue } from '@/utility/audio-player.js';
import {
	audioPlaylistsState,
	fetchPlaylists,
	getPlaylist,
	createPlaylist,
	setPlaylistTracks,
	addTracksToPlaylist,
	renamePlaylist,
	deletePlaylist,
	reorderPlaylists,
	promptPlaylistName,
	refreshPlaylistYoutubeInfo,
	errorMessage,
	PLAYLIST_MAX_TRACKS,
} from '@/utility/audio-playlists.js';

// プレイリスト内では同じ曲が重複しうるので、並べ替え用に表示中だけ有効な一意キーを振る
type DetailItem = { id: string; track: AudioTrack };

const loading = ref(false);
const detail = ref<AudioPlaylist | null>(null);
const detailItemsRaw = ref<DetailItem[]>([]);

const detailItems = computed<DetailItem[]>({
	get: () => detailItemsRaw.value,
	set: (items) => {
		detailItemsRaw.value = items;
		saveDetailTracks();
	},
});

function showError(err: unknown) {
	os.alert({ type: 'error', text: errorMessage(err) });
}

async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
	try {
		return await fn();
	} catch (err) {
		showError(err);
		return undefined;
	}
}

onMounted(async () => {
	loading.value = true;
	await run(fetchPlaylists);
	loading.value = false;
});

async function loadPlaylist(id: string): Promise<AudioPlaylist | null> {
	const playlist = await run(() => getPlaylist(id));
	if (playlist == null) {
		if (playlist === null) os.toast(i18n.ts._audioPlayer.playlistNotFound);
		return null;
	}
	return playlist;
}

async function openDetail(id: string) {
	loading.value = true;
	const playlist = await loadPlaylist(id);
	loading.value = false;
	if (playlist == null) return;
	detail.value = playlist;
	detailItemsRaw.value = playlist.tracks.map(track => ({ id: genId(), track }));
	refreshDetailInBackground(playlist.id);
}

// 表示したプレイリストの古い YouTube の曲情報を裏で取得し直し、終わったら表示に反映する
async function refreshDetailInBackground(id: string) {
	const infos = await refreshPlaylistYoutubeInfo(id).catch(() => null);
	if (infos == null || detail.value?.id !== id) return;
	detailItemsRaw.value = detailItemsRaw.value.map(item => {
		if (item.track.kind !== 'youtube') return item;
		const info = infos.get(item.track.youtube.videoId);
		return info != null ? { ...item, track: { ...item.track, youtube: info } } : item;
	});
}

function closeDetail() {
	detail.value = null;
	detailItemsRaw.value = [];
}

async function saveDetailTracks() {
	const current = detail.value;
	if (current == null) return;
	const saved = await run(() => setPlaylistTracks(current.id, detailItemsRaw.value.map(x => x.track)));
	if (saved === undefined) {
		// 保存に失敗したら画面の並びをサーバー側の内容に戻す
		if (detail.value?.id === current.id) await openDetail(current.id);
		return;
	}
	if (saved != null && detail.value?.id === saved.id) {
		detail.value = { ...detail.value, updatedAt: saved.updatedAt };
	}
}

function playDetail(index: number) {
	const tracks = detailItemsRaw.value.map(x => x.track);
	if (tracks.length === 0) return;
	playTracks(tracks, index);
}

function moveTrack(from: number, to: number) {
	const items = [...detailItemsRaw.value];
	if (to < 0 || to >= items.length) return;
	const [moved] = items.splice(from, 1);
	items.splice(to, 0, moved);
	detailItems.value = items;
}

function removeTrack(index: number) {
	detailItems.value = detailItemsRaw.value.filter((_, i) => i !== index);
}

function openTrackMenu(ev: PointerEvent, index: number) {
	const track = detailItemsRaw.value[index]?.track;
	if (track == null) return;
	const menu: MenuItem[] = [
		{
			text: i18n.ts._audioPlayer.addToQueue,
			icon: 'ti ti-playlist',
			action: () => enqueue([track]),
		},
		...(index > 0 ? [{
			text: i18n.ts._audioPlayer.moveUp,
			icon: 'ti ti-arrow-up',
			action: () => moveTrack(index, index - 1),
		}] : []),
		...(index < detailItemsRaw.value.length - 1 ? [{
			text: i18n.ts._audioPlayer.moveDown,
			icon: 'ti ti-arrow-down',
			action: () => moveTrack(index, index + 1),
		}] : []),
		...(trackNoteId(track) != null ? [{
			type: 'link' as const,
			text: i18n.ts._audioPlayer.openNote,
			icon: 'ti ti-note',
			to: `/notes/${trackNoteId(track)}`,
		}] : []),
		{ type: 'divider' },
		{
			text: i18n.ts._audioPlayer.removeFromPlaylist,
			icon: 'ti ti-trash',
			danger: true,
			action: () => removeTrack(index),
		},
	];
	os.popupMenu(menu, (ev.currentTarget ?? ev.target ?? undefined) as HTMLElement | undefined);
}

function openDetailMenu(ev: PointerEvent) {
	const current = detail.value;
	if (current == null) return;
	os.popupMenu(playlistMenuItems({ id: current.id, name: current.name }), (ev.currentTarget ?? ev.target ?? undefined) as HTMLElement | undefined);
}

function openDetailAddMenu(ev: PointerEvent) {
	os.popupMenu([{
		text: i18n.ts._audioPlayer.addFromYoutube,
		icon: 'ti ti-brand-youtube',
		action: () => addYoutubeToDetail(),
	}, ...(audioPlayerState.queue.length > 0 && detail.value != null ? [{
		text: i18n.ts._audioPlayer.addQueueToPlaylist,
		icon: 'ti ti-playlist-add',
		action: () => { if (detail.value != null) addQueueToPlaylist(detail.value.id); },
	}] : [])], (ev.currentTarget ?? ev.target ?? undefined) as HTMLElement | undefined);
}

async function addYoutubeToDetail() {
	const track = await promptYoutubeTrack();
	if (track == null || detail.value == null) return;
	if (detailItemsRaw.value.length >= PLAYLIST_MAX_TRACKS) {
		os.toast(i18n.tsx._audioPlayer.playlistFull({ max: PLAYLIST_MAX_TRACKS }));
		return;
	}
	detailItems.value = [...detailItemsRaw.value, { id: genId(), track }];
}

async function playPlaylist(id: string) {
	const playlist = await loadPlaylist(id);
	if (playlist == null || playlist.tracks.length === 0) return;
	playTracks(playlist.tracks, 0);
	// 再生はすぐ始め、古い曲情報の取得し直しは裏で行う (結果はキューにも反映される)
	refreshPlaylistYoutubeInfo(id).catch(() => {});
}

async function enqueuePlaylist(id: string) {
	const playlist = await loadPlaylist(id);
	if (playlist == null || playlist.tracks.length === 0) return;
	enqueue(playlist.tracks);
	refreshPlaylistYoutubeInfo(id).catch(() => {});
}

async function addQueueToPlaylist(id: string) {
	const queue = audioPlayerState.queue;
	if (queue.length === 0) return;
	const added = await run(() => addTracksToPlaylist(id, queue));
	if (added == null) return;
	os.toast(added < queue.length
		? i18n.tsx._audioPlayer.playlistFull({ max: PLAYLIST_MAX_TRACKS })
		: i18n.ts._audioPlayer.addedToPlaylist);
	if (detail.value?.id === id) await openDetail(id);
}

async function rename(id: string, currentName: string) {
	const name = await promptPlaylistName(currentName);
	if (name == null || name === currentName) return;
	await run(() => renamePlaylist(id, name));
	if (detail.value?.id === id) detail.value = { ...detail.value, name };
}

async function remove(id: string, name: string) {
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.tsx._audioPlayer.deletePlaylistConfirm({ name }),
	});
	if (canceled) return;
	await run(() => deletePlaylist(id));
	if (detail.value?.id === id) closeDetail();
}

function playlistMenuItems(playlist: Pick<AudioPlaylistSummary, 'id' | 'name'>): MenuItem[] {
	return [
		{
			text: i18n.ts._audioPlayer.playPlaylist,
			icon: 'ti ti-player-play',
			action: () => playPlaylist(playlist.id),
		},
		{
			text: i18n.ts._audioPlayer.addToQueue,
			icon: 'ti ti-playlist',
			action: () => enqueuePlaylist(playlist.id),
		},
		...(audioPlayerState.queue.length > 0 ? [{
			text: i18n.ts._audioPlayer.addQueueToPlaylist,
			icon: 'ti ti-playlist-add',
			action: () => addQueueToPlaylist(playlist.id),
		}] : []),
		{
			text: i18n.ts.rename,
			icon: 'ti ti-pencil',
			action: () => rename(playlist.id, playlist.name),
		},
		{ type: 'divider' },
		{
			text: i18n.ts._audioPlayer.deletePlaylist,
			icon: 'ti ti-trash',
			danger: true,
			action: () => remove(playlist.id, playlist.name),
		},
	];
}

function openPlaylistMenu(ev: PointerEvent, playlist: AudioPlaylistSummary) {
	os.popupMenu(playlistMenuItems(playlist), (ev.currentTarget ?? ev.target ?? undefined) as HTMLElement | undefined);
}

async function newPlaylist() {
	const name = await promptPlaylistName();
	if (name == null) return;
	await run(() => createPlaylist(name));
}

async function onReorderPlaylists(list: AudioPlaylistSummary[]) {
	// 保存完了を待たずに並びを反映し、失敗したら元に戻す
	const prev = audioPlaylistsState.list;
	audioPlaylistsState.list = list;
	try {
		await reorderPlaylists(list.map(x => x.id));
	} catch (err) {
		audioPlaylistsState.list = prev;
		showError(err);
	}
}
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	min-height: 0;
	flex: 1;
	gap: 10px;
}

.back {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	gap: 4px;
	min-width: 0;
	padding: 4px 6px 4px 2px;
	border-radius: 6px;
	font-weight: bold;
	text-align: left;

	&:hover {
		background: var(--MI_THEME-buttonBg);
	}
}

.backTitle {
	min-width: 0;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.toolbar {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
}

.toolbarMeta {
	flex: 1;
	min-width: 0;
	font-size: 0.85em;
	opacity: 0.7;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.toolButton {
	flex-shrink: 0;
	display: inline-flex;
	align-items: center;
	gap: 4px;
	height: 28px;
	padding: 0 10px;
	border-radius: 999px;
	font-size: 0.85em;
	white-space: nowrap;
	background: var(--MI_THEME-buttonBg);

	&:hover:not(:disabled) {
		background: var(--MI_THEME-buttonHoverBg);
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
}

.list {
	flex: 1;
	overflow-y: auto;
}

.empty {
	padding: 24px 8px;
	text-align: center;
	opacity: 0.7;
	font-size: 0.9em;
}

.item {
	display: flex;
	align-items: center;
	gap: 2px;
	border-radius: 6px;

	&:hover {
		background-color: var(--MI_THEME-buttonBg);
	}
}

.itemUnplayable .itemMain {
	opacity: 0.55;
}

.unavailableLabel {
	font-size: 0.8em;
	color: var(--MI_THEME-warn);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.handle {
	flex-shrink: 0;
	padding: 6px 2px;
	cursor: grab;
	opacity: 0.5;
}

.itemMain {
	flex: 1;
	min-width: 0;
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 4px;
	text-align: left;
}

.artwork {
	width: 36px;
	height: 36px;
	border-radius: 4px;
	object-fit: cover;
	flex-shrink: 0;
}

.artworkIcon {
	width: 36px;
	height: 36px;
	flex-shrink: 0;
	display: grid;
	place-items: center;
	opacity: 0.7;
	background: var(--MI_THEME-buttonBg);
	border-radius: 4px;
}

.itemMeta {
	min-width: 0;
}

.itemTitle {
	font-size: 0.9em;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.itemSub {
	font-size: 0.8em;
	opacity: 0.7;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.iconButton {
	flex-shrink: 0;
	padding: 6px;
	border-radius: 4px;

	&:hover {
		background-color: var(--MI_THEME-accentedBg);
		color: var(--MI_THEME-accent);
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
}
</style>
