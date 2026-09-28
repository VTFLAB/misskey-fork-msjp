<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<SearchMarker path="/settings/nowplaying" :label="i18n.ts._nowPlaying.title" :keywords="['nowplaying', 'music', 'spotify']" icon="ti ti-music">
	<div class="_gaps_m">
		<SearchMarker :keywords="['template', 'hashtag']">
			<FormSection first>
				<template #label><i class="ti ti-template"></i> <SearchLabel>{{ i18n.ts._nowPlaying.template }}</SearchLabel></template>

				<div class="_gaps_s">
					<MkInput v-model="template" @update:modelValue="saveTemplate">
						<template #caption><SearchText>{{ i18n.ts._nowPlaying.templateCaption }}</SearchText></template>
					</MkInput>
					<div>{{ i18n.ts._nowPlaying.preview }}: {{ templatePreview }}</div>
					<MkButton @click="resetTemplate">{{ i18n.ts._nowPlaying.resetTemplate }}</MkButton>
				</div>
			</FormSection>
		</SearchMarker>

		<SearchMarker :keywords="['card', 'image', 'artwork']">
			<FormSection>
				<template #label><i class="ti ti-photo"></i> <SearchLabel>{{ i18n.ts._nowPlaying.attachCard }}</SearchLabel></template>

				<MkSwitch v-model="attachCard">
					<template #label><SearchLabel>{{ i18n.ts._nowPlaying.attachCard }}</SearchLabel></template>
					<template #caption><SearchText>{{ i18n.ts._nowPlaying.attachCardCaption }}</SearchText></template>
				</MkSwitch>
			</FormSection>
		</SearchMarker>
	</div>
</SearchMarker>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue';
import MkInput from '@/components/MkInput.vue';
import MkButton from '@/components/MkButton.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import FormSection from '@/components/form/section.vue';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';
import { buildNowPlayingText } from '@/utility/now-playing.js';
import { definePage } from '@/page.js';

const DEFAULT_TEMPLATE = '#NowPlaying {title} / {artist} from {service}';

const template = ref(prefer.s.nowPlayingTemplate);
const attachCard = prefer.model('nowPlayingAttachCard');

const templatePreview = computed(() => buildNowPlayingText({
	title: 'Song Title',
	artist: 'Artist Name',
	serviceLabel: 'Spotify',
	url: null,
}, template.value));

function saveTemplate(v: string) {
	prefer.commit('nowPlayingTemplate', v);
}

function resetTemplate() {
	template.value = DEFAULT_TEMPLATE;
	saveTemplate(DEFAULT_TEMPLATE);
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts._nowPlaying.title,
	icon: 'ti ti-music',
}));
</script>
