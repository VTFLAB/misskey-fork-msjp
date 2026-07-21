<!--
SPDX-FileCopyrightText: misskey-bsky-integration fork
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs" :hideTitle="true">
	<div class="_spacer" style="--MI_SPACER-min: 0px; --MI_SPACER-max: 0px;">
		<MkLoading v-if="fetching"/>
		<MkResult v-else-if="user == null || session == null || session.isLive" type="notFound"/>
		<div v-else :class="$style.root">
			<div :class="$style.main">
				<div :class="$style.playerContainer">
					<MkArchivePlayer
						v-if="session.authorized"
						ref="playerRef"
						:key="session.streamId"
						:youtubeVideoId="session.youtubeVideoId"
						:recordingGoogleDriveFileId="session.recordingGoogleDriveFileId"
					/>
					<!-- 配信アーカイブの視聴制限 (bsky-fork 独自)。live-stream.watch.vue の restrictedPanel を
					参考にした独立実装 (コンポーネント共有はしない方針、watch.vue 自体は変更しない) -->
					<div v-else :class="$style.restrictedPanel">
						<i class="ti ti-lock" :class="$style.restrictedIcon"></i>
						<template v-if="session.viewRestriction === 'followers'">
							<div :class="$style.restrictedTitle">{{ i18n.ts._liveChannel.archiveRestrictedFollowersTitle }}</div>
							<div :class="$style.restrictedDescription">{{ i18n.ts._liveChannel.archiveRestrictedFollowersDescription }}</div>
							<MkFollowButton v-if="$i != null && $i.id !== user.id" v-model:user="user" :full="true"/>
						</template>
						<template v-else-if="session.viewRestriction === 'password'">
							<div :class="$style.restrictedTitle">{{ i18n.ts._liveChannel.archiveRestrictedPasswordTitle }}</div>
							<div :class="$style.restrictedDescription">{{ i18n.ts._liveChannel.archiveRestrictedPasswordDescription }}</div>
							<form :class="$style.restrictedPasswordForm" @submit.prevent="submitViewPassword">
								<label :class="$style.restrictedPasswordLabel">
									{{ i18n.ts._liveChannel.viewPassword }}
									<input v-model="passwordInput" type="password" :class="$style.restrictedPasswordInput" :placeholder="i18n.ts._liveChannel.viewPasswordPlaceholder" :disabled="passwordSubmitting">
								</label>
								<MkButton primary rounded :disabled="passwordSubmitting || passwordInput === ''" type="submit">{{ i18n.ts._liveChannel.restrictedPasswordSubmit }}</MkButton>
							</form>
							<MkInfo v-if="passwordError" warn>{{ i18n.ts._liveChannel.restrictedPasswordIncorrect }}</MkInfo>
						</template>
						<template v-else-if="session.viewRestriction === 'users'">
							<div :class="$style.restrictedTitle">{{ i18n.ts._liveChannel.archiveRestrictedUsersTitle }}</div>
							<div :class="$style.restrictedDescription">{{ i18n.ts._liveChannel.archiveRestrictedUsersDescription }}</div>
						</template>
					</div>
				</div>
				<div :class="$style.info" class="_panel">
					<MkAvatar :user="user" :class="$style.infoAvatar" link preview/>
					<div :class="$style.infoText">
						<div :class="$style.streamTitle">{{ session.title ?? i18n.ts.archive }}</div>
						<div :class="$style.streamMeta">
							<MkUserName :user="user"/>
							<span v-if="session.startedAt"> · <MkTime :time="session.startedAt" mode="relative"/></span>
						</div>
					</div>
					<!-- 公開取り消し済みアーカイブのオーナー閲覧時のみ表示するバッジ (bsky-fork 独自)。
					recordingError 等と同じくオーナー本人にしか値が入らない owner-only フィールド -->
					<span v-if="isOwner && session.archiveUnpublished" :class="$style.unpublishedBadge">
						<i class="ti ti-eye-off"></i> {{ i18n.ts._liveChannel.archiveUnpublishedBadge }}
					</span>
					<!-- 視聴者含む全ユーザーが任意にページを再取得できるようにする (live-stream.watch.vue と
					同じ考え方)。フォロー制限で「フォロー後に視聴を再確認する」手段が他に無いため必須 -->
					<button class="_button" :class="$style.reloadButton" :title="i18n.ts.reload" :aria-label="i18n.ts.reload" @click="fetchArchive">
						<i class="ti ti-refresh"></i>
					</button>
				</div>
			</div>
			<div v-if="session.authorized" :class="$style.side">
				<XArchiveCommentReplay
					:key="session.streamId"
					:streamId="session.streamId"
					:streamStartedAt="session.startedAt ?? ''"
					:mode="session.youtubeVideoId != null ? 'youtube-sync' : 'static'"
					:currentTime="currentTime"
					:archiveViewToken="archiveViewToken"
					@seek="onSeek"
				/>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import * as Misskey from 'misskey-js';
