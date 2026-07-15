<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<XColumn :menu="menu" :column="column" :isStacked="isStacked" :refresher="async () => { await timeline?.reloadTimeline() }">
	<template #header>
		<i class="ti ti-device-tv"></i><span style="margin-left: 8px;">{{ column.name || column.timelineNameCache || i18n.ts._deck._columns.channel }}</span>
		<span v-if="isLive" :class="$style.liveBadge">{{ i18n.ts._liveChannel.liveNow }}</span>
	</template>

	<template v-if="column.channelId">
		<div style="padding: 8px; text-align: center;">
			<MkButton primary gradate rounded inline small @click="post"><i class="ti ti-pencil"></i></MkButton>
		</div>
		<MkStreamingNotesTimeline ref="timeline" src="channel" :channel="column.channelId"/>
	</template>
</XColumn>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, shallowRef, watch, useTemplateRef } from 'vue';
import * as Misskey from 'misskey-js';
import XColumn from './column.vue';
import type { Column } from '@/deck.js';
import type { MenuItem } from '@/types/menu.js';
import type { SoundStore } from '@/preferences/def.js';
import { updateColumn } from '@/deck.js';
import MkStreamingNotesTimeline from '@/components/MkStreamingNotesTimeline.vue';
import MkButton from '@/components/MkButton.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { soundSettingsButton } from '@/ui/deck/tl-note-notification.js';

const props = defineProps<{
	column: Column;
	isStacked: boolean;
}>();

const timeline = useTemplateRef('timeline');
const channel = shallowRef<Misskey.entities.Channel>();
const soundSetting = ref<SoundStore>(props.column.soundSetting ?? { type: null, volume: 1 });

// 配信チャンネル一覧 (未ログインでも取得可能な一覧API)。既存デッキプロファイルが
// 配信チャンネルでない native channelId を保持している場合もあるため、
// 一覧に見つからないケースはフォールバックとして表示だけ継続する (配信中バッジのみ非表示)。
const liveChannels = ref<Misskey.Endpoints['live-channels/list']['res']>([]);
const isLive = computed(() => liveChannels.value.find(c => c.channelId === props.column.channelId)?.isLive ?? false);

async function fetchLiveChannels() {
	liveChannels.value = await misskeyApi('live-channels/list', { limit: 100 });
}

onMounted(() => {
	fetchLiveChannels();

	if (props.column.channelId == null) {
		setChannel();
	} else if (!props.column.name && props.column.channelId) {
		misskeyApi('channels/show', { channelId: props.column.channelId })
			.then(value => updateColumn(props.column.id, { timelineNameCache: value.name }));
	}
});

watch(soundSetting, v => {
	updateColumn(props.column.id, { soundSetting: v });
});

async function setChannel() {
	await fetchLiveChannels();
	const selectable = liveChannels.value.filter(c => c.channelId != null);
	const { canceled, result: chosenChannelId } = await os.select({
		title: i18n.ts.selectChannel,
		items: selectable.map(x => ({
			value: x.channelId as string, label: x.name ?? x.user.username,
		})),
		default: selectable.find(x => x.channelId === props.column.channelId)?.channelId ?? undefined,
	});
	if (canceled || chosenChannelId == null) return;
	const chosenChannel = selectable.find(x => x.channelId === chosenChannelId)!;
	updateColumn(props.column.id, {
		channelId: chosenChannel.channelId!,
		timelineNameCache: chosenChannel.name ?? chosenChannel.user.username,
	});
}

async function post() {
	if (props.column.channelId == null) return;
	if (!channel.value || channel.value.id !== props.column.channelId) {
		channel.value = await misskeyApi('channels/show', {
			channelId: props.column.channelId,
		});
	}

	os.post({
		channel: channel.value,
	});
}

const menu: MenuItem[] = [{
	icon: 'ti ti-pencil',
	text: i18n.ts.selectChannel,
	action: setChannel,
}, {
	icon: 'ti ti-bell',
	text: i18n.ts._deck.newNoteNotificationSettings,
	action: () => soundSettingsButton(soundSetting),
}];
</script>

<style lang="scss" module>
.liveBadge {
	margin-left: 8px;
	padding: 1px 6px;
	border-radius: 4px;
	background: var(--MI_THEME-accent);
	color: #fff;
	font-size: 0.7em;
	font-weight: bold;
}
</style>
