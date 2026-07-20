<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<div :class="$style.banner" :style="{ backgroundImage: bannerUrl ? `url(${ bannerUrl })` : '' }">
		<div v-if="bannerUrl" :class="$style.fade"></div>
	</div>
	<div :class="$style.header">
		<div :class="$style.avatarWrap">
			<MkAvatar :class="[$style.avatar, { [$style.avatarLive]: isLive }]" :user="user" link indicator/>
			<div v-if="isLive" :class="$style.liveBadge">{{ i18n.ts._liveChannel.liveNow }}</div>
		</div>
		<div :class="$style.names">
			<div :class="$style.channelName">{{ channel.name ?? user.name ?? user.username }}</div>
			<div :class="$style.acct"><MkAcct :user="user" :detail="true"/></div>
		</div>
		<div :class="$style.actions">
			<MkButton v-if="isOwner" type="routerLink" :to="`/settings/streaming`" link rounded primary>{{ i18n.ts._liveChannel.editChannel }}</MkButton>
			<MkButton v-if="isLive" type="routerLink" :to="`/live/${acct}/stream`" link rounded primary>{{ i18n.ts._liveChannel.watchStream }}</MkButton>
			<MkButton v-else-if="isOwner" type="routerLink" :to="`/live/${acct}/stream`" link rounded>{{ i18n.ts._liveChannel.previewStream }}</MkButton>
			<MkFollowButton v-if="$i != null && $i.id !== user.id" v-model:user="user" :full="true"/>
		</div>
	</div>
	<div v-if="channel.description" :class="$style.description" class="_selectable">
		<Mfm :text="channel.description" :isNote="false" :author="user" :plain="true"/>
	</div>

	<MkTab v-model="tab" :tabs="[
		{ key: 'home', label: i18n.ts._liveChannel.home, icon: 'ti ti-home' },
		{ key: 'posts', label: i18n.ts._liveChannel.posts, icon: 'ti ti-pencil' },
		{ key: 'media', label: i18n.ts._liveChannel.media, icon: 'ti ti-photo' },
	]" :class="$style.tab"/>

	<div :class="$style.tabContent">
		<div v-if="tab === 'home'">
			<template v-if="archives.length === 0">
				<div :class="$style.placeholder">
					<i class="ti ti-live-photo"></i>
					<div>{{ i18n.ts._liveChannel.noStreamHistory }}</div>
				</div>
				<MkInfo v-if="isOwner && googleDriveLinked === false">
					{{ i18n.ts._liveChannel.connectGoogleDriveHint }}
					<MkA to="/settings/streaming" :class="$style.hintLink">{{ i18n.ts._liveChannel.goToStreamingSettings }}</MkA>
				</MkInfo>
			</template>

			<div v-else :class="$style.archiveGrid">
				<div v-for="a in archives" :key="a.streamId" :class="$style.archiveCard">
					<button
						v-if="a.recordingStatus === 'ready' && a.recordingGoogleDriveFileId != null"
						class="_button"
						:class="$style.archiveCardHeader"
						:aria-expanded="selectedArchiveId === a.streamId"
						@click="toggleArchive(a.streamId)"
					>
						<div :class="$style.archiveThumb" :style="a.recordingGoogleDriveThumbnailLink ? { backgroundImage: `url(${a.recordingGoogleDriveThumbnailLink})` } : {}">
							<i v-if="!a.recordingGoogleDriveThumbnailLink" class="ti ti-movie"></i>
							<i v-if="selectedArchiveId !== a.streamId" class="ti ti-player-play" :class="$style.archivePlayIcon"></i>
						</div>
						<div :class="$style.archiveInfo">
							<div v-if="a.title" :class="$style.archiveTitle">{{ a.title }}</div>
							<MkTime :time="a.endedAt" mode="detail"/>
							<div v-if="archiveDuration(a) != null" :class="$style.archiveDuration">{{ archiveDuration(a) }}</div>
						</div>
					</button>

					<div v-else :class="[$style.archiveCardHeader, $style.archiveCardHeaderStatic]">
						<div :class="$style.archiveThumb">
							<i class="ti ti-movie"></i>
						</div>
						<div :class="$style.archiveInfo">
							<div v-if="a.title" :class="$style.archiveTitle">{{ a.title }}</div>
							<MkTime :time="a.endedAt" mode="detail"/>
							<div v-if="archiveDuration(a) != null" :class="$style.archiveDuration">{{ archiveDuration(a) }}</div>
							<div v-if="a.recordingStatus === 'failed'" :class="[$style.archiveBadge, $style.archiveBadgeFailed]">
								{{ i18n.ts._liveChannel.archiveFailed }}
							</div>
							<div v-else :class="$style.archiveBadge">
								<MkLoading em :class="$style.archiveBadgeSpinner"/>
								{{ i18n.ts._liveChannel.archiveProcessing }}
							</div>
							<div v-if="a.recordingStatus === 'failed' && isOwner && a.recordingError" :class="$style.caption">{{ a.recordingError }}</div>
						</div>
					</div>

					<div v-if="selectedArchiveId === a.streamId && a.recordingGoogleDriveFileId != null" :class="$style.archivePlayer">
						<button class="_button" :class="$style.archiveCloseButton" :aria-label="i18n.ts.close" @click="toggleArchive(a.streamId)">
							<i class="ti ti-x"></i>
						</button>
						<iframe
							:src="`https://drive.google.com/file/d/${a.recordingGoogleDriveFileId}/preview`"
							:class="$style.archiveIframe"
							allow="autoplay; fullscreen"
							allowfullscreen
						></iframe>
					</div>
				</div>
			</div>
		</div>

		<div v-else-if="tab === 'posts'">
			<div v-if="channelId == null" :class="$style.placeholder">
				<i class="ti ti-pencil-off"></i>
				<div>{{ i18n.ts._liveChannel.initializingChannel }}</div>
				<MkButton rounded primary @click="reload">
					<i class="ti ti-refresh"></i> {{ i18n.ts.retry }}
				</MkButton>
			</div>
			<template v-else>
				<div :class="$style.postFormArea" class="_buttonsCenter">
					<MkButton inline rounded primary gradate @click="openPostForm">
						<i class="ti ti-pencil"></i> {{ i18n.ts._liveChannel.postToChannel }}
					</MkButton>
				</div>
				<MkStreamingNotesTimeline :key="channelId" src="channel" :channel="channelId"/>
			</template>
		</div>

		<div v-else-if="tab === 'media'">
			<div v-if="channelId == null" :class="$style.placeholder">
				<i class="ti ti-pencil-off"></i>
				<div>{{ i18n.ts._liveChannel.initializingChannel }}</div>
				<MkButton rounded primary @click="reload">
					<i class="ti ti-refresh"></i> {{ i18n.ts.retry }}
				</MkButton>
			</div>
			<div v-else :class="$style.mediaRoot">
				<MkLoading v-if="mediaFetching"/>
				<div v-else-if="mediaNotes.length === 0" :class="$style.placeholder">
					<i class="ti ti-photo-off"></i>
					<div>{{ i18n.ts.nothing }}</div>
				</div>
				<div v-else :class="$style.mediaGrid">
					<template v-for="note in mediaNotes" :key="note.id">
						<MkA
							v-for="file in note.files"
							:key="`${note.id}:${file.id}`"
							:class="$style.mediaCell"
							:to="notePage(note)"
							:data-scroll-anchor="`${note.id}:${file.id}`"
						>
							<MkMediaImage
								v-if="file.type.startsWith('image')"
								:image="file"
								disableImageLink
								cover
								controls
								:class="$style.mediaImage"
							/>
							<MkDriveFileThumbnail
								v-else
								:file="file"
								fit="cover"
								:highlightWhenSensitive="prefer.s.highlightSensitiveMedia"
								:large="true"
								:class="$style.mediaThumb"
							/>
						</MkA>
					</template>
				</div>
			</div>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import MkAvatar from '@/components/global/MkAvatar.vue';
