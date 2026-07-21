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
	<iframe
		v-else-if="recordingGoogleDriveFileId != null"
		:src="`https://drive.google.com/file/d/${recordingGoogleDriveFileId}/preview`"
		:class="$style.driveIframe"
		allow="autoplay; fullscreen"
		allowfullscreen
	></iframe>
</div>
</template>

<script lang="ts" setup>
import { useTemplateRef } from 'vue';
import MkYoutubeArchivePlayer from '@/components/MkYoutubeArchivePlayer.vue';

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
</script>

<style lang="scss" module>
.root {
	width: 100%;
}

// live-stream.channel-home.vue の .archiveIframe と同じパターン (bsky-fork 独自)
.driveIframe {
	display: block;
	width: 100%;
	aspect-ratio: 16 / 9;
	border: none;
}
</style>
