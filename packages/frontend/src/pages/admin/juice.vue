<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 700px; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
		<SearchMarker path="/admin/juice" :label="i18n.ts._juiceSettings.title" :keywords="['juice']" icon="ti ti-droplet">
			<div class="_gaps_m">
				<SearchMarker>
					<MkSwitch v-model="reactionPiggybackOnRemoteEnabled">
						<template #label><SearchLabel>{{ i18n.ts._juiceSettings.reactionPiggybackOnRemoteEnabled }}</SearchLabel></template>
						<template #caption>{{ i18n.ts._juiceSettings.reactionPiggybackOnRemoteEnabledCaption }}</template>
					</MkSwitch>
				</SearchMarker>

				<SearchMarker>
					<MkSwitch v-model="aiGeneratedFallbackCwEnabled">
						<template #label><SearchLabel>{{ i18n.ts._juiceSettings.aiGeneratedFallbackCwEnabled }}</SearchLabel></template>
						<template #caption>{{ i18n.ts._juiceSettings.aiGeneratedFallbackCwEnabledCaption }}</template>
					</MkSwitch>
				</SearchMarker>
			</div>
		</SearchMarker>
	</div>
	<template #footer>
		<div :class="$style.footer">
			<div class="_spacer" style="--MI_SPACER-w: 700px; --MI_SPACER-min: 16px; --MI_SPACER-max: 16px;">
				<MkButton primary rounded @click="save"><i class="ti ti-check"></i> {{ i18n.ts.save }}</MkButton>
			</div>
		</div>
	</template>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkButton from '@/components/MkButton.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';

const settings = await misskeyApi('admin/juice/settings');

const reactionPiggybackOnRemoteEnabled = ref(settings.reactionPiggybackOnRemoteEnabled);
const aiGeneratedFallbackCwEnabled = ref(settings.aiGeneratedFallbackCwEnabled);

function save() {
	os.apiWithDialog('admin/juice/update-settings', {
		reactionPiggybackOnRemoteEnabled: reactionPiggybackOnRemoteEnabled.value,
		aiGeneratedFallbackCwEnabled: aiGeneratedFallbackCwEnabled.value,
	});
}

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts._juiceSettings.title,
	icon: 'ti ti-droplet',
}));
</script>

<style lang="scss" module>
.footer {
	-webkit-backdrop-filter: var(--MI-blur, blur(15px));
	backdrop-filter: var(--MI-blur, blur(15px));
}
</style>