import MkAcct from '@/components/global/MkAcct.vue';
import MkButton from '@/components/MkButton.vue';
import MkFollowButton from '@/components/MkFollowButton.vue';
import MkStreamingNotesTimeline from '@/components/MkStreamingNotesTimeline.vue';
import MkTab from '@/components/MkTab.vue';
import MkMediaImage from '@/components/MkMediaImage.vue';
import MkDriveFileThumbnail from '@/components/MkDriveFileThumbnail.vue';
import MkA from '@/components/global/MkA.vue';
import MkLoading from '@/components/global/MkLoading.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkTime from '@/components/global/MkTime.vue';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { notePage } from '@/filters/note.js';
import { prefer } from '@/preferences.js';

type StreamSession = Misskey.Endpoints['twitch/streams/show']['res']['sessions'][number];

const props = withDefaults(defineProps<{
	user: Misskey.entities.UserDetailed;
	channel: Misskey.Endpoints['live-channels/show']['res'];
	isOwner: boolean;
	isLive: boolean;
	acct: string;
	sessions?: StreamSession[];
}>(), {
	sessions: () => [],
});

const user = ref(props.user);
const tab = ref<'home' | 'posts' | 'media'>('home');
const mediaFetching = ref(false);
const mediaNotes = ref<Misskey.entities.Note[]>([]);
const misskeyChannel = ref<Misskey.entities.Channel | null>(null);

