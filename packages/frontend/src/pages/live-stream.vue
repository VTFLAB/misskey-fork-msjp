<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs" :hideTitle="true">
	<div class="_spacer" :style="{ '--MI_SPACER-w': '1100px' }">
		<MkLoading v-if="fetching"/>
		<MkResult v-else-if="user == null || channelState === 'none'" type="notFound"/>
		<XChannelHome v-else-if="channelState === 'offline' && channelInfo != null" :user="user" :channel="channelInfo" :isOwner="isOwner" :acct="props.acct"/>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, ref, watch, onMounted } from 'vue';
import * as Misskey from 'misskey-js';
import XChannelHome from '@/pages/live-stream.channel-home.vue';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { useRouter } from '@/router.js';

const props = defineProps<{
	acct: string;
}>();

const router = useRouter();

const fetching = ref(true);
const user = ref<Misskey.entities.UserDetailed | null>(null);
const channelInfo = ref<Misskey.Endpoints['live-channels/show']['res'] | null>(null);
const twitchInfo = ref<Misskey.Endpoints['twitch/streams/show']['res'] | null>(null);

// 自分の配信ページかどうか
const isOwner = computed(() => $i != null && user.value != null && $i.id === user.value.id);

const channelState = computed<'live' | 'offline' | 'none'>(() => {
	if (twitchInfo.value?.stream != null) return 'live';
	// Phase 2 will add sessions[] to twitchInfo; for now stream field is the live signal.
	if (channelInfo.value != null && channelInfo.value.enabled) return 'offline';
	return 'none';
});

async function reload() {
	fetching.value = true;
	user.value = null;
	channelInfo.value = null;
	twitchInfo.value = null;
	try {
		const { username, host } = Misskey.acct.parse(props.acct);
		const fetchedUser = await misskeyApi('users/show', { username, host: host ?? undefined });
		user.value = fetchedUser;
		const [channel, twitch] = await Promise.all([
			misskeyApi('live-channels/show', { userId: fetchedUser.id }).catch(() => null),
			misskeyApi('twitch/streams/show', { userId: fetchedUser.id }).catch(() => null),
		]);
		channelInfo.value = channel;
		twitchInfo.value = twitch;
		// ライブ状態なら視聴ページへ遷移
		if (channelState.value === 'live') {
			router.replace('/live/:acct/stream', { params: { acct: props.acct } });
		}
	} catch {
		// user unknown → not found
	} finally {
		fetching.value = false;
	}
}

watch(() => props.acct, reload);

onMounted(() => {
	reload();
});

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: twitchInfo.value?.stream?.title ?? i18n.ts._twitch.liveStreams,
	icon: 'ti ti-broadcast',
	// チャンネルホームではデッキ UI の「デッキへ戻る」バナーを表示する
	hideDeckNav: false,
}));
</script>
