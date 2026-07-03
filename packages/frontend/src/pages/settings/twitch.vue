<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<SearchMarker path="/settings/twitch" :label="i18n.ts._twitch.twitchIntegration" :keywords="['twitch', 'stream', 'live', 'connect']" icon="ti ti-brand-twitch">
	<div class="_gaps_m">
		<MkInfo v-if="state === 'loading'">{{ i18n.ts.loading }}</MkInfo>
		<MkInfo v-else-if="!available" warn>{{ i18n.ts._twitch.notConfigured }}</MkInfo>

		<template v-else>
			<FormSection first>
				<template #label><i class="ti ti-brand-twitch"></i> {{ i18n.ts._twitch.myAccount }}</template>

				<div class="_gaps_m">
					<template v-if="linked">
						<MkKeyValue>
							<template #key>{{ i18n.ts._twitch.linkedAs }}</template>
							<template #value>{{ twitchDisplayName }} (@{{ twitchLogin }})</template>
						</MkKeyValue>
						<MkButton danger @click="unlink">{{ i18n.ts._twitch.unlink }}</MkButton>
					</template>
					<template v-else>
						<div>{{ i18n.ts._twitch.linkDescription }}</div>
						<MkButton primary @click="link">{{ i18n.ts._twitch.linkAccount }}</MkButton>
					</template>
				</div>
			</FormSection>

			<FormSection v-if="iAmAdmin">
				<template #label><i class="ti ti-robot"></i> {{ i18n.ts._twitch.relayBot }}</template>

				<div class="_gaps_m">
					<div>{{ i18n.ts._twitch.relayBotDescription }}</div>
					<MkKeyValue v-if="botLinked">
						<template #key>{{ i18n.ts._twitch.botLinkedAs }}</template>
						<template #value>@{{ botLogin }}</template>
					</MkKeyValue>
					<MkInfo v-else warn>{{ i18n.ts._twitch.botNotLinked }}</MkInfo>
					<MkButton @click="linkBot">{{ i18n.ts._twitch.linkBotAccount }}</MkButton>
				</div>
			</FormSection>
		</template>
	</div>
</SearchMarker>
</template>

<script lang="ts" setup>
import { computed, ref, onMounted } from 'vue';
import FormSection from '@/components/form/section.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkKeyValue from '@/components/MkKeyValue.vue';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { iAmAdmin } from '@/i.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const state = ref<'loading' | 'ready'>('loading');
const available = ref(false);
const linked = ref(false);
const twitchLogin = ref<string | null>(null);
const twitchDisplayName = ref<string | null>(null);
const botLinked = ref(false);
const botLogin = ref<string | null>(null);

async function fetchStatus() {
	const res = await misskeyApi('twitch/my-account', {});
	available.value = res.available;
	linked.value = res.linked;
	twitchLogin.value = res.twitchLogin;
	twitchDisplayName.value = res.twitchDisplayName;
	botLinked.value = res.botLinked;
	botLogin.value = res.botLogin;
	state.value = 'ready';
}

async function link() {
	const { url } = await os.apiWithDialog('twitch/generate-oauth-url', {});
	window.location.href = url;
}

async function linkBot() {
	const { canceled } = await os.confirm({
		type: 'question',
		text: i18n.ts._twitch.linkBotConfirm,
	});
	if (canceled) return;
	const { url } = await os.apiWithDialog('twitch/generate-oauth-url', { forBot: true });
	window.location.href = url;
}

async function unlink() {
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.ts._twitch.unlinkConfirm,
	});
	if (canceled) return;
	await os.apiWithDialog('twitch/unlink', {});
	await fetchStatus();
}

function handleCallbackResult() {
	const params = new URLSearchParams(window.location.search);
	const result = params.get('twitchResult');
	if (result == null) return;

	// query を消してリロード/共有時の再表示を防ぐ
	window.history.replaceState(null, '', window.location.pathname);

	switch (result) {
		case 'linked':
			os.alert({ type: 'success', text: i18n.ts._twitch.linked });
			break;
		case 'botLinked':
			os.alert({ type: 'success', text: i18n.ts._twitch.botLinkedSuccess });
			break;
		case 'denied':
			os.alert({ type: 'warning', text: i18n.ts._twitch.linkDenied });
			break;
		case 'error': {
			const reason = params.get('reason');
			os.alert({ type: 'error', text: reason != null ? `${i18n.ts._twitch.linkError}\n${reason}` : i18n.ts._twitch.linkError });
			break;
		}
	}
}

onMounted(async () => {
	handleCallbackResult();
	await fetchStatus();
});

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts._twitch.twitchIntegration,
	icon: 'ti ti-brand-twitch',
}));
</script>
