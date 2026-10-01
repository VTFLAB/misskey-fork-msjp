<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<div v-if="canUsePlaylists()" :class="$style.tabs" role="tablist">
		<button
			class="_button"
			role="tab"
			:aria-selected="tab === 'queue'"
			:class="[$style.tab, { [$style.tabActive]: tab === 'queue' }]"
			@click="tab = 'queue'"
		>
			<i class="ti ti-list"></i>
			<span>{{ i18n.ts._audioPlayer.queue }}</span>
			<span :class="$style.tabCount">{{ audioPlayerState.queue.length }}</span>
		</button>
		<button
			class="_button"
			role="tab"
			:aria-selected="tab === 'playlists'"
			:class="[$style.tab, { [$style.tabActive]: tab === 'playlists' }]"
			@click="tab = 'playlists'"
		>
			<i class="ti ti-playlist"></i>
			<span>{{ i18n.ts._audioPlayer.playlists }}</span>
			<span v-if="audioPlaylistsState.loaded" :class="$style.tabCount">{{ audioPlaylistsState.list.length }}</span>
		</button>
	</div>

	<MkAudioPlayerPlaylists v-if="tab === 'playlists'"/>

	<template v-else>
		<div :class="$style.toolbar">
			<span :class="$style.toolbarMeta">{{ i18n.tsx._audioPlayer.nTracks({ n: audioPlayerState.queue.length }) }}</span>
			<button class="_button" :class="$style.toolButton" @click="openAddMenu">
				<i class="ti ti-plus"></i>{{ i18n.ts._audioPlayer.add }}
			</button>
			<button v-if="canUsePlaylists()" class="_button" :class="$style.toolButton" :disabled="audioPlayerState.queue.length === 0" @click="saveQueueToPlaylist">
				<i class="ti ti-device-floppy"></i>{{ i18n.ts._audioPlayer.save }}
			</button>
			<button class="_button" :class="$style.toolButton" :disabled="audioPlayerState.queue.length === 0" @click="clear">
				<i class="ti ti-trash"></i>{{ i18n.ts._audioPlayer.clear }}
			</button>
		</div>

		<div :class="$style.queue">
			<div v-if="audioPlayerState.queue.length === 0" :class="$style.queueEmpty">{{ i18n.ts._audioPlayer.emptyQueue }}</div>
			<MkDraggable
				v-else
				v-model="queueItems"
				direction="vertical"
				manualDragStart
			>
				<template #default="{ item, index, dragStart }">
					<div :class="[$style.queueItem, { [$style.queueItemActive]: index === audioPlayerState.index, [$style.queueItemUnplayable]: isUnplayableTrack(item.track) }]">
						<span :class="$style.queueItemHandle" :draggable="true" @dragstart.stop="dragStart"><i class="ti ti-grip-vertical"></i></span>
						<button class="_button" :class="$style.queueItemMain" @click="playAt(index)">
							<img v-if="trackArtworkUrl(item.track)" :src="trackArtworkUrl(item.track) ?? undefined" :class="$style.queueItemArtwork" alt=""/>
							<i v-else class="ti ti-music" :class="$style.queueItemArtworkIcon"></i>
							<div :class="$style.queueItemMeta">
								<div :class="$style.queueItemTitle">{{ trackTitle(item.track) }}</div>
								<div v-if="trackUnavailableLabel(item.track)" :class="$style.unavailableLabel"><i class="ti ti-ban"></i> {{ trackUnavailableLabel(item.track) }}</div>
								<div v-else :class="$style.queueItemArtist">{{ trackArtist(item.track) }}</div>
							</div>
						</button>
						<button class="_button" :class="$style.queueItemButton" :aria-label="i18n.ts.menu" @click="openQueueItemMenu($event, index)">
							<i class="ti ti-dots"></i>
						</button>
						<button class="_button" :class="$style.queueItemButton" :aria-label="i18n.ts._audioPlayer.removeFromQueue" @click="remove(index)">
							<i class="ti ti-x"></i>
						</button>
					</div>
				</template>
			</MkDraggable>
		</div>
	</template>
</div>
</template>

<script lang="ts" setup>
// キュー・プレイリストの一覧 (bsky-fork 独自)。PC ではプレイヤーウィンドウ、スマホ幅では全面展開した
// ミニプレイヤーの下部に表示する
import { computed, ref } from 'vue';
import type { MenuItem } from '@/types/menu.js';
import type { AudioTrack } from '@/utility/audio-player.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import MkDraggable from '@/components/MkDraggable.vue';
import MkAudioPlayerPlaylists from '@/components/MkAudioPlayerPlaylists.vue';
import {
	audioPlayerState,
	trackArtworkUrl,
	trackTitle,
	trackArtist,
	trackNoteId,
	isUnplayableTrack,
	trackUnavailableLabel,
	playAt,
	remove,
	clear,
	reorderQueue,
	moveInQueue,
	enqueue,
} from '@/utility/audio-player.js';
import { audioPlaylistsState, canUsePlaylists, pickPlaylistAndAdd } from '@/utility/audio-playlists.js';
import { promptYoutubeTrack, openYoutubePlaylistImport } from '@/utility/youtube-track.js';