import MkFollowButton from '@/components/MkFollowButton.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkArchivePlayer from '@/components/MkArchivePlayer.vue';
import XArchiveCommentReplay from '@/pages/live-stream.archive-comment-replay.vue';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const props = defineProps<{
	acct: string;
	streamId: string;
}>();

type StreamsShowRes = Misskey.Endpoints['twitch/streams/show']['res'];
type SessionEntry = StreamsShowRes['sessions'][number];

const fetching = ref(true);
const user = ref<Misskey.entities.UserDetailed | null>(null);
const streamsInfo = ref<StreamsShowRes | null>(null);
// password モード解錠済みトークン (bsky-fork 独自)。ライブ用 viewToken とは別の Redis キー空間
// (archive:viewtoken:<token>) を使うサーバー側実装に対応する専用の保持先
const archiveViewToken = ref<string | null>(null);
const passwordInput = ref('');
const passwordSubmitting = ref(false);
const passwordError = ref(false);
// mode:'youtube-sync' のときだけ意味を持つ、ポーリングで取得した現在の再生位置 (秒)
const currentTime = ref<number | null>(null);

const session = computed<SessionEntry | null>(() => streamsInfo.value?.sessions.find(s => s.streamId === props.streamId) ?? null);
const isOwner = computed(() => $i != null && user.value != null && $i.id === user.value.id);

// アーカイブ視聴制限のトークン保持 (bsky-fork 独自)。live-stream.watch.vue の
// viewTokenStorageKey パターンを踏襲するが、キー空間は streamId 単位でライブ用 viewToken とは別
function viewTokenStorageKey(streamId: string): string {
	return `archiveViewToken:${streamId}`;
}

function loadStoredArchiveViewToken(streamId: string): string | null {
	try {
		return sessionStorage.getItem(viewTokenStorageKey(streamId));
	} catch {
		return null;
	}
}

function saveStoredArchiveViewToken(streamId: string, token: string) {
	try {
		sessionStorage.setItem(viewTokenStorageKey(streamId), token);
	} catch {
		// sessionStorage が使えない環境 (プライベートモード等) では保持を諦める
	}
}

function clearStoredArchiveViewToken(streamId: string) {
	try {
		sessionStorage.removeItem(viewTokenStorageKey(streamId));
	} catch {
		// noop
	}
}

let pollTimer: number | undefined;

function stopPolling() {
	if (pollTimer != null) {
		window.clearInterval(pollTimer);
		pollTimer = undefined;
	}
}

// YouTube 同期リプレイのときだけ再生位置をポーリングする (bsky-fork 独自)。Drive 視聴
// (mode: 'static') は MkArchivePlayer.getCurrentTime() が常に null を返し無意味なため、
// タイマー自体を回さない (CPU の無駄遣いを避ける)
function setupPolling() {
	stopPolling();
	const s = session.value;
	if (s == null || !s.authorized || s.youtubeVideoId == null) return;
	pollTimer = window.setInterval(() => {
		currentTime.value = playerRef.value?.getCurrentTime() ?? null;
	}, 1000);
}

async function fetchArchive() {
	fetching.value = true;
	user.value = null;
	streamsInfo.value = null;
	passwordError.value = false;
	currentTime.value = null;
	archiveViewToken.value = loadStoredArchiveViewToken(props.streamId);
	try {
		const { username, host } = Misskey.acct.parse(props.acct);
		const fetchedUser = await misskeyApi('users/show', { username, host: host ?? undefined });
		user.value = fetchedUser;
		const info = await misskeyApi('twitch/streams/show', {
			userId: fetchedUser.id,
			archiveViewToken: archiveViewToken.value ?? undefined,
		});
		streamsInfo.value = info;
		const found = info.sessions.find(s => s.streamId === props.streamId);
		// 保持していたトークンが失効 (パスワード変更等) していた場合は掃除して、次回以降クリーンな
		// 状態から再入力させる (live-stream.watch.vue の reload() と同じ防御パターン)
		if (archiveViewToken.value != null && found != null && !found.authorized && found.viewRestriction === 'password') {
			clearStoredArchiveViewToken(props.streamId);
			archiveViewToken.value = null;
		}
	} catch {
		// ユーザー不明 → notFound 相当 (live-stream.watch.vue の reload() と同じ)
	} finally {
		fetching.value = false;
		setupPolling();
	}
}

