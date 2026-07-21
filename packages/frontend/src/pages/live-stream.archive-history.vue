<!--
SPDX-FileCopyrightText: misskey-bsky-integration fork
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="480"
	:height="600"
	@close="dialog?.close()"
	@closed="emit('closed')"
>
	<template #header>{{ i18n.ts._liveChannel.archiveHistory }}</template>

	<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px;">
		<MkLoading v-if="fetching"/>
		<div v-else-if="items.length === 0" :class="$style.empty">{{ i18n.ts._liveChannel.archiveHistoryEmpty }}</div>
		<div v-else class="_gaps_s">
			<div v-for="item in items" :key="item.streamId" :class="$style.item" class="_panel">
				<div :class="$style.title">{{ item.title }}</div>
				<div :class="$style.dates">
					{{ new Date(item.startedAt).toLocaleString() }} 〜 {{ item.endedAt ? new Date(item.endedAt).toLocaleString() : '' }}
				</div>

				<div :class="$style.statusRow">
					<!-- Drive 状態 -->
					<template v-if="isDriveProcessing(item)">
						<div :class="$style.statusBadge">
							<MkLoading em :class="$style.statusSpinner"/>
							{{ isDriveThumbnailProcessing(item) ? i18n.ts._liveChannel.archiveDriveThumbnailProcessing : i18n.ts._liveChannel.archiveDriveProcessing }}
						</div>
					</template>
					<template v-else-if="item.recordingStatus === 'ready' && item.recordingGoogleDriveFileId != null">
						<div :class="$style.statusBadge">
							{{ i18n.ts._liveChannel.archiveDriveReady }}
							<a :href="`https://drive.google.com/file/d/${item.recordingGoogleDriveFileId}/view`" target="_blank" rel="noopener" :class="$style.statusLink">
								<i class="ti ti-external-link"></i> {{ i18n.ts._liveChannel.viewOnDrive }}
							</a>
						</div>
					</template>
					<template v-else-if="item.recordingStatus === 'ready' && item.recordingGoogleDriveFileId == null">
						<div :class="$style.statusBadge">{{ i18n.ts._liveChannel.archiveDriveUnused }}</div>
					</template>
					<template v-else-if="item.recordingStatus === 'failed'">
						<div :class="[$style.statusBadge, $style.statusBadgeFailed]">{{ i18n.ts._liveChannel.archiveDriveFailed }}</div>
					</template>

					<!-- YouTube 状態 -->
					<template v-if="item.youtubeUploadStatus == null || item.youtubeUploadStatus === 'none'">
						<div :class="$style.statusBadge">{{ i18n.ts._liveChannel.archiveYoutubeUnused }}</div>
					</template>
					<template v-else-if="item.youtubeUploadStatus === 'pending' || item.youtubeUploadStatus === 'uploading'">
						<div :class="$style.statusBadge">
							<MkLoading em :class="$style.statusSpinner"/>
							{{ i18n.ts._liveChannel.archiveYoutubeProcessing }}
						</div>
					</template>
					<template v-else-if="item.youtubeUploadStatus === 'ready'">
						<div :class="$style.statusBadge">
							{{ i18n.ts._liveChannel.archiveYoutubeReady }}
							<a v-if="item.youtubeVideoId != null" :href="`https://www.youtube.com/watch?v=${item.youtubeVideoId}`" target="_blank" rel="noopener" :class="$style.statusLink">
								<i class="ti ti-external-link"></i> {{ i18n.ts._liveChannel.viewOnYoutube }}
							</a>
						</div>
					</template>
					<template v-else-if="item.youtubeUploadStatus === 'failed'">
						<div :class="[$style.statusBadge, $style.statusBadgeFailed]">{{ i18n.ts._liveChannel.archiveYoutubeFailed }}</div>
					</template>
					<template v-else-if="item.youtubeUploadStatus === 'queued'">
						<div :class="$style.statusBadge">
							<i class="ti ti-clock" :class="$style.statusIcon"></i>
							{{ i18n.ts._liveChannel.archiveYoutubeQueued }}
							<button class="_button" :class="$style.statusLink" @click="cancelYoutubeUpload(item)">
								<i class="ti ti-x"></i> {{ i18n.ts._liveChannel.archiveYoutubeCancel }}
							</button>
						</div>
						<div v-if="item.recordingGoogleDriveFileId != null" :class="$style.statusBadge">
							{{ i18n.ts._liveChannel.archiveDriveTemporaryAvailable }}
							<a :href="`https://drive.google.com/file/d/${item.recordingGoogleDriveFileId}/view`" target="_blank" rel="noopener" :class="$style.statusLink">
								<i class="ti ti-external-link"></i> {{ i18n.ts._liveChannel.viewOnDrive }}
							</a>
						</div>
					</template>
					<template v-else-if="item.youtubeUploadStatus === 'cancelled'">
						<div :class="$style.statusBadge">{{ i18n.ts._liveChannel.archiveYoutubeCancelled }}</div>
						<div v-if="item.recordingGoogleDriveFileId != null" :class="$style.statusBadge">
							<a :href="`https://drive.google.com/file/d/${item.recordingGoogleDriveFileId}/view`" target="_blank" rel="noopener" :class="$style.statusLink">
								<i class="ti ti-external-link"></i> {{ i18n.ts._liveChannel.viewOnDrive }}
							</a>
						</div>
					</template>
				</div>

				<div v-if="item.recordingStatus === 'failed' && item.recordingError" :class="$style.errorText">{{ item.recordingError }}</div>
				<div v-if="item.youtubeUploadStatus === 'failed' && item.youtubeUploadError" :class="$style.errorText">{{ item.youtubeUploadError }}</div>

				<div :class="$style.actions">
					<button v-if="hasPreview(item)" class="_button" :class="$style.actionButton" @click="togglePreview(item)">
						<i class="ti" :class="isExpanded(item) ? 'ti-eye-off' : 'ti-eye'"></i>
						{{ isExpanded(item) ? i18n.ts._liveChannel.archivePreviewHide : i18n.ts._liveChannel.archivePreviewShow }}
					</button>
					<button class="_button" :class="$style.actionButton" @click="openArchiveSettings(item)">
						<i class="ti ti-settings"></i> {{ i18n.ts._liveChannel.archiveSettingsTitle }}
					</button>
					<button v-if="!item.archiveUnpublished" class="_button" :class="[$style.actionButton, $style.actionButtonDanger]" @click="unpublishArchive(item)">
						<i class="ti ti-ban"></i> {{ i18n.ts._liveChannel.archiveUnpublish }}
					</button>
					<div v-else :class="$style.statusBadge">
						<i class="ti ti-lock" :class="$style.statusIcon"></i> {{ i18n.ts._liveChannel.archiveUnpublishedBadge }}
					</div>
				</div>

				<MkArchivePlayer
					v-if="isExpanded(item)"
					:class="$style.previewPlayer"
					:youtubeVideoId="item.youtubeVideoId"
					:recordingGoogleDriveFileId="item.recordingGoogleDriveFileId"
				/>
			</div>
			<MkButton v-if="hasMore" :class="$style.more" @click="fetchMore">{{ i18n.ts.loadMore }}</MkButton>
		</div>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { ref, useTemplateRef, onMounted } from 'vue';
