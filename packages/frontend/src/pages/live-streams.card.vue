<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkA :to="`/live/@${stream.user.username}`" :class="$style.root" class="_panel">
	<div :class="$style.thumbnail">
		<img v-if="thumbnailUrl" :src="thumbnailUrl" :class="$style.thumbnailImg" loading="lazy" decoding="async" alt=""/>
		<div v-else :class="$style.thumbnailFallback"><i class="ti ti-broadcast"></i></div>
		<span :class="$style.liveBadge">LIVE</span>
		<span :class="$style.viewers"><i class="ti ti-eye"></i> {{ number(stream.viewerCount) }}</span>
	</div>
	<div :class="$style.body">
		<MkAvatar :user="stream.user" :class="$style.avatar"/>
		<div :class="$style.info">
			<div :class="$style.title">{{ stream.title !== '' ? stream.title : i18n.ts._twitch.liveStreams }}</div>
			<div :class="$style.userName"><MkUserName :user="stream.user" :nowrap="true"/></div>
			<div v-if="stream.gameName" :class="$style.game">{{ stream.gameName }}</div>
		</div>
	</div>
</MkA>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import * as Misskey from 'misskey-js';
import { i18n } from '@/i18n.js';
import number from '@/filters/number.js';

const props = defineProps<{
	stream: Misskey.Endpoints['twitch/live-streams']['res'][number];
}>();

// Helix の thumbnail_url は {width}x{height} プレースホルダ入りテンプレート
const thumbnailUrl = computed(() => {
	if (props.stream.thumbnailUrl == null) return null;
	return props.stream.thumbnailUrl.replace('{width}', '640').replace('{height}', '360');
});
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
	background: #000;
}

.thumbnailImg {
	width: 100%;
	height: 100%;
	object-fit: cover;
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
	background: #e91916; // Twitch の LIVE インジケータ色
	color: #fff;
	font-size: 0.8em;
	font-weight: bold;
}

.viewers {
	position: absolute;
	bottom: 8px;
	right: 8px;
	padding: 2px 8px;
	border-radius: 4px;
	background: rgba(0, 0, 0, 0.7);
	color: #fff;
	font-size: 0.8em;
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

.game {
	font-size: 0.85em;
	opacity: 0.7;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
</style>