// パスワード視聴制限 (bsky-fork 独自)。verify-archive-view-password で viewToken を取得し、
// それを付けて twitch/streams/show のみ再取得する (live-stream.watch.vue の submitViewPassword()
// と同型フローの独立実装)
async function submitViewPassword() {
	if (user.value == null || passwordInput.value === '') return;
	passwordSubmitting.value = true;
	passwordError.value = false;
	try {
		const res = await misskeyApi('twitch/streams/verify-archive-view-password', {
			streamId: props.streamId,
			password: passwordInput.value,
		});
		archiveViewToken.value = res.viewToken;
		saveStoredArchiveViewToken(props.streamId, res.viewToken);
		passwordInput.value = '';
		streamsInfo.value = await misskeyApi('twitch/streams/show', {
			userId: user.value.id,
			archiveViewToken: archiveViewToken.value,
		}).catch(() => null);
	} catch {
		passwordError.value = true;
	} finally {
		passwordSubmitting.value = false;
		setupPolling();
	}
}

const playerRef = useTemplateRef('playerRef');

function onSeek(seconds: number) {
	playerRef.value?.seekTo(seconds);
}

// ルートコンポーネントインスタンスが使い回される (別アーカイブへの遷移で再マウントされない)
// 場合に備え、live-stream.watch.vue の watch(() => props.acct, reload) と同じ再取得トリガーを持つ
watch(() => [props.acct, props.streamId], fetchArchive);

onMounted(() => {
	fetchArchive();
});

onBeforeUnmount(() => {
	stopPolling();
});

const headerActions = computed(() => []);
const headerTabs = computed(() => []);

definePage(() => ({
	title: session.value?.title ?? i18n.ts.archive,
	icon: 'ti ti-movie',
	// watch ページと同じく常にデッキ UI の「デッキへ戻る」バナーを隠す
	hideDeckNav: true,
	// スマホのグローバルボトムナビは視聴の邪魔になるため非表示にする
	hideMobileFooter: true,
}));
</script>

<style lang="scss" module>
.root {
	display: flex;
	gap: 12px;
	align-items: flex-start;
	// live-stream.watch.vue と同じ考え方 (100dvh ではなく 100cqh 基準)。詳細は同ファイルの
	// コメントを参照。ただしこちらは .main を stretch させず、.side (コメント欄) だけが
	// この高さいっぱいに広がる (プレイヤーは aspect-ratio 固定のため .main を stretch しても
	// 埋まらず、余白ができてしまうため)
	height: 100cqh;
	min-height: 480px;
}

.main {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.playerContainer {
	border-radius: var(--MI-radius);
	overflow: clip;
}

.restrictedPanel {
	width: 100%;
	aspect-ratio: 16 / 9;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 8px;
	padding: 24px;
	// 動画プレイヤー領域のプレースホルダーとして、テーマに関わらず常に黒背景+白文字にする
	// (live-stream.watch.vue の restrictedPanel と同じ意図的な例外。動画プレイヤー自体が
	// ライト/ダークテーマの影響を受けない黒背景で描画されるため、その代替パネルも合わせる)
	background: #000;
	color: #fff;
	text-align: center;
}

.restrictedIcon {
	font-size: 2em;
	opacity: 0.8;
}

.restrictedTitle {
	font-weight: bold;
	font-size: 1.1em;
}

.restrictedDescription {
	opacity: 0.85;
	max-width: 420px;
}

.restrictedPasswordForm {
	display: flex;
	align-items: flex-end;
	gap: 8px;
	margin-top: 8px;
}

.restrictedPasswordLabel {
	display: flex;
	flex-direction: column;
	gap: 4px;
	font-size: 0.9em;
	text-align: left;
}

.restrictedPasswordInput {
	padding: 8px 10px;
	border-radius: var(--MI-radius);
	border: solid 1px var(--MI_THEME-divider);
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fg);
}

.info {
	flex-shrink: 0;
	display: flex;
	gap: 10px;
	align-items: center;
	padding: 12px;
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

.unpublishedBadge {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 2px 8px;
	font-size: 0.8em;
	border-radius: 999px;
	background: var(--MI_THEME-infoWarnBg);
	color: var(--MI_THEME-infoWarnFg);
	white-space: nowrap;
}

.reloadButton {
	flex-shrink: 0;
	width: 36px;
	height: 36px;
	border: solid 1px var(--MI_THEME-divider);
	border-radius: 999px;

	&:hover {
		color: var(--MI_THEME-accent);
		border-color: var(--MI_THEME-accent);
	}
}

.side {
	flex-shrink: 0;
	width: 360px;
	height: 100%;
	min-height: 0;
}

// スマホ / 縦画面相当の狭いペイン。live-stream.watch.vue と同じ container query 基準
// (aspect-ratio 評価のため _pageContainer まで遡って解決される) を踏襲する
@container (max-width: 700px) or (aspect-ratio < 1/1) {
	.root {
		flex-direction: column;
		align-items: stretch;
		min-height: 0;
	}

	.main {
		flex: none;
	}

	.side {
		width: 100%;
		height: auto;
		flex: 1;
		min-height: 0;
	}
}
</style>