import * as Misskey from 'misskey-js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkButton from '@/components/MkButton.vue';
import MkArchivePlayer from '@/components/MkArchivePlayer.vue';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';

type ArchiveItem = Misskey.Endpoints['twitch/streams/archive-history']['res'][number];
type ArchiveSettings = Misskey.Endpoints['twitch/streams/update-archive-settings']['res'];

const LIMIT = 20;

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');

const items = ref<ArchiveItem[]>([]);
const fetching = ref(true);
const hasMore = ref(false);

// プレビュー展開中の streamId 集合 (bsky-fork 独自)。複数項目を同時に展開してよい
// (制約する要件が無いため単純化)。Set は Vue のリアクティブ Proxy 越しに直接 add/delete してよい
const expandedStreamIds = ref<Set<string>>(new Set());

// Drive はサムネイル生成待ちの processing 状態が「録画処理中」より遅く発生するため、
// 「アーカイブ処理中(サムネイル生成含む)」の文言は processing のときだけ差し替える。
const DRIVE_PENDING_STATUSES = ['pending', 'remuxing', 'uploading'] as const;

function isDriveProcessing(item: ArchiveItem): boolean {
	return DRIVE_PENDING_STATUSES.includes(item.recordingStatus as typeof DRIVE_PENDING_STATUSES[number])
		|| item.recordingStatus === 'processing';
}

function isDriveThumbnailProcessing(item: ArchiveItem): boolean {
	return item.recordingStatus === 'processing';
}

