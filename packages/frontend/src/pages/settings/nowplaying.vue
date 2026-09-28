<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<SearchMarker path="/settings/nowplaying" :label="i18n.ts._nowPlaying.title" :keywords="['nowplaying', 'music', 'spotify', 'lastfm', 'listenbrainz']" icon="ti ti-music">
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

		<SearchMarker :keywords="['lastfm', 'listenbrainz', 'link', 'connect']">
			<FormSection>
				<template #label><i class="ti ti-plug-connected"></i> <SearchLabel>{{ i18n.ts._nowPlaying.linkedAccounts }}</SearchLabel></template>

				<MkInfo v-if="state === 'loading'">{{ i18n.ts.loading }}</MkInfo>
				<div v-else class="_gaps_m">
					<FormSection first>
						<template #label>{{ i18n.ts._nowPlaying.lastfm }}</template>

						<div v-if="lastfmAvailable" class="_gaps_s">
							<template v-if="lastfmAccount">
								<MkKeyValue>
									<template #key>{{ i18n.ts._nowPlaying.linkedAccounts }}</template>
									<template #value>{{ lastfmAccount.serviceUsername }}</template>
								</MkKeyValue>
								<MkButton danger @click="unlink('lastfm')">{{ i18n.ts._nowPlaying.unlink }}</MkButton>
							</template>
							<MkButton v-else primary @click="linkLastfm">{{ i18n.ts._nowPlaying.link }}</MkButton>
						</div>
						<MkInfo v-else warn>{{ i18n.ts._nowPlaying.notLinked }}</MkInfo>
					</FormSection>

					<FormSection>
						<template #label>{{ i18n.ts._nowPlaying.listenbrainz }}</template>

						<div class="_gaps_s">
							<template v-if="listenbrainzAccount">
								<MkKeyValue>
									<template #key>{{ i18n.ts._nowPlaying.linkedAccounts }}</template>
									<template #value>{{ listenbrainzAccount.serviceUsername }}</template>
								</MkKeyValue>
								<MkButton danger @click="unlink('listenbrainz')">{{ i18n.ts._nowPlaying.unlink }}</MkButton>
							</template>
							<template v-else>
								<MkInput v-model="listenbrainzToken" type="password">
									<template #label>{{ i18n.ts._nowPlaying.listenbrainzToken }}</template>
									<template #caption>{{ i18n.ts._nowPlaying.listenbrainzTokenCaption }}</template>
								</MkInput>
								<MkButton primary :disabled="!listenbrainzToken" @click="linkListenbrainz">{{ i18n.ts._nowPlaying.link }}</MkButton>
							</template>
						</div>
					</FormSection>
				</div>
			</FormSection>
		</SearchMarker>
	</div>
</SearchMarker>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import * as Misskey from 'misskey-js';
import MkInput from '@/components/MkInput.vue';
import MkButton from '@/components/MkButton.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkKeyValue from '@/components/MkKeyValue.vue';
import FormSection from '@/components/form/section.vue';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
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

const state = ref<'loading' | 'ready'>('loading');
const lastfmAvailable = ref(false);
const accounts = ref<Misskey.entities.NowplayingAccountsResponse['accounts']>([]);
const listenbrainzToken = ref('');

const lastfmAccount = computed(() => accounts.value.find(a => a.service === 'lastfm') ?? null);
const listenbrainzAccount = computed(() => accounts.value.find(a => a.service === 'listenbrainz') ?? null);

async function fetchAccounts() {
	const res = await misskeyApi('nowplaying/accounts', {});
	lastfmAvailable.value = res.lastfmAvailable;
	accounts.value = res.accounts;
	state.value = 'ready';
}

async function linkLastfm() {
	const { url } = await os.apiWithDialog('nowplaying/lastfm/generate-auth-url', {});
	window.location.href = url;
}

async function linkListenbrainz() {
	if (!listenbrainzToken.value) return;
	await os.apiWithDialog('nowplaying/listenbrainz/link', { token: listenbrainzToken.value });
	listenbrainzToken.value = '';
	await fetchAccounts();
}

async function unlink(service: 'lastfm' | 'listenbrainz') {
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.ts._nowPlaying.unlinkConfirm,
	});
	if (canceled) return;
	await os.apiWithDialog('nowplaying/unlink', { service });
	await fetchAccounts();
}

function handleCallbackResult() {
	const params = new URLSearchParams(window.location.search);
	const lastfmResult = params.get('lastfmResult');
	if (lastfmResult == null) return;

	// query を消してリロード/共有時の再表示を防ぐ
	window.history.replaceState(null, '', window.location.pathname);

	if (lastfmResult === 'ok') {
		os.toast(i18n.ts._nowPlaying.lastfmLinked);
	} else {
		os.alert({ type: 'error', text: i18n.ts._nowPlaying.lastfmLinkFailed });
	}
}

onMounted(() => {
	fetchAccounts();
	handleCallbackResult();
});

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts._nowPlaying.title,
	icon: 'ti ti-music',
}));
</script>
