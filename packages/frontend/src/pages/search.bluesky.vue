<!--
SPDX-FileCopyrightText: misskey-bsky-integration fork
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps">
	<div class="_gaps">
		<MkInput v-model="searchQuery" :large="true" :autofocus="true" type="search" :placeholder="i18n.ts._atproto.searchPlaceholder" @enter.prevent="search">
			<template #prefix><i class="ti ti-search"></i></template>
		</MkInput>
		<MkButton large primary gradate rounded @click="search">{{ i18n.ts.search }}</MkButton>
		<div :class="$style.notice">
			<i class="ti ti-info-circle"></i> {{ i18n.ts._atproto.poweredBy }}
		</div>
	</div>

	<div v-if="loading" class="_spacer" style="--MI_SPACER-w: 800px; text-align: center;">
		<MkLoading/>
	</div>

	<div v-else-if="errorMessage != null" :class="$style.error">
		<MkInfo warn>{{ errorMessage }}</MkInfo>
	</div>

	<MkFoldableSection v-else-if="actors.length > 0">
		<template #header>{{ i18n.ts.searchResult }}</template>
		<div :class="$style.list">
			<div v-for="actor in actors" :key="actor.did" :class="$style.item">
				<img v-if="actor.avatar" :class="$style.avatar" :src="actor.avatar" loading="lazy" :alt="actor.handle"/>
				<div v-else :class="$style.avatarFallback">
					<i class="ti ti-cloud"></i>
				</div>
				<div :class="$style.body">
					<div :class="$style.name">{{ actor.displayName || actor.handle }}</div>
					<div :class="$style.handle">@{{ actor.handle }}@bsky.social</div>
					<div v-if="actor.description" :class="$style.description">{{ actor.description }}</div>
				</div>
				<div :class="$style.actions">
					<MkButton v-if="!actor.isFollowedByMe" primary rounded :disabled="actor.busy" @click="follow(actor)">
						{{ i18n.ts._atproto.followAndSubscribe }}
					</MkButton>
					<MkButton v-else danger rounded :disabled="actor.busy" @click="unfollow(actor)">
						{{ i18n.ts._atproto.unfollow }}
					</MkButton>
				</div>
			</div>
		</div>
	</MkFoldableSection>

	<div v-else-if="hasSearched" :class="$style.empty">
		<MkInfo>{{ i18n.ts._atproto.noResults }}</MkInfo>
	</div>
</div>
</template>

<script lang="ts" setup>
import { ref, toRef } from 'vue';
import MkInput from '@/components/MkInput.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkFoldableSection from '@/components/MkFoldableSection.vue';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';

type ActorRow = {
	did: string;
	handle: string;
	displayName: string | null;
	description: string | null;
	avatar: string | null;
	indexedAt: string | null;
	isFollowedByMe: boolean;
	busy: boolean;
};

const props = withDefaults(defineProps<{
	query?: string,
}>(), {
	query: '',
});

const searchQuery = ref(toRef(props, 'query').value);
const actors = ref<ActorRow[]>([]);
const loading = ref(false);
const hasSearched = ref(false);
const errorMessage = ref<string | null>(null);

async function search() {
	const q = searchQuery.value.trim();
	if (q.length === 0) return;

	loading.value = true;
	errorMessage.value = null;
	try {
		const res = await misskeyApi('atproto/search', { q, limit: 25 });
		actors.value = res.actors.map(a => ({ ...a, busy: false }));
		hasSearched.value = true;
	} catch (e) {
		errorMessage.value = i18n.ts._atproto.appviewUnavailable;
		// eslint-disable-next-line no-console
		console.error(e);
	} finally {
		loading.value = false;
	}
}

async function follow(actor: ActorRow) {
	actor.busy = true;
	try {
		await misskeyApi('atproto/follow', { did: actor.did });
		actor.isFollowedByMe = true;
	} finally {
		actor.busy = false;
	}
}

async function unfollow(actor: ActorRow) {
	actor.busy = true;
	try {
		await misskeyApi('atproto/unfollow', { did: actor.did });
		actor.isFollowedByMe = false;
	} finally {
		actor.busy = false;
	}
}
</script>

<style lang="scss" module>
.notice {
	font-size: 0.85em;
	color: var(--MI_THEME-fgTransparentWeak);
	display: flex;
	align-items: center;
	gap: 4px;
}

.list {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.item {
	display: flex;
	gap: 12px;
	padding: 12px;
	background: var(--MI_THEME-panel);
	border-radius: 8px;
	align-items: flex-start;
}

.avatar,
.avatarFallback {
	width: 48px;
	height: 48px;
	border-radius: 50%;
	flex-shrink: 0;
	object-fit: cover;
}

.avatarFallback {
	background: var(--MI_THEME-panelHighlight);
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--MI_THEME-fgTransparentWeak);
}

.body {
	flex: 1;
	min-width: 0;
}

.name {
	font-weight: 700;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.handle {
	font-size: 0.85em;
	color: var(--MI_THEME-fgTransparentWeak);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.description {
	margin-top: 4px;
	font-size: 0.9em;
	overflow: hidden;
	display: -webkit-box;
	-webkit-line-clamp: 3;
	-webkit-box-orient: vertical;
}

.actions {
	flex-shrink: 0;
}

.error,
.empty {
	margin-top: 16px;
}
</style>
