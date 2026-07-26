<!--
SPDX-FileCopyrightText: misskey-bsky-integration fork
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<MkYoutubeArchivePlayer
		v-if="youtubeVideoId != null"
		ref="youtubePlayerEl"
		:youtubeVideoId="youtubeVideoId"
	/>
	<div
		v-else-if="recordingGoogleDriveFileId != null"
		ref="driveIframeWrapperEl"
		:class="$style.driveIframeWrapper"
	>
		<iframe
			:src="`https://drive.google.com/file/d/${recordingGoogleDriveFileId}/preview`"
			:class="$style.driveIframe"
			:style="{ transform: `scale(${driveIframeScale})` }"
			allow="autoplay; fullscreen"
			allowfullscreen
		></iframe>
	</div>
	<!-- どちらの実体も無い場合の空表示メッセージ (bsky-fork 独自)。
	YouTube が unavailable (削除済み) で Drive コピーも無い場合等にここへ来る。
	呼び出し元で弾いている前提だが、念のためアーカイブ無し/利用不可のメッセージを出す -->
	<div v-else :class="$style.empty">
		<i class="ti ti-movie-off"></i>
		<span>{{ i18n.ts._liveChannel.archiveUnavailable }}</span>
	</div>
</div>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import MkYoutubeArchivePlayer from '@/components/MkYoutubeArchivePlayer.vue';
import { i18n } from '@/i18n.js';

// dispatcher (bsky-fork 独自): youtubeVideoId があれば YouTube IFrame Player API 経由、
// 無く recordingGoogleDriveFileId があれば Drive の /preview iframe、どちらも無ければ何も表示しない
// (呼び出し元がこのケースを弾く前提だが、念のため空表示にしておく)
const props = defineProps<{
	youtubeVideoId?: string | null;
	recordingGoogleDriveFileId?: string | null;
}>();

const youtubePlayerEl = useTemplateRef('youtubePlayerEl');

// Drive 再生時 (または再生対象が無い場合) は youtubePlayerEl が存在しないため、
// 制御 API は null 相当 (no-op) になる (Drive iframe には再生位置取得 API が無いため)
function getCurrentTime(): number | null {
	return youtubePlayerEl.value?.getCurrentTime() ?? null;
}

function seekTo(seconds: number): void {
	youtubePlayerEl.value?.seekTo(seconds);
}

defineExpose({
	getCurrentTime,
	seekTo,
});

// Google Drive の /preview 埋め込みは iframe の実効幅が約420pxを下回ると内部レンダリングが
// 崩れる (動画が拡大されクロップされる) ため、常に基準幅で描画してから scale で縮小表示する
// (下記 .driveIframe の width/height と一致させること)
const DRIVE_IFRAME_BASE_WIDTH = 600;

const driveIframeWrapperEl = useTemplateRef('driveIframeWrapperEl');
// ResizeObserver 発火前 (幅0) に scale が 0/NaN/Infinity にならないよう初期値は等倍にしておく
const driveIframeScale = ref(1);
let driveIframeResizeObserver: ResizeObserver | undefined;

onMounted(() => {
	if (driveIframeWrapperEl.value == null) return;
	driveIframeResizeObserver = new ResizeObserver((entries) => {
		const width = entries[0]?.contentRect.width;
		if (width != null && width > 0) {
			driveIframeScale.value = width / DRIVE_IFRAME_BASE_WIDTH;
		}
	});
	driveIframeResizeObserver.observe(driveIframeWrapperEl.value);
});

onBeforeUnmount(() => {
	driveIframeResizeObserver?.disconnect();
});
</script>

<style lang="scss" module>
.root {
	width: 100%;
}

// live-stream.channel-home.vue の .archiveIframe と同じパターン (bsky-fork 独自)。
// Google Drive埋め込みは狭い実効幅でレンダリングが崩れるため、iframeは常に基準幅で描画し
// (下記 .driveIframe)、このラッパーで実際のコンテナ幅にscale表示する
.driveIframeWrapper {
	position: relative;
	width: 100%;
	aspect-ratio: 16 / 9;
	overflow: hidden;
}

// 基準サイズ (600x337.5 = 16:9)。script側の DRIVE_IFRAME_BASE_WIDTH と一致させること
.driveIframe {
	position: absolute;
	top: 0;
	left: 0;
	width: 600px;
	height: 337.5px;
	border: none;
	transform-origin: top left;
}

// 再生対象が無い場合の空表示メッセージ (bsky-fork 独自)
.empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 6px;
	aspect-ratio: 16 / 9;
	color: var(--MI_THEME-fg);
	opacity: 0.6;
	font-size: 0.9em;
	background: var(--MI_THEME-bg);
	border-radius: var(--MI-radius);

	> i {
		font-size: 2em;
		opacity: 0.6;
	}
}
</style>