const channelId = computed<string | null>(() => props.channel.channelId ?? null);

const bannerUrl = computed(() => {
	if (props.channel.bannerUrl != null) return props.channel.bannerUrl;
	return props.user.bannerUrl;
});

// 配信アーカイブ (Google Drive、bsky-fork 独自)
const PENDING_RECORDING_STATUSES = ['pending', 'remuxing', 'uploading', 'processing'] as const;
const ARCHIVE_POLL_INTERVAL_MS = 30 * 1000;

const selectedArchiveId = ref<string | null>(null);
const googleDriveLinked = ref<boolean | null>(null);
// google-drive/recording-status のポーリング結果でローカル上書きする分 (親の sessions 再取得を待たずに反映する)
const statusOverrides = ref<Record<string, { recordingStatus: string; recordingGoogleDriveFileId: string | null }>>({});
const pollTimers = new Map<string, number>();

const archives = computed(() => {
	return props.sessions
		.filter((s): s is StreamSession & { endedAt: string; recordingStatus: NonNullable<StreamSession['recordingStatus']> } =>
			s.source === 'ome' && !s.isLive && s.endedAt != null && s.recordingStatus != null && s.recordingStatus !== 'none')
		.map(s => {
			const override = statusOverrides.value[s.streamId];
			return {
				...s,
				recordingStatus: override?.recordingStatus ?? s.recordingStatus,
				recordingGoogleDriveFileId: override?.recordingGoogleDriveFileId ?? s.recordingGoogleDriveFileId,
			};
		});
});

