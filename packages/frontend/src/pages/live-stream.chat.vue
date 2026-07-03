<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<div ref="listEl" :class="$style.list">
		<button v-if="hasOlder" class="_button" :class="$style.loadOlder" :disabled="loadingOlder" @click="loadOlder">
			{{ i18n.ts.loadMore }}
		</button>
		<div v-for="comment in comments" :key="comment.id" :class="$style.comment">
			<template v-if="comment.source === 'misskey' && comment.user != null">
				<MkAvatar :user="comment.user" :class="$style.avatar" link preview/>
				<div :class="$style.commentBody">
					<span :class="$style.commentName"><MkUserName :user="comment.user" :nowrap="true"/></span>
					<span :class="$style.commentText">{{ comment.text }}</span>
				</div>
			</template>
			<template v-else>
				<i class="ti ti-brand-twitch" :class="$style.twitchIcon"></i>
				<div :class="$style.commentBody">
					<span :class="$style.commentName">{{ comment.twitchDisplayName ?? comment.twitchUserName ?? '?' }}</span>
					<span :class="$style.commentText">{{ comment.text }}</span>
				</div>
			</template>
		</div>
		<div v-if="comments.length === 0 && !fetching" :class="$style.empty">{{ i18n.ts._twitch.noComments }}</div>
	</div>
	<div v-if="$i != null && live" :class="$style.form">
		<input
			v-model="text"
			:class="$style.input"
			type="text"
			:placeholder="i18n.ts._twitch.commentPlaceholder"
			:aria-label="i18n.ts._twitch.commentPlaceholder"
			maxlength="500"
			:disabled="sending"
			@keydown="onKeydown"
		>
		<button class="_button" :class="$style.sendButton" :disabled="sending || text.trim().length === 0" :aria-label="i18n.ts.send" @click="send">
			<i class="ti ti-send"></i>
		</button>
	</div>
</div>
</template>

<script lang="ts" setup>
import { ref, useTemplateRef, onMounted, onUnmounted, nextTick } from 'vue';
import * as Misskey from 'misskey-js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { useStream } from '@/stream.js';

type Comment = Misskey.Endpoints['twitch/streams/comments']['res'][number];

const props = defineProps<{
	streamId: string;
	live: boolean;
}>();

const emit = defineEmits<{
	(ev: 'streamEnded'): void;
}>();

const comments = ref<Comment[]>([]);
const fetching = ref(true);
const hasOlder = ref(false);
const loadingOlder = ref(false);
const text = ref('');
const sending = ref(false);
const listEl = useTemplateRef('listEl');

const stream = useStream();
let connection: Misskey.IChannelConnection<Misskey.Channels['twitchLiveStream']> | null = null;

function scrollToBottom() {
	nextTick(() => {
		if (listEl.value != null) {
			listEl.value.scrollTop = listEl.value.scrollHeight;
		}
	});
}

function isNearBottom(): boolean {
	if (listEl.value == null) return true;
	return listEl.value.scrollHeight - listEl.value.scrollTop - listEl.value.clientHeight < 120;
}

async function fetchInitial() {
	try {
		const res = await misskeyApi('twitch/streams/comments', {
			streamId: props.streamId,
			limit: 30,
		});
		// API は新しい順で返すので表示用に反転する
		comments.value = res.reverse();
		hasOlder.value = res.length >= 30;
		scrollToBottom();
	} finally {
		fetching.value = false;
	}
}

async function loadOlder() {
	if (comments.value.length === 0) return;
	loadingOlder.value = true;
	try {
		const res = await misskeyApi('twitch/streams/comments', {
			streamId: props.streamId,
			limit: 30,
			untilId: comments.value[0].id,
		});
		comments.value = [...res.reverse(), ...comments.value];
		hasOlder.value = res.length >= 30;
	} finally {
		loadingOlder.value = false;
	}
}

function onComment(comment: Comment) {
	if (comments.value.some(c => c.id === comment.id)) return;
	const shouldScroll = isNearBottom();
	comments.value.push(comment);
	// メモリ節約: 表示は直近 300 件に制限 (履歴はさかのぼり読み込みで参照可能)
	if (comments.value.length > 300) {
		comments.value = comments.value.slice(-300);
		hasOlder.value = true;
	}
	if (shouldScroll) scrollToBottom();
}

function onKeydown(ev: KeyboardEvent) {
	// IME 変換確定の Enter で送信しないようにガードする (MkInput.vue と同一パターン)
	if (ev.isComposing || ev.key === 'Process' || ev.keyCode === 229) return;
	if (ev.key !== 'Enter') return;
	send();
}

async function send() {
	const t = text.value.trim();
	if (t.length === 0 || sending.value) return;
	sending.value = true;
	try {
		await misskeyApi('twitch/streams/comments/create', {
			streamId: props.streamId,
			text: t,
		});
		text.value = '';
	} catch (err) {
		os.alert({ type: 'error', text: err instanceof Error ? err.message : String(err) });
	} finally {
		sending.value = false;
	}
}

onMounted(() => {
	fetchInitial();
	connection = stream.useChannel('twitchLiveStream', { streamId: props.streamId });
	connection.on('comment', onComment);
	connection.on('streamEnded', () => emit('streamEnded'));
});

onUnmounted(() => {
	if (connection != null) connection.dispose();
});
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	height: 100%;
	min-height: 0;
	background: var(--MI_THEME-panel);
	border-radius: var(--MI-radius);
	overflow: clip;
}

.list {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	padding: 12px;
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.loadOlder {
	padding: 6px;
	text-align: center;
	color: var(--MI_THEME-accent);
}

.comment {
	display: flex;
	gap: 8px;
	align-items: flex-start;
	font-size: 0.92em;
}

.avatar {
	flex-shrink: 0;
	width: 24px;
	height: 24px;
}

.twitchIcon {
	flex-shrink: 0;
	width: 24px;
	text-align: center;
	color: #9146ff; // Twitch ブランドカラー
}

.commentBody {
	min-width: 0;
	overflow-wrap: anywhere;
}

.commentName {
	font-weight: bold;
	margin-right: 6px;
	opacity: 0.9;
}

.commentText {
	white-space: pre-wrap;
}

.empty {
	opacity: 0.6;
	text-align: center;
	padding: 24px 0;
}

.form {
	display: flex;
	gap: 8px;
	padding: 10px;
	border-top: solid 0.5px var(--MI_THEME-divider);
}

.input {
	flex: 1;
	min-width: 0;
	padding: 8px 12px;
	border: solid 1px var(--MI_THEME-divider);
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-bg);
	color: var(--MI_THEME-fg);

	&:focus {
		border-color: var(--MI_THEME-accent);
		outline: none;
	}
}

.sendButton {
	flex-shrink: 0;
	padding: 0 12px;
	color: var(--MI_THEME-accent);

	&:disabled {
		opacity: 0.5;
	}
}
</style>
