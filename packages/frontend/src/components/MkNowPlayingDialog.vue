<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="450"
	:withOkButton="false"
	@close="cancel()"
	@closed="emit('closed')"
>
	<template #header>
		<i class="ti ti-music" style="margin-right: 6px;"></i>{{ i18n.ts._nowPlaying.title }}
	</template>

	<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px;">
		<div class="_gaps_m">
			<div class="_gaps_s">
				<div style="font-weight: bold;">{{ i18n.ts._nowPlaying.fromUrl }}</div>
				<div style="display: flex; gap: 8px; align-items: flex-end;">
					<MkInput v-model="sourceUrl" style="flex: 1;" type="url" :placeholder="i18n.ts._nowPlaying.urlField">
						<template #prefix><i class="ti ti-link"></i></template>
					</MkInput>
					<MkButton :disabled="!sourceUrl || resolving" @click="resolveUrl">{{ i18n.ts._nowPlaying.fetch }}</MkButton>
				</div>
				<MkInfo v-if="resolveError" warn>{{ resolveError }}</MkInfo>
			</div>

			<div class="_gaps_s">
				<div style="font-weight: bold;">{{ i18n.ts._nowPlaying.fetchCurrent }}</div>
				<MkButton :disabled="fetchingCurrent" @click="fetchCurrent">{{ i18n.ts._nowPlaying.fetchCurrent }}</MkButton>
				<MkInfo v-if="currentHint" warn>
					{{ currentHint }}
					<span v-if="currentHintNotLinked"> <MkA to="/settings/nowplaying" class="_link">{{ i18n.ts._nowPlaying.linkedAccounts }}</MkA></span>
				</MkInfo>
			</div>

			<img v-if="thumbnailUrl" :src="thumbnailUrl" :class="$style.thumbnail" alt=""/>

			<div class="_gaps_s">
				<MkInput v-model="title">
					<template #label>{{ i18n.ts._nowPlaying.titleField }}</template>
				</MkInput>
				<MkInput v-model="artist">
					<template #label>{{ i18n.ts._nowPlaying.artistField }}</template>
				</MkInput>
				<MkInput v-model="serviceLabel">
					<template #label>{{ i18n.ts._nowPlaying.serviceField }}</template>
				</MkInput>
				<MkInput v-model="trackUrl" type="url">
					<template #label>{{ i18n.ts._nowPlaying.urlField }}</template>
				</MkInput>
			</div>

			<div class="_gaps_s">
				<div style="font-weight: bold;">{{ i18n.ts._nowPlaying.preview }}</div>
				<div :class="$style.preview">{{ previewText }}</div>
			</div>

			<MkButton primary rounded :disabled="!title" @click="insert">{{ i18n.ts._nowPlaying.insert }}</MkButton>
		</div>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { computed, ref, useTemplateRef } from 'vue';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkInput from '@/components/MkInput.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkA from '@/components/global/MkA.vue';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { buildNowPlayingText } from '@/utility/now-playing.js';

const emit = defineEmits<{
	(ev: 'insert', payload: { text: string; artworkUrl: string | null; comment: string | null }): void;
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');

const sourceUrl = ref('');
const resolving = ref(false);
const resolveError = ref<string | null>(null);

const fetchingCurrent = ref(false);
const currentHint = ref<string | null>(null);
const currentHintNotLinked = ref(false);

const title = ref('');
const artist = ref('');
const serviceLabel = ref('');
const trackUrl = ref('');
const thumbnailUrl = ref<string | null>(null);

const previewText = computed(() => buildNowPlayingText({
	title: title.value,
	artist: artist.value || null,
	serviceLabel: serviceLabel.value,
	url: trackUrl.value || null,
}));

async function resolveUrl() {
	if (!sourceUrl.value) return;
	resolving.value = true;
	resolveError.value = null;
	try {
		const res = await misskeyApi('nowplaying/resolve-url', { url: sourceUrl.value });
		title.value = res.title ?? title.value;
		artist.value = res.artist ?? artist.value;
		serviceLabel.value = res.serviceLabel;
		trackUrl.value = res.url;
		thumbnailUrl.value = res.thumbnailUrl;
	} catch (err: any) {
		if (err?.code === 'INVALID_URL') {
			resolveError.value = i18n.ts.somethingHappened;
		} else {
			resolveError.value = i18n.ts.somethingHappened;
		}
	} finally {
		resolving.value = false;
	}
}

async function fetchCurrent() {
	fetchingCurrent.value = true;
	currentHint.value = null;
	currentHintNotLinked.value = false;
	try {
		const res = await misskeyApi('nowplaying/current', {});
		if (res == null) {
			currentHint.value = i18n.ts._nowPlaying.noCurrentTrack;
			return;
		}
		title.value = res.title;
		artist.value = res.artist;
		serviceLabel.value = res.serviceLabel;
		trackUrl.value = res.url ?? '';
		thumbnailUrl.value = res.thumbnailUrl;
	} catch (err: any) {
		if (err?.code === 'NO_LINKED_ACCOUNT') {
			currentHint.value = i18n.ts._nowPlaying.notLinked;
			currentHintNotLinked.value = true;
		} else {
			currentHint.value = i18n.ts.somethingHappened;
		}
	} finally {
		fetchingCurrent.value = false;
	}
}

function insert() {
	emit('insert', {
		text: previewText.value,
		artworkUrl: thumbnailUrl.value,
		comment: [title.value, artist.value].filter(v => v !== '').join(' / ') || null,
	});
	if (dialog.value) dialog.value.close();
}

function cancel() {
	if (dialog.value) dialog.value.close();
}
</script>

<style lang="scss" module>
.thumbnail {
	display: block;
	max-width: 100%;
	max-height: 160px;
	border-radius: 8px;
	margin: 0 auto;
}

.preview {
	white-space: pre-wrap;
	word-break: break-word;
	padding: 10px;
	border-radius: 6px;
	background: var(--MI_THEME-buttonBg);
	font-size: 0.9em;
}
</style>