function archiveDuration(a: { startedAt?: string | null; endedAt: string }): string | null {
	if (a.startedAt == null) return null;
	const ms = new Date(a.endedAt).getTime() - new Date(a.startedAt).getTime();
	if (!Number.isFinite(ms) || ms < 0) return null;
	const totalSec = Math.floor(ms / 1000);
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	const pad = (n: number) => String(n).padStart(2, '0');
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function toggleArchive(streamId: string) {
	selectedArchiveId.value = selectedArchiveId.value === streamId ? null : streamId;
}

function clearArchivePoll(streamId: string) {
	const timer = pollTimers.get(streamId);
	if (timer != null) {
		window.clearTimeout(timer);
		pollTimers.delete(streamId);
	}
}

function scheduleArchivePoll(streamId: string) {
	if (pollTimers.has(streamId)) return;
	const timer = window.setTimeout(async () => {
		pollTimers.delete(streamId);
		try {
			const res = await misskeyApi('google-drive/recording-status', { streamId });
			statusOverrides.value = { ...statusOverrides.value, [streamId]: res };
			if (PENDING_RECORDING_STATUSES.includes(res.recordingStatus as typeof PENDING_RECORDING_STATUSES[number])) {
				scheduleArchivePoll(streamId);
			}
		} catch {
			// 一時的な失敗は次回のマウント時の再ポーリングに任せる (このセッションでは打ち切り)
		}
	}, ARCHIVE_POLL_INTERVAL_MS);
	pollTimers.set(streamId, timer);
}

watch(archives, (list) => {
	for (const a of list) {
		if (PENDING_RECORDING_STATUSES.includes(a.recordingStatus as typeof PENDING_RECORDING_STATUSES[number])) {
			scheduleArchivePoll(a.streamId);
		} else {
			clearArchivePoll(a.streamId);
		}
	}
}, { immediate: true });

async function fetchGoogleDriveLinked() {
	if (!props.isOwner) return;
	try {
		const res = await misskeyApi('google-drive/my-account', {});
		googleDriveLinked.value = res.linked;
	} catch {
		googleDriveLinked.value = null;
	}
}

onMounted(fetchGoogleDriveLinked);
watch(() => props.isOwner, fetchGoogleDriveLinked);

function clearAllArchivePolls() {
	for (const timer of pollTimers.values()) window.clearTimeout(timer);
	pollTimers.clear();
}

onBeforeUnmount(clearAllArchivePolls);
onDeactivated(clearAllArchivePolls);

async function fetchMisskeyChannel() {
	const id = channelId.value;
	if (id == null) {
		misskeyChannel.value = null;
		return;
	}
	try {
		misskeyChannel.value = await misskeyApi('channels/show', { channelId: id });
	} catch {
		misskeyChannel.value = null;
	}
}

function openPostForm() {
	if (misskeyChannel.value == null) return;
	os.post({ channel: misskeyChannel.value });
}

watch(channelId, fetchMisskeyChannel, { immediate: true });

const emit = defineEmits<{
	(ev: 'reload'): void;
}>();

function reload() {
	emit('reload');
}

async function loadMedia() {
	if (channelId.value == null) {
		mediaNotes.value = [];
		return;
	}
	mediaFetching.value = true;
	try {
		const notes = await misskeyApi('channels/timeline', {
			channelId: channelId.value,
			limit: 30,
		});
		mediaNotes.value = notes.filter(note => note.fileIds != null && note.fileIds.length > 0);
	} finally {
		mediaFetching.value = false;
	}
}

watch(tab, (newTab) => {
	if (newTab === 'media') {
		loadMedia();
	}
}, { immediate: true });

watch(() => props.channel, () => {
	if (tab.value === 'media') {
		loadMedia();
	}
});
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	gap: var(--MI-margin);
}

