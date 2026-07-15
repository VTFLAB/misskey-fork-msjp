<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkA :to="`/live/@${channel.user.username}`" :class="$style.root" class="_panel">
	<div :class="$style.thumbnail" :style="{ backgroundImage: bgUrl ? `url(${bgUrl})` : undefined }">
		<div v-if="!bgUrl" :class="$style.thumbnailFallback"><i class="ti ti-broadcast"></i></div>
		<span v-if="channel.isLive" :class="$style.liveBadge">{{ i18n.ts._liveChannel.liveNow }}</span>
	</div>
	<div :class="$style.body">
		<MkAvatar :user="channel.user" :class="$style.avatar"/>
		<div :class="$style.info">
			<div :class="$style.title">{{ channel.name ?? channel.user.name ?? channel.user.username }}</div>
			<div :class="$style.userName"><MkUserName :user="channel.user" :nowrap="true"/></div>
			<div v-if="channel.description" :class="$style.description">{{ channel.description }}</div>
		</div>
	</div>
</MkA>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import * as Misskey from 'misskey-js';
import { i18n } from '@/i18n.js';

const props = defineProps<{
	channel: Misskey.Endpoints['live-channels/list']['res'][number];
}>();

const bgUrl = computed(() => (props.channel.isLive ? props.channel.bannerUrl : props.channel.offlineImageUrl) ?? props.channel.bannerUrl ?? null);
</script>

<style lang="scss" module>
.root {
	display: block;
	overflow: clip;

	&:hover {
		text-decoration: none;
	}
}

.thumbnail {
	position: relative;
	aspect-ratio: 16 / 9;
	background-color: #000;
	background-size: cover;
	background-position: center;
}

.thumbnailFallback {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 100%;
	height: 100%;
	font-size: 2em;
	color: var(--MI_THEME-fgTransparent);
}

.liveBadge {
	position: absolute;
	top: 8px;
	left: 8px;
	padding: 2px 8px;
	border-radius: 4px;
	background: var(--MI_THEME-accent);
	color: #fff;
	font-size: 0.8em;
	font-weight: bold;
}

.body {
	display: flex;
	gap: 10px;
	padding: 12px;
}

.avatar {
	flex-shrink: 0;
	width: 42px;
	height: 42px;
}

.info {
	min-width: 0;
}

.title {
	font-weight: bold;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.userName {
	font-size: 0.9em;
	opacity: 0.9;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.description {
	font-size: 0.85em;
	opacity: 0.7;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
</style>
