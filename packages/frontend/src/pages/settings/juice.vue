<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<SearchMarker path="/settings/juice" :label="i18n.ts._juiceSettings.title" :keywords="['juice', 'ai', 'aigenerated']" icon="ti ti-droplet">
	<div class="_gaps_m">
		<SearchMarker :keywords="['ai', 'mute', 'aigenerated']">
			<MkSelect v-model="muteAIGeneratedNotes" :items="muteAIGeneratedNotesDef" @update:modelValue="save()">
				<template #label><SearchLabel>{{ i18n.ts._juiceSettings.muteAIGeneratedNotes }}</SearchLabel></template>
				<template #caption><SearchText>{{ i18n.ts._juiceSettings.muteAIGeneratedNotesDescription }}</SearchText></template>
			</MkSelect>
		</SearchMarker>
	</div>
</SearchMarker>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import MkSelect from '@/components/MkSelect.vue';
import { i18n } from '@/i18n.js';
import { ensureSignin } from '@/i.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import { useMkSelect } from '@/composables/use-mkselect.js';

const $i = ensureSignin();

const {
	model: muteAIGeneratedNotes,
	def: muteAIGeneratedNotesDef,
} = useMkSelect({
	items: [
		{ label: i18n.ts.none, value: 'none' },
		{ label: i18n.ts._juiceSettings.muteAIGeneratedNotesMute, value: 'mute' },
		{ label: i18n.ts._juiceSettings.muteAIGeneratedNotesHardMute, value: 'hardMute' },
	],
	initialValue: $i.muteAIGeneratedNotes ?? 'none',
});

function save() {
	misskeyApi('i/juice/update-mute-ai-generated', {
		muteAIGeneratedNotes: muteAIGeneratedNotes.value,
	});
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts._juiceSettings.title,
	icon: 'ti ti-droplet',
}));
</script>
