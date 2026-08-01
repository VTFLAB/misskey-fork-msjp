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

				<!-- retention バナー (bsky-fork 独自: YouTube 12時間アーカイブ上限対策)。
				オーナー本人のみ recordingRetentionExpiresAt が渡される (show.ts / archive-history 共に
				owner-only)。Drive/YouTube 保存に失敗してローカルに録画が保持されている場合に表示し、
				配信者にダウンロード or Drive 再アップロードを促す。成功後は recordingRetentionExpiresAt を
				クリアしてバナーを非表示にする -->
				<div v-if="item.recordingRetentionExpiresAt != null" :class="[$style.retentionBanner, { [$style.retentionExpired]: retentionRemainingDays(item) <= 0 }]">
					<div :class="$style.retentionHeader">
						<i class="ti ti-alert-triangle"></i>
						<span :class="$style.retentionTitle">{{ i18n.ts._liveChannel.retentionBannerTitle }}</span>
					</div>
					<div :class="$style.retentionBody">{{ i18n.ts._liveChannel.retentionBannerText }}</div>
					<div :class="$style.retentionExpires">
						{{ retentionRemainingDays(item) > 0 ? i18n.tsx._liveChannel.retentionExpiresIn({ n: retentionRemainingDays(item) }) : i18n.ts._liveChannel.retentionExpired }}
					</div>
					<div :class="$style.retentionActions">
						<a class="_button" :class="$style.retentionAction" :href="downloadUrlFor(item)" target="_blank" rel="noopener" download>
							<i class="ti ti-download"></i> {{ i18n.ts._liveChannel.retentionDownload }}
						</a>
						<button
							class="_button"
							:class="[$style.retentionAction, $style.retentionActionPrimary]"
							:disabled="retryingStreamIds.has(item.streamId) || item.recordingStatus === 'uploading'"
							@click="retryDriveUpload(item)"
						>
							<i class="ti ti-refresh"></i> {{ i18n.ts._liveChannel.retentionRetryDrive }}
						</button>
					</div>
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
				<!-- 12時間超過で YouTube への保存をスキップした状態 (bsky-fork 独自)。
				YouTube動画は無いが Drive はある前提 (backend が skipped 判定時に Drive へ保存している)。
				YouTube動画IDが無い場合はバッジを表示せず空欄を避けるためスキップメモを出す -->
				<template v-else-if="item.youtubeUploadStatus === 'skipped'">
					<div v-if="item.youtubeVideoId == null" :class="$style.statusBadge">
						<i class="ti ti-clock-off" :class="$style.statusIcon"></i>
						{{ i18n.ts._liveChannel.youtubeSkipped }}
					</div>
					<div v-else :class="$style.statusBadge">
						{{ i18n.ts._liveChannel.archiveYoutubeReady }}
						<a :href="`https://www.youtube.com/watch?v=${item.youtubeVideoId}`" target="_blank" rel="noopener" :class="$style.statusLink">
							<i class="ti ti-external-link"></i> {{ i18n.ts._liveChannel.viewOnYoutube }}
						</a>
					</div>
				</template>
				<!-- YouTube 側で削除されてアーカイブが利用不可 (bsky-fork 独自)。
				backend は youtubeUploadStatus='unavailable' の時 youtubeVideoId/youtubeThumbnailUrl を null にするため
				YouTube リンクは出さない。Drive コピーが残っていれば Drive リンクを併記する -->
				<template v-else-if="item.youtubeUploadStatus === 'unavailable'">
					<div :class="[$style.statusBadge, $style.statusBadgeFailed]">
						<i class="ti ti-alert-circle" :class="$style.statusIcon"></i>
						{{ i18n.ts._liveChannel.archiveUnavailable }}
						<span :class="$style.statusSubtext">({{ i18n.ts._liveChannel.archiveUnavailableReason }})</span>
					</div>
					<div v-if="item.recordingGoogleDriveFileId != null" :class="$style.statusBadge">
						<a :href="`https://drive.google.com/file/d/${item.recordingGoogleDriveFileId}/view`" target="_blank" rel="noopener" :class="$style.statusLink">
							<i class="ti ti-external-link"></i> {{ i18n.ts._liveChannel.viewOnDrive }}
						</a>
					</div>
				</template>
				<!-- 上記いずれにも該当しない未知状態のフォールバック (空欄防止) -->
				<template v-else>
					<div :class="$style.statusBadge">{{ i18n.ts._liveChannel.archiveYoutubeUnused }}</div>
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
import { ref, useTemplateRef, onMounted, onUnmounted } from 'vue';
import * as Misskey from 'misskey-js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkButton from '@/components/MkButton.vue';
import MkArchivePlayer from '@/components/MkArchivePlayer.vue';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { $i } from '@/i.js';
import { url } from '@@/js/config.js';

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

// retention バナー (bsky-fork 独自): 録画保持期限の残日数を計算する。
// recordingRetentionExpiresAt は ISO 文字列 (owner-only)。残り 0 以下は期限切れ扱い。
// Math.max で負数を 0 に丸め、Math.ceil で「残り N 日」を切り上げ表示にする (例: 期限まで 1.2 日 → 2 日)
function retentionRemainingDays(item: ArchiveItem): number {
	if (item.recordingRetentionExpiresAt == null) return 0;
	const diffMs = new Date(item.recordingRetentionExpiresAt).getTime() - Date.now();
	return Math.max(0, Math.ceil(diffMs / 86400000));
}