async function fetchInitial() {
	fetching.value = true;
	try {
		const res = await misskeyApi('twitch/streams/archive-history', { limit: LIMIT });
		items.value = res;
		hasMore.value = res.length >= LIMIT;
	} finally {
		fetching.value = false;
	}
}

async function fetchMore() {
	if (items.value.length === 0) return;
	const res = await misskeyApi('twitch/streams/archive-history', {
		limit: LIMIT,
		untilId: items.value[items.value.length - 1].streamId,
	});
	items.value = [...items.value, ...res];
	hasMore.value = res.length >= LIMIT;
}

async function cancelYoutubeUpload(item: ArchiveItem) {
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.ts._liveChannel.archiveYoutubeCancelConfirm,
	});
	if (canceled) return;
	await os.apiWithDialog('twitch/streams/cancel-youtube-upload', { streamId: item.streamId });
	await fetchInitial();
}

// プレビュー (bsky-fork 独自): オーナー専用一覧のため常に authorized:true 相当として扱い、
// 認可判定を挟まず直接 youtubeVideoId / recordingGoogleDriveFileId を MkArchivePlayer に渡す
function hasPreview(item: ArchiveItem): boolean {
	return item.youtubeVideoId != null || item.recordingGoogleDriveFileId != null;
}

function isExpanded(item: ArchiveItem): boolean {
	return expandedStreamIds.value.has(item.streamId);
}

function togglePreview(item: ArchiveItem) {
	if (expandedStreamIds.value.has(item.streamId)) {
		expandedStreamIds.value.delete(item.streamId);
	} else {
		expandedStreamIds.value.add(item.streamId);
	}
}

// アーカイブ個別の視聴制限設定モーダル (bsky-fork 独自)。更新結果は emit('updated', ...) で
// 受け取り、一覧を再取得せず対象項目だけをその場で書き換える
async function openArchiveSettings(item: ArchiveItem) {
	const { dispose } = await os.popupAsyncWithDialog(
		import('@/pages/live-stream.archive-settings.vue').then(x => x.default),
		{
			streamId: item.streamId,
			archiveViewVisibility: item.archiveViewVisibility,
			archiveViewPassword: item.archiveViewPassword,
			archiveVisibleUserIds: item.archiveVisibleUserIds,
		},
		{
			updated: (updated: ArchiveSettings) => {
				const target = items.value.find(i => i.streamId === updated.streamId);
				if (target == null) return;
				target.archiveViewVisibility = updated.archiveViewVisibility;
				target.archiveViewPassword = updated.archiveViewPassword;
				target.archiveVisibleUserIds = updated.archiveVisibleUserIds;
				target.archiveUnpublished = updated.archiveUnpublished;
			},
			closed: () => dispose(),
		},
	);
}

// 公開取り消し (bsky-fork 独自): 冪等な操作のため archiveUnpublished:true の項目にはボタン自体を
// 出さず (テンプレート側で分岐)、成功後は一覧を再取得して表示を最新化する
async function unpublishArchive(item: ArchiveItem) {
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.ts._liveChannel.archiveUnpublishConfirm,
	});
	if (canceled) return;
	await os.apiWithDialog('twitch/streams/unpublish-archive', { streamId: item.streamId });
	await fetchInitial();
}

onMounted(() => {
	fetchInitial();
});
</script>

<style lang="scss" module>
.empty {
	opacity: 0.6;
	text-align: center;
	padding: 24px 0;
}

.item {
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 12px 14px;
}

.title {
	font-weight: bold;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.dates {
	font-size: 0.85em;
	opacity: 0.75;
}

.statusRow {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
	margin-top: 4px;
}

.statusBadge {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 0.85em;
	opacity: 0.9;
}

.statusBadgeFailed {
	color: var(--MI_THEME-error);
	opacity: 1;
}

.statusSpinner {
	flex-shrink: 0;
}

.statusIcon {
	flex-shrink: 0;
}

.statusLink {
	display: inline-flex;
	align-items: center;
	gap: 2px;
}

.errorText {
	font-size: 0.85em;
	color: var(--MI_THEME-error);
}

.actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
	margin-top: 4px;
}

.actionButton {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 4px 10px;
	border-radius: 999px;
	background: var(--MI_THEME-panel);
	font-size: 0.85em;

	&:hover:not(:disabled) {
		background: var(--MI_THEME-panelHighlight);
	}
}

.actionButtonDanger {
	color: var(--MI_THEME-error);
}

.previewPlayer {
	margin-top: 4px;
}

.more {
	margin: 0 auto;
}
</style>
