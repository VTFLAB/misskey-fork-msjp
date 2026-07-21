<!--
SPDX-FileCopyrightText: misskey-bsky-integration fork
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<div :class="$style.toolbar">
		<button
			class="_button"
			:class="[$style.translationToggle, { [$style.translationToggleActive]: twitchTranslationDisplaySettings.showTranslation }]"
			:aria-pressed="twitchTranslationDisplaySettings.showTranslation"
			:title="i18n.ts._twitch.showTranslationDescription"
			:aria-label="i18n.ts._twitch.showTranslation"
			@click="twitchTranslationDisplaySettings.showTranslation = !twitchTranslationDisplaySettings.showTranslation"
		>
			<i class="ti ti-language"></i> {{ i18n.ts._twitch.showTranslation }}
		</button>
	</div>

	<div v-if="mode === 'static'" :class="$style.notice">
		<i class="ti ti-info-circle"></i> {{ i18n.ts._liveChannel.archiveCommentReplayStaticNotice }}
	</div>

	<div :class="$style.list">
		<MkLoading v-if="fetching"/>
		<div v-else-if="visibleComments.length === 0" :class="$style.empty">{{ i18n.ts._twitch.noComments }}</div>
		<template v-else>
			<div v-for="comment in visibleComments" :key="comment.id" :class="$style.comment">
				<template v-if="comment.source === 'misskey' && comment.user != null">
					<MkAvatar :user="comment.user" :class="$style.avatar" link preview/>
					<div :class="$style.commentBody">
						<div>
							<span :class="$style.commentName"><MkUserName :user="comment.user" :nowrap="true"/></span>
							<component :is="mode === 'youtube-sync' ? 'button' : 'time'" :class="[$style.commentTime, { [$style.commentTimeSeekable]: mode === 'youtube-sync' }]" v-bind="timeAttrs(comment)">{{ formatTime(comment.createdAt) }}</component>
						</div>
						<Mfm v-if="comment.text" :class="$style.commentText" :text="comment.text" :author="comment.user" :i="$i"/>
						<MkMediaList v-if="comment.files.length > 0" :class="$style.commentFiles" :mediaList="comment.files"/>
						<div v-if="twitchTranslationDisplaySettings.showTranslation && comment.translatedText" :class="$style.translation">
							<span :class="$style.translationText">{{ comment.translatedText }}</span>
						</div>
					</div>
				</template>
				<template v-else-if="comment.source === 'remote-guest'">
					<img v-if="comment.remoteGuest?.avatarUrl" :src="comment.remoteGuest.avatarUrl" :class="$style.remoteGuestAvatar" alt=""/>
					<i v-else class="ti ti-user" :class="$style.remoteGuestIcon"></i>
					<div :class="$style.commentBody">
						<div>
							<span :class="$style.commentName">{{ comment.remoteGuest != null ? `${comment.remoteGuest.username}@${comment.remoteGuest.host}` : '?' }}</span>
							<component :is="mode === 'youtube-sync' ? 'button' : 'time'" :class="[$style.commentTime, { [$style.commentTimeSeekable]: mode === 'youtube-sync' }]" v-bind="timeAttrs(comment)">{{ formatTime(comment.createdAt) }}</component>
						</div>
						<Mfm v-if="comment.text" :class="$style.commentText" :text="comment.text"/>
						<div v-if="twitchTranslationDisplaySettings.showTranslation && comment.translatedText" :class="$style.translation">
							<span :class="$style.translationText">{{ comment.translatedText }}</span>
						</div>
					</div>
				</template>
				<template v-else>
					<i class="ti ti-brand-twitch" :class="$style.twitchIcon"></i>
					<div :class="$style.commentBody">
						<div>
							<span :class="$style.commentName">{{ comment.twitchDisplayName ?? comment.twitchUserName ?? '?' }}</span>
							<component :is="mode === 'youtube-sync' ? 'button' : 'time'" :class="[$style.commentTime, { [$style.commentTimeSeekable]: mode === 'youtube-sync' }]" v-bind="timeAttrs(comment)">{{ formatTime(comment.createdAt) }}</component>
						</div>
						<span :class="$style.commentText">
							<template v-for="(frag, fi) in twitchFragments(comment)" :key="fi">
								<img v-if="frag.type === 'emote'" :src="twitchEmoteUrl(frag.emoteId, frag.animated)" :alt="frag.text" :title="frag.text" :class="$style.twitchEmote"/>
								<template v-else>{{ frag.text }}</template>
							</template>
						</span>
						<div v-if="twitchTranslationDisplaySettings.showTranslation && comment.translatedText" :class="$style.translation">
							<span :class="$style.translationText">{{ comment.translatedText }}</span>
						</div>
					</div>
				</template>
			</div>
		</template>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import { versatileLang, dateTimeFormat } from '@@/js/intl-const.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import MkAvatar from '@/components/global/MkAvatar.vue';