// retention 中の録画ダウンロード URL (bsky-fork 独自)。raw streaming route への GET で
// ブラウザの <a download> からカスタムヘッダを付けられないため query に Misskey access token を入れる。
// token は misskeyApi と同じ $i.token (sign-in user の access token) を用いる。未ログイン時は空文字にして
// 401 になることを許容する (本モーダルは owner-only なので実質 $i != null が保証される)
function downloadUrlFor(item: ArchiveItem): string {
	const token = $i?.token ?? '';
	return `${url}/recording-download/${item.streamId}?token=${encodeURIComponent(token)}`;
}

// Drive 再アップロード (bsky-fork 独自): サーバー保持中の録画を Google Drive へ再保存する。
// API は前提チェック後すぐ応答し、アップロード本体はサーバー側でバックグラウンド継続される
// (大容量ファイルの転送完了を同期で待つとリバースプロキシのタイムアウトで、実際は成功して
// いるのに HTML エラーページが返り失敗と誤表示されるため)。完了はポーリングで反映する。
// retention バナーは成功確定までそのまま残す (ダウンロード手段を成否不明のまま奪わない)
const retryingStreamIds = ref<Set<string>>(new Set());

async function retryDriveUpload(item: ArchiveItem) {
	const { canceled } = await os.confirm({
		type: 'warning',
		title: i18n.ts._liveChannel.retentionRetryConfirmTitle,
		text: i18n.ts._liveChannel.retentionRetryConfirmText,
	});
	if (canceled) return;

	if (retryingStreamIds.value.has(item.streamId)) return;
	retryingStreamIds.value.add(item.streamId);
	try {
		const res = await misskeyApi('twitch/streams/retry-drive-upload', { streamId: item.streamId });
		// 開始直後の状態 (recordingStatus='uploading') を反映。ステータスバッジが処理中表示になり、
		// 再アップロードボタンは :disabled で押せなくなる
		item.recordingStatus = res.recordingStatus;
		item.recordingError = res.recordingError;
		os.alert({ type: 'info', text: i18n.ts._liveChannel.retentionRetrySuccess });
		startRetryPolling(item.streamId);
	} catch (err: any) {
		const reason = err?.info?.reason ?? (err instanceof Error ? err.message : String(err));
		os.alert({
			type: 'error',
			text: i18n.tsx._liveChannel.retentionRetryFailed({ reason: reason ?? '' }),
		});
	} finally {
		retryingStreamIds.value.delete(item.streamId);
	}
}

// 再アップロードの完了監視 (bsky-fork 独自)。一覧 API の先頭ページを定期再取得し、
// uploading → processing/ready | failed への遷移を検出して item を書き換え、結果を通知する。
// モーダルを閉じると監視は止まるが、サーバー側のアップロードは継続する (開き直せば最新状態が見える)
const RETRY_POLL_INTERVAL_MS = 15 * 1000;
// 長時間配信の大容量ファイルに合わせた監視上限。超過時は静かに止める (結果は次回オープン時に反映)
const RETRY_POLL_MAX_MS = 60 * 60 * 1000;
const pollingStreamIds = new Set<string>();
let retryPollTimer: number | null = null;
let retryPollStartedAt = 0;

function stopRetryPolling() {
	if (retryPollTimer != null) {
		window.clearInterval(retryPollTimer);
		retryPollTimer = null;
	}
	pollingStreamIds.clear();
}

function startRetryPolling(streamId: string) {
	pollingStreamIds.add(streamId);
	retryPollStartedAt = Date.now();
	if (retryPollTimer == null) {
		retryPollTimer = window.setInterval(pollRetryStatus, RETRY_POLL_INTERVAL_MS);
	}
}

async function pollRetryStatus() {
	if (Date.now() - retryPollStartedAt > RETRY_POLL_MAX_MS) {
		stopRetryPolling();
		return;
	}
	let res: ArchiveItem[];
	try {
		res = await misskeyApi('twitch/streams/archive-history', { limit: LIMIT });
	} catch {
		return; // 一時的な取得失敗は次回のポーリングに任せる
	}
	for (const fresh of res) {
		if (!pollingStreamIds.has(fresh.streamId)) continue;
		if (fresh.recordingStatus === 'uploading') continue; // まだ転送中
		pollingStreamIds.delete(fresh.streamId);
		const item = items.value.find(i => i.streamId === fresh.streamId);
		if (item != null) Object.assign(item, fresh);
		if (fresh.recordingGoogleDriveFileId != null) {
			os.success();
		} else {
			os.alert({
				type: 'error',
				text: i18n.tsx._liveChannel.retentionRetryFailed({ reason: fresh.recordingError ?? '' }),
			});
		}
	}
	if (pollingStreamIds.size === 0) stopRetryPolling();
}

onUnmounted(() => {
	stopRetryPolling();
});

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

.statusSubtext {
	opacity: 0.75;
	font-size: 0.9em;
}

// retention バナー (bsky-fork 独自: YouTube 12時間アーカイブ上限対策)。
// 警告テーマ (warn 系のテーマ変数) で目立たせ、期限切れは error 系に切替える
.retentionBanner {
	display: flex;
	flex-direction: column;
	gap: 6px;
	margin-top: 4px;
	padding: 10px 12px;
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-infoWarnBg);
	color: var(--MI_THEME-infoWarnFg);

	&.retentionExpired {
		background: var(--MI_THEME-errorBg);
		color: var(--MI_THEME-errorFg);
	}
}

.retentionHeader {
	display: flex;
	align-items: center;
	gap: 6px;
	font-weight: bold;
}

.retentionTitle {
	font-size: 0.95em;
}

.retentionBody {
	font-size: 0.85em;
	opacity: 0.9;
	line-height: 1.4;
}

.retentionExpires {
	font-size: 0.85em;
	font-weight: bold;
}

.retentionActions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-top: 2px;
}

.retentionAction {
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

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
}

.retentionActionPrimary {
	color: var(--MI_THEME-accent);
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
