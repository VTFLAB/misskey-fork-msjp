<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<div v-for="comment in comments" :key="comment.id" :class="$style.comment">
		<span :class="[$style.name, nameClass(comment)]">{{ commentName(comment) }}</span>
		<span :class="$style.text">
			<template v-if="comment.source === 'twitch'">
				<template v-for="(frag, fi) in twitchFragments(comment)" :key="fi">
					<img v-if="frag.type === 'emote'" :src="twitchEmoteUrl(frag.emoteId, frag.animated)" :alt="frag.text" :class="$style.twitchEmote"/>
					<template v-else>{{ frag.text }}</template>
				</template>
			</template>
			<Mfm v-else-if="comment.text" :text="comment.text" :plain="true"/>
		</span>
	</div>
</div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onUnmounted, nextTick, useCssModule } from 'vue';
import * as Misskey from 'misskey-js';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { useStream } from '@/stream.js';
import { prefer } from '@/preferences.js';

// OBS のブラウザソースに貼る前提の、コメント表示だけの公開オーバーレイページ。
// 認証・入力欄・ヘッダーなど表示以外の機能は持たない。背景は透過し、配信画面に
// そのまま重ねられる。オフライン時は何も表示せず、配信開始を定期ポーリングで待つ
// (OBS 側で貼りっぱなしにできるように、配信終了→再開を自動で追従する)

type Comment = Misskey.Endpoints['twitch/streams/comments']['res'][number];

const MAX_COMMENTS = 30;
const OFFLINE_POLL_INTERVAL = 60 * 1000;

const props = defineProps<{
	acct: string;
}>();

const comments = ref<Comment[]>([]);

const stream = useStream();
let connection: Misskey.IChannelConnection<Misskey.Channels['twitchLiveStream']> | null = null;
let pollTimer: number | null = null;
let unmounted = false;

type TwitchFragment = NonNullable<Comment['fragments']>[number];

function twitchFragments(comment: Comment): TwitchFragment[] {
	return comment.fragments ?? [{ type: 'text', text: comment.text }];
}

// live-stream.chat.vue と同じ Twitch CDN (公開・認証不要)
function twitchEmoteUrl(emoteId: string | undefined, animated: boolean | undefined): string {
	if (emoteId == null) return '';
	const format = animated && !prefer.s.disableShowingAnimatedImages ? 'animated' : 'static';
	return `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(emoteId)}/${format}/dark/2.0`;
}

function commentName(comment: Comment): string {
	if (comment.source === 'misskey') return comment.user?.name ?? comment.user?.username ?? '?';
	if (comment.source === 'remote-guest') return comment.remoteGuest != null ? `${comment.remoteGuest.username}@${comment.remoteGuest.host}` : '?';
	return comment.twitchDisplayName ?? comment.twitchUserName ?? '?';
}

const style = useCssModule();

function nameClass(comment: Comment): string {
	if (comment.source === 'misskey') return style.nameMisskey;
	if (comment.source === 'remote-guest') return style.nameRemoteGuest;
	return style.nameTwitch;
}

function scrollToBottom() {
	nextTick(() => {
		window.document.scrollingElement?.scrollTo(0, window.document.scrollingElement.scrollHeight);
	});
}

function onComment(comment: Comment) {
	if (comments.value.some(c => c.id === comment.id)) return;
	comments.value.push(comment);
	if (comments.value.length > MAX_COMMENTS) {
		comments.value = comments.value.slice(-MAX_COMMENTS);
	}
	scrollToBottom();
}

async function connect() {
	try {
		const { username, host } = Misskey.acct.parse(props.acct);
		const user = await misskeyApi('users/show', { username, host: host ?? undefined });
		const twitchInfo = await misskeyApi('twitch/streams/show', { userId: user.id });
		if (unmounted) return;
		if (twitchInfo.stream == null) {
			schedulePoll();
			return;
		}

		const streamId = twitchInfo.stream.id;
		const initialComments = await misskeyApi('twitch/streams/comments', { streamId, limit: MAX_COMMENTS });
		if (unmounted) return;
		comments.value = initialComments.reverse();
		scrollToBottom();

		connection = stream.useChannel('twitchLiveStream', { streamId });
		connection.on('comment', onComment);
		connection.on('streamEnded', () => {
			disconnect();
			comments.value = [];
			schedulePoll();
		});
	} catch {
		// ユーザー不明・未連携・一時的な取得失敗はいずれもポーリングで再試行する
		schedulePoll();
	}
}

function disconnect() {
	if (connection != null) {
		connection.dispose();
		connection = null;
	}
}

function schedulePoll() {
	if (unmounted) return;
	if (pollTimer != null) window.clearTimeout(pollTimer);
	pollTimer = window.setTimeout(() => {
		pollTimer = null;
		connect();
	}, OFFLINE_POLL_INTERVAL);
}

// OBS で配信画面に重ねるため、テーマ由来のページ背景を透過させる。
// html 要素の背景 (style.scss で --MI_THEME-bg が張られる) を上書きし、離脱時に戻す
let prevHtmlBackground: string | null = null;

onMounted(() => {
	prevHtmlBackground = window.document.documentElement.style.background;
	window.document.documentElement.style.setProperty('background', 'transparent', 'important');
	connect();
});

onUnmounted(() => {
	unmounted = true;
	disconnect();
	if (pollTimer != null) window.clearTimeout(pollTimer);
	window.document.documentElement.style.background = prevHtmlBackground ?? '';
});

definePage(() => ({
	title: i18n.ts._twitch.liveStreams,
	icon: 'ti ti-broadcast',
	hideDeckNav: true,
}));
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	justify-content: flex-end;
	gap: 6px;
	box-sizing: border-box;
	min-height: 100cqh;
	padding: 12px;
	overflow: hidden;
	font-size: 1.1em;
	line-height: 1.5;
	// テーマに依存せず配信画面上で読めるよう固定色 + 縁取り
	color: #fff;
	text-shadow: 0 0 3px #000, 0 1px 2px #000, 1px 0 2px #000, -1px 0 2px #000;
}

.comment {
	overflow-wrap: anywhere;
	animation: overlay-comment-in 0.15s ease-out;
}

@keyframes overlay-comment-in {
	from {
		opacity: 0;
		transform: translateY(6px);
	}

	to {
		opacity: 1;
		transform: none;
	}
}

.name {
	font-weight: bold;
	margin-right: 8px;
}

.nameMisskey {
	color: #86b300;
}

.nameTwitch {
	color: #bf94ff;
}

.nameRemoteGuest {
	color: #7cc7ff;
}

.text {
	white-space: pre-wrap;
}

.twitchEmote {
	height: 1.6em;
	vertical-align: middle;
	margin: -2px 3px;
}
</style>