import MkUserName from '@/components/global/MkUserName.vue';
import MkLoading from '@/components/global/MkLoading.vue';
import MkMediaList from '@/components/MkMediaList.vue';
import { prefer } from '@/preferences.js';
import { twitchTranslationDisplaySettings } from '@/composables/use-twitch-translation-display.js';

type Comment = Misskey.Endpoints['twitch/streams/comments']['res'][number];
type ReplayComment = Comment & { offsetSec: number };

const props = defineProps<{
	streamId: string;
	streamStartedAt: string;
	mode: 'youtube-sync' | 'static';
	// mode === 'youtube-sync' のときのみ意味を持つ、親からポーリングされた再生位置 (秒)
	currentTime?: number | null;
	// password モード解錠済みトークン
	archiveViewToken?: string | null;
}>();

const emit = defineEmits<{
	(ev: 'seek', seconds: number): void;
}>();

const comments = ref<ReplayComment[]>([]);
const fetching = ref(true);

// youtube-sync: 現在の再生位置以前のコメントだけを表示する。currentTime の更新のたびに
// 再計算されるため、シーク・巻き戻しにも自動的に追従する。static (Drive): 全件を時系列表示する
const visibleComments = computed<ReplayComment[]>(() => {
	if (props.mode === 'static') return comments.value;
	const t = props.currentTime ?? -Infinity;
	return comments.value.filter(c => c.offsetSec <= t);
});