.banner {
	position: relative;
	--bannerHeight: 200px;
	height: var(--bannerHeight);
	background-color: var(--MI_THEME-panel);
	background-size: cover;
	background-position: center;
	overflow: clip;
	border-radius: var(--MI-radius);

	> .fade {
		position: absolute;
		bottom: 0;
		left: 0;
		width: 100%;
		height: 64px;
		background: linear-gradient(transparent, color-mix(in srgb, #000, transparent 30%));
	}
}

.header {
	position: relative;
	display: flex;
	align-items: flex-end;
	gap: 16px;
	padding: 0 16px;
	margin-top: -40px;
}

.avatarWrap {
	display: flex;
	flex-direction: column;
	align-items: center;
	flex-shrink: 0;
	gap: 6px;
}

.avatar {
	width: 96px;
	height: 96px;
	box-shadow: 0 0 0 4px var(--MI_THEME-bg);
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-bg);
}

.avatarLive {
	box-shadow: 0 0 0 3px var(--MI_THEME-bg), 0 0 0 5px var(--MI_THEME-error);
}

.liveBadge {
	padding: 2px 10px;
	font-size: 0.75em;
	font-weight: bold;
	color: var(--MI_THEME-fgOnAccent);
	background: var(--MI_THEME-error);
	border-radius: 999px;
	white-space: nowrap;
}

.names {
	flex: 1;
	min-width: 0;
	padding-bottom: 8px;
}

.channelName {
	font-weight: bold;
	font-size: 1.4em;
	line-height: 1.3;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.acct {
	font-size: 0.9em;
	opacity: 0.8;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.actions {
	flex-shrink: 0;
	display: flex;
	gap: 8px;
	padding-bottom: 8px;
	flex-wrap: wrap;
}

.description {
	padding: 0 16px;
}

.tab {
	padding: calc(var(--MI-margin) / 2) 16px;
	background: var(--MI_THEME-bg);
}

.tabContent {
	padding: 0 16px;
}

.placeholder {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 8px;
	padding: 48px 16px;
	color: var(--MI_THEME-fg);
	opacity: 0.7;
	font-size: 1em;
	text-align: center;

	> i {
		font-size: 2em;
		opacity: 0.6;
	}
}

.hintLink {
	margin-left: 4px;
}

.caption {
	font-size: 0.85em;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.75);
}

.archiveGrid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
	gap: 12px;
	padding: 16px 0;
}

.archiveCard {
	border-radius: var(--MI-radius);
	overflow: clip;
	background: var(--MI_THEME-panel);
}

.archiveCardHeader {
	display: flex;
	flex-direction: column;
	align-items: stretch;
	width: 100%;
	text-align: left;
}

.archiveCardHeaderStatic {
	cursor: default;
}

.archiveThumb {
	position: relative;
	aspect-ratio: 16 / 9;
	display: flex;
	align-items: center;
	justify-content: center;
	background-color: var(--MI_THEME-bg);
	background-size: cover;
	background-position: center;
	font-size: 2em;
	opacity: 0.7;
}

.archivePlayIcon {
	position: absolute;
	font-size: 1.6em;
	opacity: 0.9;
	filter: drop-shadow(0 0 4px rgba(0, 0, 0, 0.6));
}

.archiveInfo {
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 10px 12px;
}

.archiveTitle {
	font-weight: bold;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.archiveDuration {
	font-size: 0.85em;
	opacity: 0.7;
}

.archiveBadge {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 0.85em;
	opacity: 0.8;
}

.archiveBadgeSpinner {
	flex-shrink: 0;
}

.archiveBadgeFailed {
	color: var(--MI_THEME-error);
	opacity: 1;
}

.archivePlayer {
	position: relative;
}

.archiveIframe {
	display: block;
	width: 100%;
	aspect-ratio: 16 / 9;
	border: none;
}

.archiveCloseButton {
	position: absolute;
	top: 8px;
	right: 8px;
	z-index: 1;
	width: 32px;
	height: 32px;
	display: flex;
	align-items: center;
	justify-content: center;
	border-radius: 999px;
	background: color-mix(in srgb, #000, transparent 30%);
	color: var(--MI_THEME-fgOnAccent);

	&:hover {
		background: color-mix(in srgb, #000, transparent 10%);
	}
}

.postFormArea {
	padding: 16px 0;
}

.mediaRoot {
	min-height: 120px;
}

.mediaGrid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
	gap: 8px;
}

.mediaCell {
	position: relative;
	aspect-ratio: 1;
	border-radius: calc(var(--MI-radius) / 2);
	overflow: clip;
	background: var(--MI_THEME-bg);

	&:hover {
		text-decoration: none;
	}
}

.mediaImage,
.mediaThumb {
	width: 100%;
	height: 100%;
	border-radius: calc(var(--MI-radius) / 2);
}

@media (max-width: 500px) {
	.banner {
		--bannerHeight: 120px;
		border-radius: 0;
	}

	.header {
		align-items: center;
		margin-top: -46px;
		flex-wrap: wrap;
	}

	.avatar {
		width: 92px;
		height: 92px;
	}

	.names {
		padding-top: 46px;
	}

	.actions {
		padding-top: 46px;
		justify-content: flex-end;
		width: 100%;
	}

	.description {
		text-align: center;
	}

	.mediaGrid {
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
	}
}
</style>
