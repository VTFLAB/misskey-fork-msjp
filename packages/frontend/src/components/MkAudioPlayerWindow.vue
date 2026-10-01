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

	<MkAudioPlayerQueue :class="$style.root"/>
</MkWindow>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.js';
import MkWindow from '@/components/MkWindow.vue';
import MkAudioPlayerQueue from '@/components/MkAudioPlayerQueue.vue';

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();
</script>

<style lang="scss" module>
.root {
	padding: 12px 14px;
}
</style>
