<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<MkOmePlayer
		v-if="source === 'ome' && playbackUrl != null"
		:playbackUrl="playbackUrl"
		:active="active"
		:pageKey="pageKey"
	/>
	<MkTwitchPlayer
		v-else-if="source === 'twitch' && twitchLogin != null"
		:twitchLogin="twitchLogin"
		:active="active"
	/>
</div>
</template>

<script lang="ts" setup>
import MkOmePlayer from '@/components/MkOmePlayer.vue';
import MkTwitchPlayer from '@/components/MkTwitchPlayer.vue';

const props = defineProps<{
	source: 'ome' | 'twitch';
	playbackUrl?: string | null; // source === 'ome' のとき必須
	twitchLogin?: string | null; // source === 'twitch' のとき必須
	active: boolean;
	pageKey?: string; // 視聴ページ識別子 (acct)。MkOmePlayer の音量ページ別保持に使う。
}>();
</script>

<style lang="scss" module>
.root {
	width: 100%;
	height: 100%;
}
</style>
