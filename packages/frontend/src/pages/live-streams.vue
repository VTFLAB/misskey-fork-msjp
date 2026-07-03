<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 1200px;">
		<div class="_gaps">
			<MkLoading v-if="fetching"/>
			<div v-else-if="streams.length > 0" :class="$style.grid">
				<MkLiveStreamCard v-for="stream in streams" :key="stream.user.id" :stream="stream"/>
			</div>
			<MkResult v-else type="empty" :text="i18n.ts._twitch.noLiveStreams"/>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, ref, onMounted, onActivated } from 'vue';
import * as Misskey from 'misskey-js';
import MkLiveStreamCard from '@/components/MkLiveStreamCard.vue';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const fetching = ref(true);
const streams = ref<Misskey.Endpoints['twitch/live-streams']['res']>([]);

async function fetchStreams() {
	streams.value = await misskeyApi('twitch/live-streams', {});
	fetching.value = false;
}

onMounted(fetchStreams);
onActivated(fetchStreams);

const headerActions = computed(() => [{
	icon: 'ti ti-refresh',
	text: i18n.ts.reload,
	handler: () => {
		fetching.value = true;
		fetchStreams();
	},
}]);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts._twitch.liveStreams,
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
