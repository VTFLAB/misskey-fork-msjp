<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 1200px;">
		<div class="_gaps">
			<MkLoading v-if="channelsFetching"/>
			<div v-else-if="channels.length > 0" :class="$style.grid">
				<XLiveChannelCard v-for="channel in channels" :key="channel.id" :channel="channel"/>
			</div>
			<MkResult v-else type="empty" :text="i18n.ts._liveChannel.noLiveChannels"/>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, ref, onMounted, onActivated } from 'vue';
import * as Misskey from 'misskey-js';
import XLiveChannelCard from '@/pages/live-channels.card.vue';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const channelsFetching = ref(true);
const channels = ref<Misskey.Endpoints['live-channels/list']['res']>([]);

async function fetchChannels() {
	channelsFetching.value = true;
	try {
		channels.value = await misskeyApi('live-channels/list', { limit: 100 });
	} finally {
		channelsFetching.value = false;
	}
}

onMounted(fetchChannels);
onActivated(fetchChannels);

const headerActions = computed(() => [{
	icon: 'ti ti-refresh',
	text: i18n.ts.reload,
	handler: () => {
		fetchChannels();
	},
}]);

const headerTabs = computed(() => []);

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
