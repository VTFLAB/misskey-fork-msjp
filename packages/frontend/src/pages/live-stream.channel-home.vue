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
					<!-- 非認可アーカイブ: show.ts 側で ID が省略済みのため、既存の「サムネイル無し」フォールバック表示を
					鍵アイコンで転用する。クリックすると専用視聴ページ (archive-watch.vue) に遷移し、そちら側で
					パスワード入力等の制限パネルが表示される (このカード側は複雑な認可分岐を持たない、bsky-fork 独自) -->
					<template v-if="!a.authorized">
						<MkA :to="`/live/${acct}/archive/${a.streamId}`" :class="$style.archiveCardHeader">
							<div :class="$style.archiveThumb">
								<i class="ti ti-lock"></i>
							</div>
							<div :class="$style.archiveInfo">
								<div v-if="a.title" :class="$style.archiveTitle">{{ a.title }}</div>
								<MkTime :time="a.endedAt" mode="detail"/>
								<div v-if="archiveDuration(a) != null" :class="$style.archiveDuration">{{ archiveDuration(a) }}</div>
							</div>
						</MkA>
					</template>

					<!-- 再生可能: YouTube (優先) / Drive の順で表示する (bsky-fork 独自: YouTube優先+Driveフォールバック方式)。
					専用視聴ページ (archive-watch.vue) への内部リンクに統一し、Misskey 外への離脱を無くす -->
					<template v-else-if="a.youtubeVideoId != null">
						<MkA :to="`/live/${acct}/archive/${a.streamId}`" :class="$style.archiveCardHeader">
							<div :class="$style.archiveThumb" :style="youtubeThumbnailFor(a) ? { backgroundImage: `url(${youtubeThumbnailFor(a)})` } : {}">
								<i v-if="!youtubeThumbnailFor(a)" class="ti ti-brand-youtube"></i>
								<i class="ti ti-player-play" :class="$style.archivePlayIcon"></i>
							</div>
							<div :class="$style.archiveInfo">
								<div v-if="a.title" :class="$style.archiveTitle">{{ a.title }}</div>
								<MkTime :time="a.endedAt" mode="detail"/>
								<div v-if="archiveDuration(a) != null" :class="$style.archiveDuration">{{ archiveDuration(a) }}</div>
								<!-- 公開取り消し済みアーカイブのオーナー閲覧時のみ表示するバッジ (bsky-fork 独自)。
								live-stream.archive-watch.vue の unpublishedBadge と同じ文言・アイコンで統一する -->
								<div v-if="isOwner && a.archiveUnpublished" :class="$style.archiveUnpublishedBadge">
									<i class="ti ti-eye-off"></i> {{ i18n.ts._liveChannel.archiveUnpublishedBadge }}
								</div>
							</div>
						</MkA>
					</template>

					<template v-else-if="a.recordingGoogleDriveFileId != null">
						<MkA :to="`/live/${acct}/archive/${a.streamId}`" :class="$style.archiveCardHeader">
							<div :class="$style.archiveThumb" :style="a.recordingGoogleDriveThumbnailLink ? { backgroundImage: `url(${a.recordingGoogleDriveThumbnailLink})` } : {}">
								<i v-if="!a.recordingGoogleDriveThumbnailLink" class="ti ti-movie"></i>
								<i class="ti ti-player-play" :class="$style.archivePlayIcon"></i>
							</div>
							<div :class="$style.archiveInfo">
								<div v-if="a.title" :class="$style.archiveTitle">{{ a.title }}</div>
								<MkTime :time="a.endedAt" mode="detail"/>
								<div v-if="archiveDuration(a) != null" :class="$style.archiveDuration">{{ archiveDuration(a) }}</div>
								<div v-if="isOwner && a.archiveUnpublished" :class="$style.archiveUnpublishedBadge">
									<i class="ti ti-eye-off"></i> {{ i18n.ts._liveChannel.archiveUnpublishedBadge }}
								</div>
							</div>
						</MkA>
					</template>

					<!-- 未再生可能かつ進行中: スピナー表示 -->
					<template v-else-if="isProcessing(a)">
						<div :class="[$style.archiveCardHeader, $style.archiveCardHeaderStatic]">
							<div :class="$style.archiveThumb">
								<i class="ti ti-movie"></i>
							</div>
							<div :class="$style.archiveInfo">
								<div v-if="a.title" :class="$style.archiveTitle">{{ a.title }}</div>
								<MkTime :time="a.endedAt" mode="detail"/>
								<div v-if="archiveDuration(a) != null" :class="$style.archiveDuration">{{ archiveDuration(a) }}</div>
								<div :class="$style.archiveBadge">
									<MkLoading em :class="$style.archiveBadgeSpinner"/>
									{{ i18n.ts._liveChannel.archiveProcessing }}
								</div>
								<div v-if="isOwner && a.archiveUnpublished" :class="$style.archiveUnpublishedBadge">
									<i class="ti ti-eye-off"></i> {{ i18n.ts._liveChannel.archiveUnpublishedBadge }}
								</div>
							</div>
						</div>
					</template>

					<!-- 未再生可能かつ進行中でもない: 失敗/未使用/キャンセル済み/利用不可 -->
					<template v-else>
						<div :class="[$style.archiveCardHeader, $style.archiveCardHeaderStatic]">
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
								<div v-if="a.recordingStatus === 'failed' && isOwner && a.recordingError" :class="$style.caption">{{ a.recordingError }}</div>
								<div v-if="a.youtubeUploadStatus === 'failed'" :class="[$style.archiveBadge, $style.archiveBadgeFailed]">
									{{ i18n.ts._liveChannel.archiveYoutubeFailed }}
								</div>
								<div v-if="a.youtubeUploadStatus === 'failed' && isOwner && a.youtubeUploadError" :class="$style.caption">{{ a.youtubeUploadError }}</div>
								<div v-if="a.youtubeUploadStatus === 'cancelled'" :class="$style.archiveBadge">
									{{ i18n.ts._liveChannel.archiveYoutubeCancelled }}
								</div>
								<!-- YouTube 側で削除済みで Drive コピーも無い場合の利用不可表示 (bsky-fork 独自)。
								youtubeUploadStatus='unavailable' では backend が youtubeVideoId を null にするため
								ここ(未再生可能)に来る。小さく控えめに表示する -->
								<div v-if="a.youtubeUploadStatus === 'unavailable'" :class="$style.archiveBadge">
									<i class="ti ti-alert-circle"></i> {{ i18n.ts._liveChannel.archiveUnavailable }}
								</div>
								<div v-if="isOwner && a.archiveUnpublished" :class="$style.archiveUnpublishedBadge">
									<i class="ti ti-eye-off"></i> {{ i18n.ts._liveChannel.archiveUnpublishedBadge }}
								</div>
							</div>
						</div>
					</template>
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

