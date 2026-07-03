<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 1400px; --MI_SPACER-min: 0px; --MI_SPACER-max: 12px;">
		<MkLoading v-if="fetching"/>
		<MkResult v-else-if="user == null || twitchInfo == null" type="notFound"/>
		<div v-else-if="streamInfo == null" class="_gaps" :class="$style.offline">
			<MkAvatar :user="user" :class="$style.offlineAvatar" link preview/>
			<MkUserName :user="user" :class="$style.offlineName"/>
			<div>{{ i18n.ts._twitch.streamOffline }}</div>
			<MkButton @click="reload">{{ i18n.ts.reload }}</MkButton>
		</div>
		<div v-else ref="rootEl" :class="[$style.watch, { [$style.narrow]: narrow }]">
			<div :class="$style.main">
				<div :class="$style.playerContainer">
					<!-- KeepAlive でページがキャッシュされても再生が続かないよう deactivate 中は iframe を落とす -->
					<iframe
						v-if="playerActive"
						:src="playerUrl"
						:class="$style.player"
						allowfullscreen
						allow="autoplay; fullscreen"
					></iframe>
				</div>
				<div :class="$style.info" class="_panel">
					<div :class="$style.infoHeader">
						<MkAvatar :user="user" :class="$style.infoAvatar" link preview/>
						<div :class="$style.infoText">
							<div :class="$style.streamTitle">{{ streamInfo.title }}</div>
							<div :class="$style.streamMeta">
								<MkUserName :user="user"/>
								<span v-if="streamInfo.gameName"> · {{ streamInfo.gameName }}</span>
								<span> · <i class="ti ti-eye"></i> {{ number(streamInfo.viewerCount) }}</span>
								<span> · <MkTime :time="streamInfo.startedAt" mode="relative"/></span>
							</div>
						</div>
						<MkFollowButton v-if="$i != null && $i.id !== user.id" v-model:user="user" :inline="true" :transparent="false" :full="true"/>
					</div>
				</div>
			</div>
			<div :class="$style.chat">
				<XChat :key="streamInfo.id" :streamId="streamInfo.id" :live="true" @streamEnded="onStreamEnded"/>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, ref, watch, useTemplateRef, onMounted, onUnmounted, onActivated, onDeactivated } from 'vue';
import * as Misskey from 'misskey-js';
import { hostname } from '@@/js/config.js';
import XChat from '@/pages/live-stream.chat.vue';
import MkButton from '@/components/MkButton.vue';
import MkFollowButton from '@/components/MkFollowButton.vue';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import number from '@/filters/number.js';

const props = defineProps<{
	acct: string;
}>();

const fetching = ref(true);
const user = ref<Misskey.entities.UserDetailed | null>(null);
const twitchInfo = ref<Misskey.Endpoints['twitch/streams/show']['res'] | null>(null);

const streamInfo = computed(() => twitchInfo.value?.stream ?? null);

const playerUrl = computed(() => {
	if (twitchInfo.value == null) return '';
	const url = new URL('https://player.twitch.tv/');
	url.searchParams.set('channel', twitchInfo.value.twitchLogin);
	url.searchParams.set('parent', hostname);
	url.searchParams.set('autoplay', 'true');
	return url.toString();
});

const rootEl = useTemplateRef('rootEl');
const narrow = ref(window.innerWidth < 1000);
let ro: ResizeObserver | null = null;

async function reload() {
	fetching.value = true;
	user.value = null;
	twitchInfo.value = null;
	try {
		const { username, host } = Misskey.acct.parse(props.acct);
		const fetchedUser = await misskeyApi('users/show', { username, host: host ?? undefined });
		user.value = fetchedUser;
		twitchInfo.value = await misskeyApi('twitch/streams/show', { userId: fetchedUser.id });
	} catch {
		// user 不明 / 未連携 → not found 表示
	} finally {
		fetching.value = false;
	}
}

function onStreamEnded() {
	os.alert({ type: 'info', text: i18n.ts._twitch.streamEnded });
	reload();
}

watch(() => props.acct, reload);

onMounted(() => {
	reload();
	ro = new ResizeObserver(() => {
		narrow.value = window.innerWidth < 1000;
	});
	ro.observe(window.document.body);
});

onUnmounted(() => {
	ro?.disconnect();
});

const playerActive = ref(true);
onActivated(() => {
	playerActive.value = true;
});
onDeactivated(() => {
	playerActive.value = false;
});

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: twitchInfo.value?.stream?.title ?? i18n.ts._twitch.liveStreams,
	icon: 'ti ti-broadcast',
}));
</script>

<style lang="scss" module>
.offline {
	text-align: center;
	padding: 48px 12px;
}

.offlineAvatar {
	width: 84px;
	height: 84px;
	margin: 0 auto;
}

.offlineName {
	font-weight: bold;
	font-size: 1.1em;
}

.watch {
	display: flex;
	gap: 12px;
	align-items: stretch;
	// PC: チャットをビューポート内に固定しつつプレイヤーと並べる
	height: calc(100dvh - 140px);
	min-height: 480px;
}

.main {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 12px;
	overflow-y: auto;
}

.playerContainer {
	aspect-ratio: 16 / 9;
	background: #000;
	border-radius: var(--MI-radius);
	overflow: clip;
}

.player {
	width: 100%;
	height: 100%;
	border: none;
	display: block;
}

.info {
	padding: 12px;
}

.infoHeader {
	display: flex;
	gap: 10px;
	align-items: center;
}

.infoAvatar {
	flex-shrink: 0;
	width: 48px;
	height: 48px;
}

.infoText {
	flex: 1;
	min-width: 0;
}

.streamTitle {
	font-weight: bold;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.streamMeta {
	font-size: 0.9em;
	opacity: 0.8;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.chat {
	flex-shrink: 0;
	width: 360px;
	min-height: 0;
}

// スマホ / 縦画面: プレイヤー上部・チャット下部の縦積みに切り替え
.narrow {
	flex-direction: column;
	height: auto;

	.main {
		flex: none;
		overflow-y: visible;
	}

	.chat {
		width: 100%;
		height: 60dvh;
		min-height: 320px;
	}
}
</style>
