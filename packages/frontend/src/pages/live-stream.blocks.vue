<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="420"
	:height="560"
	@close="dialog?.close()"
	@closed="emit('closed')"
>
	<template #header>{{ i18n.ts._twitch.manageBlocks }}</template>

	<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px;">
		<MkLoading v-if="fetching"/>
		<div v-else-if="blocks.length === 0" :class="$style.empty">{{ i18n.ts._twitch.noBlockedUsers }}</div>
		<div v-else class="_gaps_s">
			<div v-for="block in blocks" :key="block.id" :class="$style.block" class="_panel">
				<template v-if="block.targetType === 'misskey' && block.targetUser != null">
					<MkAvatar :user="block.targetUser" :class="$style.avatar" link preview/>
					<div :class="$style.name"><MkUserName :user="block.targetUser" :nowrap="true"/></div>
				</template>
				<template v-else-if="block.targetType === 'remote-guest'">
					<i class="ti ti-user" :class="$style.icon"></i>
					<div :class="$style.name">{{ block.targetRemoteGuest != null ? `${block.targetRemoteGuest.username}@${block.targetRemoteGuest.host}` : '?' }}</div>
				</template>
				<template v-else>
					<i class="ti ti-brand-twitch" :class="[$style.icon, $style.twitchIcon]"></i>
					<div :class="$style.name">{{ block.targetTwitch?.displayName ?? block.targetTwitch?.userName ?? '?' }}</div>
				</template>
				<MkButton danger rounded :class="$style.unblockButton" @click="unblock(block)">{{ i18n.ts.unblock }}</MkButton>
			</div>
			<MkButton v-if="hasMore" :class="$style.more" @click="fetchMore">{{ i18n.ts.loadMore }}</MkButton>
		</div>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { ref, useTemplateRef, onMounted } from 'vue';
import * as Misskey from 'misskey-js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkButton from '@/components/MkButton.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';

type Block = Misskey.Endpoints['twitch/streams/blocks/list']['res'][number];

const LIMIT = 30;

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');

const blocks = ref<Block[]>([]);
const fetching = ref(true);
const hasMore = ref(false);

async function fetchInitial() {
	fetching.value = true;
	try {
		const res = await misskeyApi('twitch/streams/blocks/list', { limit: LIMIT });
		blocks.value = res;
		hasMore.value = res.length >= LIMIT;
	} finally {
		fetching.value = false;
	}
}

async function fetchMore() {
	if (blocks.value.length === 0) return;
	const res = await misskeyApi('twitch/streams/blocks/list', {
		limit: LIMIT,
		untilId: blocks.value[blocks.value.length - 1].id,
	});
	blocks.value = [...blocks.value, ...res];
	hasMore.value = res.length >= LIMIT;
}

async function unblock(block: Block) {
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.ts._twitch.unblockConfirm,
	});
	if (canceled) return;

	await os.apiWithDialog('twitch/streams/blocks/delete', { blockId: block.id });
	blocks.value = blocks.value.filter(b => b.id !== block.id);
}

onMounted(() => {
	fetchInitial();
});
</script>

<style lang="scss" module>
.empty {
	opacity: 0.6;
	text-align: center;
	padding: 24px 0;
}

.block {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 10px 14px;
}

.avatar {
	flex-shrink: 0;
	width: 32px;
	height: 32px;
}

.icon {
	flex-shrink: 0;
	width: 32px;
	text-align: center;
	color: var(--MI_THEME-accent);
}

.twitchIcon {
	color: #9146ff; // Twitch ブランドカラー
}

.name {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-weight: bold;
}

.unblockButton {
	flex-shrink: 0;
}

.more {
	margin: 0 auto;
}
</style>