// 配信アーカイブ (Google Drive / YouTube、bsky-fork 独自)
const PENDING_RECORDING_STATUSES = ['pending', 'remuxing', 'uploading', 'processing'] as const;
const PENDING_YOUTUBE_STATUSES = ['pending', 'uploading'] as const;
const ARCHIVE_POLL_INTERVAL_MS = 30 * 1000;

const googleDriveLinked = ref<boolean | null>(null);
// google-drive/recording-status / twitch/streams/archive-history のポーリング結果でローカル上書きする分
// (親の sessions 再取得を待たずに反映する)
const statusOverrides = ref<Record<string, {
	recordingStatus?: string;
	recordingGoogleDriveFileId?: string | null;
	youtubeUploadStatus?: string;
	youtubeVideoId?: string | null;
	youtubeThumbnailUrl?: string | null;
	youtubeUploadError?: string | null;
}>>({});
const pollTimers = new Map<string, number>();
const youtubePollTimers = new Map<string, number>();

function isDriveTerminal(recordingStatus: string): boolean {
	return !PENDING_RECORDING_STATUSES.includes(recordingStatus as typeof PENDING_RECORDING_STATUSES[number]);
}

function isYoutubeTerminal(youtubeUploadStatus: string | null | undefined): boolean {
	return youtubeUploadStatus == null || !PENDING_YOUTUBE_STATUSES.includes(youtubeUploadStatus as typeof PENDING_YOUTUBE_STATUSES[number]);
}

const archives = computed(() => {
	return props.sessions
		.filter((s): s is StreamSession & { endedAt: string; recordingStatus: NonNullable<StreamSession['recordingStatus']> } =>
			s.source === 'ome' && !s.isLive && s.endedAt != null && s.recordingStatus != null && s.recordingStatus !== 'none')
		.map(s => {
			const override = statusOverrides.value[s.streamId];
			return {
				...s,
				recordingStatus: override?.recordingStatus ?? s.recordingStatus,
				recordingGoogleDriveFileId: override?.recordingGoogleDriveFileId !== undefined ? override.recordingGoogleDriveFileId : s.recordingGoogleDriveFileId,
				youtubeUploadStatus: override?.youtubeUploadStatus ?? s.youtubeUploadStatus,
				youtubeVideoId: override?.youtubeVideoId !== undefined ? override.youtubeVideoId : s.youtubeVideoId,
				youtubeThumbnailUrl: override?.youtubeThumbnailUrl !== undefined ? override.youtubeThumbnailUrl : s.youtubeThumbnailUrl,
				youtubeUploadError: override?.youtubeUploadError !== undefined ? override.youtubeUploadError : s.youtubeUploadError,
			};
		});
});

// 再生可能かどうか (bsky-fork 独自: YouTube優先+Driveフォールバック方式)。
// どちらか一方でも実体があれば再生可能カードを表示する (表示優先順位はテンプレート側で youtubeVideoId を優先)。
function isPlayable(a: { recordingGoogleDriveFileId?: string | null; youtubeVideoId?: string | null }): boolean {
	return a.recordingGoogleDriveFileId != null || a.youtubeVideoId != null;
}