// live-stream.chat.vue (XChat) と同じ HH:mm 表記 + ホバーでフル日時 (bsky-fork 独自、
// 読み取り専用のアーカイブリプレイ用に複製。共有化はしない方針)
let _timeFormat: Intl.DateTimeFormat;
try {
	_timeFormat = new Intl.DateTimeFormat(versatileLang, { hour: '2-digit', minute: '2-digit' });
} catch {
	_timeFormat = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatTime(time: string): string {
	return _timeFormat.format(new Date(time));
}

function formatTimeFull(time: string): string {
	return dateTimeFormat.format(new Date(time));
}

type TwitchFragment = NonNullable<Comment['fragments']>[number];

// fragments が取得できていない (旧データ・パース失敗等) 場合は全文を text 扱いにフォールバックする
function twitchFragments(comment: Comment): TwitchFragment[] {
	return comment.fragments ?? [{ type: 'text', text: comment.text }];
}

// Twitch の絵文字画像 CDN (公開・認証不要)。XChat と同じロジック
function twitchEmoteUrl(emoteId: string | undefined, animated: boolean | undefined): string {
	if (emoteId == null) return '';
	const format = animated && !prefer.s.disableShowingAnimatedImages ? 'animated' : 'static';
	return `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(emoteId)}/${format}/dark/2.0`;
}

// youtube-sync のときだけコメントの時刻をクリック可能な <button> にしシーク要求を emit する。
// static (Drive) では同期再生が技術的に不可能なため通常の <time> のまま (bsky-fork 独自)
function timeAttrs(comment: ReplayComment): Record<string, unknown> {
	if (props.mode === 'youtube-sync') {
		return {
			type: 'button',
			title: i18n.tsx._liveChannel.archiveCommentReplaySeekTo({ time: formatTimeFull(comment.createdAt) }),
			onClick: () => emit('seek', comment.offsetSec),
		};
	}
	return { title: formatTimeFull(comment.createdAt) };
}

// リアルタイム購読は行わず、streamId 単位で全件を一括取得する (bsky-fork 独自)。
// QueryService.makePaginationQuery は sinceId 単独指定時のみ ASC になり、指定無しは常に DESC
// (最新優先) になるため、初回から sinceId 前方ループでは総数が limit を超えた場合に古い分を
// 取りこぼす。そのため XChat.loadOlder() と同じ untilId 逆方向ループ (DESC ページを新しい→
// 古い方向へ連結) を採用し、最後に 1 回だけ反転して時系列 (古い→新しい) に揃える。
let fetchToken = 0;

async function fetchAllComments() {
	const myToken = ++fetchToken;
	fetching.value = true;
	const collected: Comment[] = [];
	let untilId: string | undefined;
	for (;;) {
		const page = await misskeyApi('twitch/streams/comments', {
			streamId: props.streamId,
			archiveViewToken: props.archiveViewToken ?? undefined,
			limit: 100,
			untilId,
		});
		// 取得中に streamId/archiveViewToken が変わっていたら破棄する (新しいリクエストに任せる)
		if (myToken !== fetchToken) return;
		if (page.length === 0) break;
		collected.push(...page);
		untilId = page[page.length - 1].id;
		if (page.length < 100) break;
	}
	comments.value = collected.reverse().map(c => ({
		...c,
		offsetSec: (new Date(c.createdAt).getTime() - new Date(props.streamStartedAt).getTime()) / 1000,
	}));
	fetching.value = false;
}

watch([() => props.streamId, () => props.archiveViewToken], fetchAllComments, { immediate: true });
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

.toolbar {
	flex-shrink: 0;
	display: flex;
	justify-content: flex-end;
	padding: 4px 8px;
	border-bottom: solid 0.5px var(--MI_THEME-divider);
}

.translationToggle {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 2px 8px;
	font-size: 0.85em;
	border-radius: 999px;
	opacity: 0.7;

	&:hover {
		opacity: 1;
	}
}

.translationToggleActive {
	opacity: 1;
	color: var(--MI_THEME-accent);
}

.notice {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 8px 12px;
	font-size: 0.85em;
	opacity: 0.8;
	border-bottom: solid 0.5px var(--MI_THEME-divider);
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

.remoteGuestIcon {
	flex-shrink: 0;
	width: 24px;
	text-align: center;
	color: var(--MI_THEME-accent);
}

.remoteGuestAvatar {
	flex-shrink: 0;
	width: 24px;
	height: 24px;
	border-radius: 100%;
	object-fit: cover;
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

.commentTime {
	display: inline-block;
	border: none;
	background: none;
	padding: 0;
	margin: 0;
	font: inherit;
	color: inherit;
	font-size: 0.85em;
	opacity: 0.6;
}

.commentTimeSeekable {
	cursor: pointer;

	&:hover {
		opacity: 1;
		color: var(--MI_THEME-accent);
		text-decoration: underline;
	}
}

.commentText {
	white-space: pre-wrap;
}

// 原文の下に「区切り + 翻訳文」の2段表示を作る (XChat と同じ考え方)
.translation {
	margin-top: 4px;
	padding-top: 4px;
	border-top: solid 0.5px var(--MI_THEME-divider);
}

.translationText {
	display: block;
	opacity: 0.85;
	white-space: pre-wrap;
}

.twitchEmote {
	height: 1.6em;
	vertical-align: middle;
	margin: -2px 3px;
}

.commentFiles {
	margin-top: 4px;
	max-width: 260px;
}

.empty {
	opacity: 0.6;
	text-align: center;
	padding: 24px 0;
}
</style>
