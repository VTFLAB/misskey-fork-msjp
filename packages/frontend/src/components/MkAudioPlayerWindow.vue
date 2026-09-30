<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkWindow
	ref="windowEl"
	:initialWidth="400"
	:initialHeight="480"
	:canResize="true"
	@closed="emit('closed')"
>
	<template #header>
		<i class="ti ti-playlist" style="margin-right: 6px;"></i>{{ i18n.ts._audioPlayer.queueAndPlaylists }}
	</template>

	<div :class="$style.root">
		<MkTab
			v-if="canUsePlaylists()"
			v-model="tab"
			:tabs="[
				{ key: 'queue', label: i18n.ts._audioPlayer.queue, icon: 'ti ti-list' },
				{ key: 'playlists', label: i18n.ts._audioPlayer.playlists, icon: 'ti ti-playlist' },
			]"
			:class="$style.tabs"
		/>

		<MkAudioPlayerPlaylists v-if="tab === 'playlists'"/>

		<template v-else>
			<div :class="$style.queueHeader">
				<span :class="$style.queueTitle"><i class="ti ti-list"></i> {{ i18n.ts._audioPlayer.queue }} ({{ audioPlayerState.queue.length }})</span>
				<button v-tooltip="i18n.ts._audioPlayer.addFromYoutube" class="_button" :class="$style.queueItemButton" :aria-label="i18n.ts._audioPlayer.addFromYoutube" @click="addYoutubeToQueue">
					<i class="ti ti-brand-youtube"></i>
				</button>
				<button v-if="canUsePlaylists()" class="_textButton" :disabled="audioPlayerState.queue.length === 0" @click="saveQueueToPlaylist">{{ i18n.ts._audioPlayer.saveQueueToPlaylist }}</button>
				<button class="_textButton" :disabled="audioPlayerState.queue.length === 0" @click="clear">{{ i18n.ts._audioPlayer.clearQueue }}</button>
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
						<div :class="[$style.queueItem, { [$style.queueItemActive]: index === audioPlayerState.index }]">
							<span :class="$style.queueItemHandle" :draggable="true" @dragstart.stop="dragStart"><i class="ti ti-grip-vertical"></i></span>
							<button class="_button" :class="$style.queueItemMain" @click="playAt(index)">
								<img v-if="trackArtworkUrl(item.track)" :src="trackArtworkUrl(item.track) ?? undefined" :class="$style.queueItemArtwork" alt=""/>
								<i v-else class="ti ti-music" :class="$style.queueItemArtworkIcon"></i>
								<div :class="$style.queueItemMeta">
									<div :class="$style.queueItemTitle">{{ trackTitle(item.track) }}</div>
									<div :class="$style.queueItemArtist">{{ trackArtist(item.track) }}</div>
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
</MkWindow>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue';
import type { MenuItem } from '@/types/menu.js';
import type { AudioTrack } from '@/utility/audio-player.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import MkWindow from '@/components/MkWindow.vue';
import MkTab from '@/components/MkTab.vue';
import MkDraggable from '@/components/MkDraggable.vue';
import MkAudioPlayerPlaylists from '@/components/MkAudioPlayerPlaylists.vue';
import {
	audioPlayerState,
	trackArtworkUrl,
	trackTitle,
	trackArtist,
	trackNoteId,
	playAt,
	remove,
	clear,
	reorderQueue,
	moveInQueue,
	enqueue,
} from '@/utility/audio-player.js';
import { canUsePlaylists, pickPlaylistAndAdd } from '@/utility/audio-playlists.js';
import { promptYoutubeTrack } from '@/utility/youtube-track.js';

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const tab = ref<'queue' | 'playlists'>('queue');

// MkDraggable は要素に一意の id を要求する。キューは同じファイルを重複して積めるので qid を使う
const queueItems = computed<{ id: string; track: AudioTrack }[]>({
	get: () => audioPlayerState.queue.map((track, i) => ({ id: track.qid ?? `${track.id}:${i}`, track })),
	set: (items) => {
		reorderQueue(items.map(x => x.track));
	},
});

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
	padding: 16px;
	box-sizing: border-box;
	gap: 12px;
}

.tabs {
	flex-shrink: 0;
}

.queueHeader {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	gap: 12px;
}

.queueTitle {
	flex: 1;
	min-width: 0;
	font-weight: bold;
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