// まだどちらも再生可能でなく、かつ進行中 (recordingStatus/youtubeUploadStatus のいずれかが
// pending/remuxing/uploading/processing) の場合のみスピナーを表示する。
function isProcessing(a: { recordingStatus: string; youtubeUploadStatus?: string | null; recordingGoogleDriveFileId?: string | null; youtubeVideoId?: string | null }): boolean {
	if (isPlayable(a)) return false;
	const recordingProcessing = PENDING_RECORDING_STATUSES.includes(a.recordingStatus as typeof PENDING_RECORDING_STATUSES[number]);
	const youtubeProcessing = a.youtubeUploadStatus != null && PENDING_RECORDING_STATUSES.includes(a.youtubeUploadStatus as typeof PENDING_RECORDING_STATUSES[number]);
	return recordingProcessing || youtubeProcessing;
}

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

// YouTube サムネイル URL 解決 (bsky-fork 独自)。DB 保存値優先、無ければ動画 ID から機械的に組み立てられる
// 静的サムネイル URL パターンにフォールバックする (アップロード直後で YouTube 側がまだ thumbnails を返していない場合など)。
function youtubeThumbnailFor(a: { youtubeVideoId?: string | null; youtubeThumbnailUrl?: string | null }): string | null {
	if (a.youtubeVideoId == null) return null;
	return a.youtubeThumbnailUrl ?? `https://i.ytimg.com/vi/${a.youtubeVideoId}/hqdefault.jpg`;
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
			statusOverrides.value = { ...statusOverrides.value, [streamId]: { ...statusOverrides.value[streamId], ...res } };
			if (!isDriveTerminal(res.recordingStatus)) {
				scheduleArchivePoll(streamId);
			}
		} catch {
			// 一時的な失敗は次回のマウント時の再ポーリングに任せる (このセッションでは打ち切り)
		}
	}, ARCHIVE_POLL_INTERVAL_MS);
	pollTimers.set(streamId, timer);
}

function clearYoutubePoll(streamId: string) {
	const timer = youtubePollTimers.get(streamId);
	if (timer != null) {
		window.clearTimeout(timer);
		youtubePollTimers.delete(streamId);
	}
}

// YouTube アップロードは videos.insert 完了時点で即 ready/failed が確定する設計 (ポーリング不要な想定) だが、
// このページを開いたまま配信終了直後のアップロード中の瞬間に居合わせると youtubeUploadStatus が pending/uploading の
// まま固定表示され続けてしまう (旧実装のスピナー固着バグと同じ症状)。twitch/streams/archive-history は配信者本人限定
// エンドポイントのため、オーナー表示時のみポーリング対象に含める (非オーナー視聴者は次回リロードで反映される)。
function scheduleYoutubePoll(streamId: string) {
	if (!props.isOwner) return;
	if (youtubePollTimers.has(streamId)) return;
	const timer = window.setTimeout(async () => {
		youtubePollTimers.delete(streamId);
		try {
			const res = await misskeyApi('twitch/streams/archive-history', { limit: 50 });
			const match = res.find(item => item.streamId === streamId);
			if (match != null) {
				statusOverrides.value = {
					...statusOverrides.value,
					[streamId]: {
						...statusOverrides.value[streamId],
						youtubeUploadStatus: match.youtubeUploadStatus,
						youtubeVideoId: match.youtubeVideoId,
						youtubeThumbnailUrl: match.youtubeThumbnailUrl,
						youtubeUploadError: match.youtubeUploadError,
					},
				};
				if (!isYoutubeTerminal(match.youtubeUploadStatus)) {
					scheduleYoutubePoll(streamId);
				}
			}
		} catch {
			// 一時的な失敗は次回のマウント時の再ポーリングに任せる (このセッションでは打ち切り)
		}
	}, ARCHIVE_POLL_INTERVAL_MS);
	youtubePollTimers.set(streamId, timer);
}

watch(archives, (list) => {
	for (const a of list) {
		if (!isDriveTerminal(a.recordingStatus)) {
			scheduleArchivePoll(a.streamId);
		} else {
			clearArchivePoll(a.streamId);
		}

		if (!isYoutubeTerminal(a.youtubeUploadStatus)) {
			scheduleYoutubePoll(a.streamId);
		} else {
			clearYoutubePoll(a.streamId);
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
	for (const timer of youtubePollTimers.values()) window.clearTimeout(timer);
	youtubePollTimers.clear();
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

// 公開取り消し済みアーカイブのオーナー閲覧時バッジ (bsky-fork 独自)。
// live-stream.archive-watch.vue の .unpublishedBadge と同じ配色・角丸で統一する
.archiveUnpublishedBadge {
	display: flex;
	align-items: center;
	gap: 4px;
	width: fit-content;
	padding: 2px 8px;
	font-size: 0.8em;
	border-radius: 999px;
	background: var(--MI_THEME-infoWarnBg);
	color: var(--MI_THEME-infoWarnFg);
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
