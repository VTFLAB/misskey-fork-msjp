<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<iframe
	v-if="active"
	:src="playerUrl"
	:class="$style.player"
	allowfullscreen
	allow="autoplay; fullscreen"
></iframe>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { hostname } from '@@/js/config.js';

const props = defineProps<{
	twitchLogin: string;
	active: boolean;
}>();

const playerUrl = computed(() => {
	const url = new URL('https://player.twitch.tv/');
	url.searchParams.set('channel', props.twitchLogin);
	url.searchParams.set('parent', hostname);
	url.searchParams.set('autoplay', 'true');
	return url.toString();
});
</script>

<style lang="scss" module>
.player {
	width: 100%;
	height: 100%;
	border: none;
	display: block;
}
</style>
