<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader v-model:tab="tab" :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 1200px;">
		<div class="_gaps">
			<template v-if="tab === 'liveChannels'">
				<MkLoading v-if="channelsFetching"/>
				<div v-else-if="channels.length > 0" :class="$style.grid">
					<XLiveChannelCard v-for="channel in channels" :key="channel.id" :channel="channel"/>
				</div>
				<MkResult v-else type="empty" :text="i18n.ts._liveChannel.noLiveChannels"/>
			</template>
			<template v-else-if="tab === 'twitch'">
				<MkLoading v-if="streamsFetching"/>
				<div v-else-if="streams.length > 0" :class="$style.grid">
					<XTwitchCard v-for="stream in streams" :key="stream.user.id" :stream="stream"/>
				</div>
				<MkResult v-else type="empty" :text="i18n.ts._twitch.noLiveStreams"/>
			</template>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, ref, watch, onMounted, onActivated } from 'vue';
import * as Misskey from 'misskey-js';
import XLiveChannelCard from '@/pages/live-channels.card.vue';
import XTwitchCard from '@/pages/live-streams.card.vue';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const tab = ref<'liveChannels' | 'twitch'>('liveChannels');

const channelsFetching = ref(true);
const channels = ref<Misskey.Endpoints['live-channels/list']['res']>([]);

const streamsFetching = ref(true);
const streams = ref<Misskey.Endpoints['twitch/live-streams']['res']>([]);
let streamsFetched = false;

async function fetchChannels() {
	channelsFetching.value = true;
	try {
		channels.value = await misskeyApi('live-channels/list', { limit: 100 });
	} finally {
		channelsFetching.value = false;
	}
}

async function fetchStreams() {
	streamsFetching.value = true;
	try {
		streams.value = await misskeyApi('twitch/live-streams', {});
		streamsFetched = true;
	} finally {
		streamsFetching.value = false;
	}
}

watch(tab, (v) => {
	if (v === 'twitch' && !streamsFetched) {
		fetchStreams();
	}
});

onMounted(fetchChannels);
onActivated(fetchChannels);

const headerActions = computed(() => [{
	icon: 'ti ti-refresh',
	text: i18n.ts.reload,
	handler: () => {
		if (tab.value === 'twitch') {
			fetchStreams();
		} else {
			fetchChannels();
		}
	},
}]);

const headerTabs = computed(() => [{
	key: 'liveChannels',
	title: i18n.ts._liveChannel.liveChannels,
	icon: 'ti ti-broadcast',
}, {
	key: 'twitch',
	title: i18n.ts._twitch.twitchRelay,
	icon: 'ti ti-brand-twitch',
}]);

definePage(() => ({
	title: i18n.ts._liveChannel.liveChannels,
	icon: 'ti ti-broadcast',
}));
</script>

<style lang="scss" module>
.grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
	gap: 12px;
}
</style>
