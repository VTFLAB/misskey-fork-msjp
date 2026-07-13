<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<div :class="$style.banner" :style="{ backgroundImage: bannerUrl ? `url(${ bannerUrl })` : '' }">
		<div v-if="bannerUrl" :class="$style.fade"></div>
	</div>
	<div :class="$style.header" class="_gaps_s">
		<MkAvatar :class="$style.avatar" :user="user" link indicator/>
		<div :class="$style.names">
			<div :class="$style.channelName">{{ channel.name ?? user.name ?? user.username }}</div>
			<div :class="$style.acct"><MkAcct :user="user" :detail="true"/></div>
		</div>
		<div :class="$style.actions">
			<MkFollowButton v-if="$i != null && $i.id !== user.id" v-model:user="user" :full="true"/>
		</div>
	</div>
	<div v-if="channel.description" :class="$style.description" class="_selectable">
		<Mfm :text="channel.description" :isNote="false" :author="user" :plain="true"/>
	</div>
	<div v-if="isOwner" :class="$style.ownerActions" class="_gaps_s">
		<MkButton primary @click="onOpenPreview">{{ i18n.ts._twitch.openPreview }}</MkButton>
			<MkButton @click="(ev: MouseEvent) => onOpenStreamerSettings(ev)">{{ i18n.ts._twitch.streamerSettings }}</MkButton>
	</div>
	<div :class="$style.timeline" class="_gaps_m">
		<MkNotesTimeline :noGap="true" :paginator="notesPaginator" :pullToRefresh="true"/>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, markRaw, ref } from 'vue';
import * as Misskey from 'misskey-js';
import MkAvatar from '@/components/global/MkAvatar.vue';
import MkAcct from '@/components/global/MkAcct.vue';
import MkButton from '@/components/MkButton.vue';
import MkFollowButton from '@/components/MkFollowButton.vue';
import MkNotesTimeline from '@/components/MkNotesTimeline.vue';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { Paginator } from '@/utility/paginator.js';

const props = defineProps<{
	user: Misskey.entities.UserDetailed;
	channel: Misskey.Endpoints['live-channels/show']['res'];
	isOwner: boolean;
	onOpenPreview: () => void;
	onOpenStreamerSettings: (ev: MouseEvent) => void;
}>();

const user = ref(props.user);

const bannerUrl = computed(() => {
	if (props.channel.bannerId == null) return props.user.bannerUrl;
	// TODO: Phase 3 pragmatic fallback — live-channels/show has no bannerUrl field.
	// For now we fall back to user.bannerUrl. Once backend adds bannerUrl, swap to it.
	return props.user.bannerUrl;
});

const notesPaginator = markRaw(new Paginator('users/notes', {
	limit: 10,
	computedParams: computed(() => ({
		userId: props.user.id,
	})),
}));
</script>

<style lang="scss" module>
.root {
	container-type: inline-size;
}

.banner {
	position: relative;
	--bannerHeight: 250px;
	height: var(--bannerHeight);
	background-color: var(--MI_THEME-panel);
	background-size: cover;
	background-position: center;
	overflow: clip;

	> .fade {
		position: absolute;
		bottom: 0;
		left: 0;
		width: 100%;
		height: 78px;
		background: linear-gradient(transparent, color-mix(in srgb, #000, transparent 30%));
	}
}

.header {
	position: relative;
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 0 16px;
	margin-top: -48px;
	margin-bottom: 16px;
}

.avatar {
	flex-shrink: 0;
	width: 96px;
	height: 96px;
	box-shadow: 0 0 0 4px var(--MI_THEME-bg);
}

.names {
	flex: 1;
	min-width: 0;
	padding-top: 48px;
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
	padding-top: 48px;
}

.description {
	padding: 0 16px 16px 16px;
}

.ownerActions {
	display: flex;
	gap: 8px;
	padding: 0 16px 16px 16px;
	flex-wrap: wrap;
}

.timeline {
	padding: 0 16px;
}

@container (max-width: 500px) {
	.banner {
		--bannerHeight: 140px;
	}

	.header {
		flex-direction: column;
		align-items: center;
		margin-top: -46px;
		padding-top: 0;
	}

	.avatar {
		width: 92px;
		height: 92px;
		margin: 0 auto;
	}

	.names {
		padding-top: 0;
		text-align: center;
	}

	.actions {
		padding-top: 0;
	}

	.description {
		text-align: center;
	}

	.ownerActions {
		justify-content: center;
	}
}
</style>