const tab = ref<'queue' | 'playlists'>('queue');

// MkDraggable は要素に一意の id を要求する。キューは同じファイルを重複して積めるので qid を使う
const queueItems = computed<{ id: string; track: AudioTrack }[]>({
	get: () => audioPlayerState.queue.map((track, i) => ({ id: track.qid ?? `${track.id}:${i}`, track })),
	set: (items) => {
		reorderQueue(items.map(x => x.track));
	},
});

function openAddMenu(ev: PointerEvent) {
	os.popupMenu([{
		text: i18n.ts._audioPlayer.addFromYoutube,
		icon: 'ti ti-brand-youtube',
		action: () => addYoutubeToQueue(),
	}, {
		text: i18n.ts._audioPlayer.addFromYoutubePlaylist,
		icon: 'ti ti-playlist-add',
		action: () => openYoutubePlaylistImport(),
	}], (ev.currentTarget ?? ev.target ?? undefined) as HTMLElement | undefined);
}

async function addYoutubeToQueue() {
	const track = await promptYoutubeTrack();
	if (track == null) return;
	enqueue([track]);
}

function saveQueueToPlaylist() {
	pickPlaylistAndAdd([...audioPlayerState.queue]);
}

function openQueueItemMenu(ev: PointerEvent, index: number) {
	const track = audioPlayerState.queue[index];
	if (track == null) return;
	const menu: MenuItem[] = [
		...(index > 0 ? [{
			text: i18n.ts._audioPlayer.moveUp,
			icon: 'ti ti-arrow-up',
			action: () => moveInQueue(index, index - 1),
		}] : []),
		...(index < audioPlayerState.queue.length - 1 ? [{
			text: i18n.ts._audioPlayer.moveDown,
			icon: 'ti ti-arrow-down',
			action: () => moveInQueue(index, index + 1),
		}] : []),
		...(trackNoteId(track) != null ? [{
			type: 'link' as const,
			text: i18n.ts._audioPlayer.openNote,
			icon: 'ti ti-note',
			to: `/notes/${trackNoteId(track)}`,
		}] : []),
		...(canUsePlaylists() ? [{
			text: i18n.ts._audioPlayer.addToPlaylist,
			icon: 'ti ti-playlist-add',
			action: () => pickPlaylistAndAdd([track]),
		}] : []),
		{ type: 'divider' },
		{
			text: i18n.ts._audioPlayer.removeFromQueue,
			icon: 'ti ti-trash',
			danger: true,
			action: () => remove(index),
		},
	];
	os.popupMenu(menu, (ev.currentTarget ?? ev.target ?? undefined) as HTMLElement | undefined);
}
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	height: 100%;
	min-height: 0;
	box-sizing: border-box;
	gap: 10px;
}

.tabs {
	flex-shrink: 0;
	display: flex;
	gap: 4px;
	padding: 4px;
	border-radius: 10px;
	background: var(--MI_THEME-buttonBg);
}

.tab {
	flex: 1;
	min-width: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
	height: 32px;
	border-radius: 7px;
	font-size: 0.9em;
	opacity: 0.75;
	white-space: nowrap;

	&:hover {
		opacity: 1;
	}
}

.tabActive {
	opacity: 1;
	font-weight: bold;
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-accent);
}

.tabCount {
	min-width: 1.6em;
	padding: 0 6px;
	border-radius: 999px;
	font-size: 0.8em;
	font-weight: normal;
	line-height: 1.6;
	background: var(--MI_THEME-accentedBg);
	color: var(--MI_THEME-accent);
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

.queueEmpty {
	padding: 24px 8px;
	text-align: center;
	opacity: 0.7;
	font-size: 0.9em;
}

.queue {
	flex: 1;
	overflow-y: auto;
}

.queueItem {
	display: flex;
	align-items: center;
	gap: 2px;
	border-radius: 6px;

	&:hover {
		background-color: var(--MI_THEME-buttonBg);
	}
}

.queueItemUnplayable .queueItemMain {
	opacity: 0.55;
}

.unavailableLabel {
	font-size: 0.8em;
	color: var(--MI_THEME-warn);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.queueItemActive {
	background-color: var(--MI_THEME-accentedBg);
	color: var(--MI_THEME-accent);
}

.queueItemHandle {
	flex-shrink: 0;
	padding: 6px 2px;
	cursor: grab;
	opacity: 0.5;
}

.queueItemMain {
	flex: 1;
	min-width: 0;
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 4px;
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

.queueItemButton {
	flex-shrink: 0;
	padding: 6px;
	border-radius: 4px;

	&:hover {
		background-color: var(--MI_THEME-accentedBg);
		color: var(--MI_THEME-accent);
	}
}
</style>
