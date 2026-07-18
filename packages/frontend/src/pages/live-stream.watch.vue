<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs" :hideTitle="true">
	<div class="_spacer" style="--MI_SPACER-min: 0px; --MI_SPACER-max: 0px;">
		<MkLoading v-if="fetching"/>
		<MkResult v-else-if="user == null || streamInfo == null" type="notFound"/>
		<div v-else :class="$style.watch">
			<div :class="$style.main">
				<div :class="$style.playerContainer">
					<MkStreamPlayer
						v-if="activeSession != null && activeSession.authorized"
						:key="activeSession.streamId"
						:source="activeSession.source"
						:playbackUrl="activeSession.playbackUrl"
						:twitchLogin="activeSession.twitchLogin"
						:active="playerActive"
						:pageKey="props.acct"
						:offlineImageUrl="channelInfo?.offlineImageUrl ?? null"
					/>
					<!-- MSJP配信の視聴制限 (bsky-fork 独自)。authorized: false のセッションはプレイヤーの代わりに
					制限内容に応じた案内を表示する。Twitch セッションは常に authorized: true のためここには来ない -->
					<div v-else-if="activeSession != null && !activeSession.authorized" :class="$style.restrictedPanel">
						<i class="ti ti-lock" :class="$style.restrictedIcon"></i>
						<template v-if="activeSession.viewRestriction === 'followers'">
							<div :class="$style.restrictedTitle">{{ i18n.ts._liveChannel.restrictedFollowersTitle }}</div>
							<div :class="$style.restrictedDescription">{{ i18n.ts._liveChannel.restrictedFollowersDescription }}</div>
							<MkFollowButton v-if="$i != null && $i.id !== user.id" v-model:user="user" :full="true"/>
						</template>
						<template v-else-if="activeSession.viewRestriction === 'password'">
							<div :class="$style.restrictedTitle">{{ i18n.ts._liveChannel.restrictedPasswordTitle }}</div>
							<div :class="$style.restrictedDescription">{{ i18n.ts._liveChannel.restrictedPasswordDescription }}</div>
							<form :class="$style.restrictedPasswordForm" @submit.prevent="submitViewPassword">
								<label :class="$style.restrictedPasswordLabel">
									{{ i18n.ts._liveChannel.viewPassword }}
									<input v-model="passwordInput" type="password" :class="$style.restrictedPasswordInput" :placeholder="i18n.ts._liveChannel.viewPasswordPlaceholder" :disabled="passwordSubmitting">
								</label>
								<MkButton primary rounded :disabled="passwordSubmitting || passwordInput === ''" type="submit">{{ i18n.ts._liveChannel.restrictedPasswordSubmit }}</MkButton>
							</form>
							<MkInfo v-if="passwordError" warn>{{ i18n.ts._liveChannel.restrictedPasswordIncorrect }}</MkInfo>
						</template>
						<template v-else-if="activeSession.viewRestriction === 'users'">
							<div :class="$style.restrictedTitle">{{ i18n.ts._liveChannel.restrictedUsersTitle }}</div>
							<div :class="$style.restrictedDescription">{{ i18n.ts._liveChannel.restrictedUsersDescription }}</div>
						</template>
					</div>
				</div>
				<div :class="$style.info" class="_panel">
					<div :class="$style.infoHeader">
						<MkAvatar :user="user" :class="$style.infoAvatar" link preview/>
						<div :class="$style.infoText">
							<!-- プレビュー中は配信タイトルの代わりにプレビュー中であることを明示する -->
							<div :class="$style.streamTitle">{{ isPreview ? i18n.ts._twitch.previewModeNotice : streamInfo.title }}</div>
							<div :class="$style.streamMeta">
								<MkUserName :user="user"/>
								<span v-if="streamInfo.gameName"> · {{ streamInfo.gameName }}</span>
								<span> · <MkTime :time="streamInfo.startedAt" mode="relative"/></span>
							</div>
						</div>
						<!-- MSJP配信/Twitch同時配信時のみ表示する配信元切替。専用の常時表示行だと
						モバイルで縦スペースを圧迫するため、タイトル行のアイコンボタン+メニューに
						統合する (bsky-fork 独自) -->
						<button v-if="showSourceToggle" class="_button" :class="$style.streamerSettingsButton" :title="i18n.ts._liveChannel.switchSource" :aria-label="i18n.ts._liveChannel.switchSource" @click="openSourceMenu">
							<i class="ti ti-arrows-right-left"></i>
						</button>
						<!-- 視聴者含む全ユーザーが任意にページを再取得できるようにする。プレビュー中は
						実配信が始まったことを検知する手段が無いため、これで拾えるようにする (bsky-fork 独自) -->
						<button class="_button" :class="$style.streamerSettingsButton" :title="i18n.ts.reload" :aria-label="i18n.ts.reload" @click="reload">
							<i class="ti ti-refresh"></i>
						</button>
						<button v-if="isOwner" class="_button" :class="$style.streamerSettingsButton" :title="i18n.ts._twitch.streamerSettings" :aria-label="i18n.ts._twitch.streamerSettings" @click="openStreamerSettings">
							<i class="ti ti-settings"></i>
						</button>
						<MkFollowButton v-else-if="$i != null && $i.id !== user.id" v-model:user="user" :full="true"/>
						<button v-else-if="remoteGuestSession != null" class="_button" :class="$style.remoteGuestMenu" @click="openRemoteGuestMenu">
							<i class="ti ti-user-circle"></i>
							<span :class="$style.remoteGuestAcct">{{ remoteGuestSession.acct }}</span>
							<i class="ti ti-chevron-down"></i>
						</button>
					</div>
				</div>
			</div>
			<div :class="$style.chat">
				<XChat v-if="activeSession != null" :key="activeSession.streamId" :streamId="activeSession.streamId" :returnTo="`/live/${props.acct}`" :canModerate="isOwner" @streamEnded="onStreamEnded"/>
				<XChat v-else-if="isPreview && streamInfo != null" :key="`preview-${streamInfo.id}`" :streamId="streamInfo.id" :returnTo="`/live/${props.acct}`" :canModerate="isOwner" @streamEnded="onStreamEnded"/>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, ref, watch, onMounted, onActivated, onDeactivated } from 'vue';
import * as Misskey from 'misskey-js';
import { url as serverUrl } from '@@/js/config.js';
import XChat from '@/pages/live-stream.chat.vue';
import MkFollowButton from '@/components/MkFollowButton.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkStreamPlayer from '@/components/MkStreamPlayer.vue';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { useRouter } from '@/router.js';
import { remoteGuestSession, saveRemoteGuestSession, clearRemoteGuestSession } from '@/composables/use-remote-guest-session.js';
import { copyToClipboard } from '@/utility/copy-to-clipboard.js';

const props = defineProps<{
	acct: string;
}>();

const router = useRouter();

const fetching = ref(true);
const user = ref<Misskey.entities.UserDetailed | null>(null);
const channelInfo = ref<Misskey.Endpoints['live-channels/show']['res'] | null>(null);
const twitchInfo = ref<Misskey.Endpoints['twitch/streams/show']['res'] | null>(null);
// 配信開始前でもチャット動作確認ができるプレビューモード (bsky-fork 独自)。
// 実配信 (twitchInfo.stream) が始まった場合はそちらを優先する
const previewStream = ref<Misskey.Endpoints['twitch/streams/preview']['res'] | null>(null);

type StreamSession = {
	source: 'twitch' | 'ome';
	streamId: string;
	isLive: boolean;
	playbackUrl?: string;
	twitchLogin?: string;
	authorized: boolean;
	viewRestriction?: 'followers' | 'password' | 'users';
};

// MSJP配信の視聴制限 (bsky-fork 独自)。password モードの viewToken はページ内 ref + sessionStorage
// (キーに配信者IDを含める) の二重保持。sessionStorage はタブを閉じるまで有効なので、リロード/
// 再訪時に再入力なしで視聴を継続できる
function viewTokenStorageKey(userId: string): string {
	return `liveStreamViewToken:${userId}`;
}

function loadStoredViewToken(userId: string): string | null {
	try {
		return sessionStorage.getItem(viewTokenStorageKey(userId));
	} catch {
		return null;
	}
}

function saveStoredViewToken(userId: string, token: string) {
	try {
		sessionStorage.setItem(viewTokenStorageKey(userId), token);
	} catch {
		// sessionStorage が使えない環境 (プライベートモード等) では保持を諦める
	}
}

function clearStoredViewToken(userId: string) {
	try {
		sessionStorage.removeItem(viewTokenStorageKey(userId));
	} catch {
		// noop
	}
}

const viewToken = ref<string | null>(null);
const passwordInput = ref('');
const passwordSubmitting = ref(false);
const passwordError = ref(false);

const streamInfo = computed(() => twitchInfo.value?.stream ?? previewStream.value ?? null);
const isPreview = computed(() => twitchInfo.value?.stream == null && previewStream.value != null);
const liveSessions = computed<StreamSession[]>(() => twitchInfo.value?.sessions?.filter(s => s.isLive) ?? []);

// 自分の配信ページかどうか。配信者専用の設定メニュー (OBS オーバーレイ URL・
// コメント読み上げ・配信ブロック管理) の表示条件
const isOwner = computed(() => $i != null && user.value != null && $i.id === user.value.id);

const channelState = computed<'live' | 'offline' | 'none'>(() => {
	if (liveSessions.value.length > 0) return 'live';
	if (twitchInfo.value?.stream != null) return 'live';
	if (channelInfo.value != null && channelInfo.value.enabled) return 'offline';
	return 'none';
});

const activeSource = ref<'ome' | 'twitch'>('ome');

watch(liveSessions, (sessions) => {
	if (sessions.length === 0) return;
	const hasOme = sessions.some(s => s.source === 'ome');
	const hasTwitch = sessions.some(s => s.source === 'twitch');
	if (hasOme && !hasTwitch) activeSource.value = 'ome';
	else if (!hasOme && hasTwitch) activeSource.value = 'twitch';
}, { immediate: true });

const activeSession = computed(() => liveSessions.value.find(s => s.source === activeSource.value) ?? liveSessions.value[0] ?? null);

const showSourceToggle = computed(() => {
	const sources = new Set(liveSessions.value.map(s => s.source));
	return sources.size > 1;
});

async function openPreview() {
	try {
		previewStream.value = await misskeyApi('twitch/streams/preview', {});
	} catch (err) {
		os.alert({ type: 'error', text: err instanceof Error ? err.message : String(err) });
	}
}

async function reload() {
	fetching.value = true;
	user.value = null;
	channelInfo.value = null;
	twitchInfo.value = null;
	previewStream.value = null;
	passwordError.value = false;
	try {
		const { username, host } = Misskey.acct.parse(props.acct);
		const fetchedUser = await misskeyApi('users/show', { username, host: host ?? undefined });
		user.value = fetchedUser;
		viewToken.value = loadStoredViewToken(fetchedUser.id);
		const [channel, twitch] = await Promise.all([
			misskeyApi('live-channels/show', { userId: fetchedUser.id }).catch(() => null),
			misskeyApi('twitch/streams/show', { userId: fetchedUser.id, viewToken: viewToken.value ?? undefined }).catch(() => null),
		]);
		channelInfo.value = channel;
		twitchInfo.value = twitch;
		// 保持していた viewToken が失効/無効化 (パスワード変更等) されていた場合は、
		// sessionStorage の古いトークンを掃除して次回以降クリーンな状態から再入力させる
		if (viewToken.value != null && twitch?.sessions?.some(s => s.source === 'ome' && !s.authorized && s.viewRestriction === 'password')) {
			clearStoredViewToken(fetchedUser.id);
			viewToken.value = null;
		}
		// ライブ状態で /stream にアクセスした場合、プレビューは不要
		if (channelState.value !== 'live' && isOwner.value) {
			await openPreview();
		}
	} catch {
		// user unknown → not found
	} finally {
		fetching.value = false;
	}
}

// パスワード視聴制限 (bsky-fork 独自)。verify-view-password で viewToken を取得し、
// それを付けて twitch/streams/show のみ再取得する (reload() はユーザー・チャンネル情報まで
// 全部作り直すため、フラッシュを避けたい入力直後のケースではこちらを使う)
async function submitViewPassword() {
	if (user.value == null || passwordInput.value === '') return;
	passwordSubmitting.value = true;
	passwordError.value = false;
	try {
		const res = await misskeyApi('live-channels/verify-view-password', { userId: user.value.id, password: passwordInput.value });
		viewToken.value = res.viewToken;
		saveStoredViewToken(user.value.id, res.viewToken);
		passwordInput.value = '';
		twitchInfo.value = await misskeyApi('twitch/streams/show', { userId: user.value.id, viewToken: viewToken.value }).catch(() => null);
	} catch {
		passwordError.value = true;
	} finally {
		passwordSubmitting.value = false;
	}
}

function onStreamEnded() {
	os.alert({ type: 'info', text: i18n.ts._twitch.streamEnded });
	reload();
}

function openSourceMenu(ev: MouseEvent) {
	// active に生の boolean を渡すとメニュー表示時点のスナップショットで固定されてしまい、
	// 開いたまま切り替えてもチェックマークが追従しない。MkMenu は item.active を unref() で
	// 評価するため、ComputedRef を渡すことで選択直後にリアクティブに反映させる
	os.popupMenu([{
		type: 'radioOption',
		text: i18n.ts._liveChannel.selfStream,
		active: computed(() => activeSource.value === 'ome'),
		action: () => { activeSource.value = 'ome'; },
	}, {
		type: 'radioOption',
		text: 'Twitch',
		active: computed(() => activeSource.value === 'twitch'),
		action: () => { activeSource.value = 'twitch'; },
	}], ev.currentTarget ?? ev.target);
}

function openStreamerSettings(ev: MouseEvent) {
	os.popupMenu([{
		text: i18n.ts._twitch.copyObsOverlayUrl,
		icon: 'ti ti-copy',
		action: () => {
			// ?zen で最小レイアウト (ヘッダー等なし) になる。OBS のブラウザソースは
			// ログインできないため、オーバーレイページは匿名アクセス前提
			copyToClipboard(`${serverUrl}/live/${props.acct}/overlay?zen`);
		},
	}, {
		text: i18n.ts._twitch.ttsSettings,
		icon: 'ti ti-speakerphone',
		action: async () => {
			const { dispose } = await os.popupAsyncWithDialog(
				import('@/pages/live-stream.tts-settings.vue').then(x => x.default),
				{},
				{ closed: () => dispose() },
			);
		},
	}, {
		text: i18n.ts._twitch.commentGenSettings,
		icon: 'ti ti-message-2-cog',
		action: async () => {
			const { dispose } = await os.popupAsyncWithDialog(
				import('@/pages/live-stream.comment-generator-settings.vue').then(x => x.default),
				{ acct: props.acct },
				{ closed: () => dispose() },
			);
		},
	}, {
		text: i18n.ts._twitch.manageBlocks,
		icon: 'ti ti-ban',
		action: async () => {
			const { dispose } = await os.popupAsyncWithDialog(
				import('@/pages/live-stream.blocks.vue').then(x => x.default),
				{},
				{ closed: () => dispose() },
			);
		},
	}, {
		text: i18n.ts._twitch.translationSettings,
		icon: 'ti ti-language',
		action: async () => {
			const { dispose } = await os.popupAsyncWithDialog(
				import('@/pages/live-stream.translation-settings.vue').then(x => x.default),
				{},
				{ closed: () => dispose() },
			);
		},
	}], ev.currentTarget ?? ev.target);
}

// リモートゲストログイン中のみ表示する簡易メニュー。フル機能のアカウントメニューとは
// 別体系 (MiUser を持たない第3のアイデンティティのため) で、視聴+コメント専用スコープに
// 留める設計判断のもと、ログアウトのみを提供する
function openRemoteGuestMenu(ev: MouseEvent) {
	if (remoteGuestSession.value == null) return;
	os.popupMenu([{
		type: 'label',
		text: i18n.tsx._remoteGuestLogin.loggedInAs({ acct: remoteGuestSession.value.acct }),
	}, {
		text: i18n.ts._remoteGuestLogin.logout,
		icon: 'ti ti-logout',
		danger: true,
		action: () => {
			clearRemoteGuestSession();
		},
	}], ev.currentTarget ?? ev.target);
}

// リモートゲストログインのコールバック結果を処理する (settings/twitch.vue の
// handleCallbackResult と同一パターン)。未ログイン時のみ意味を持つが、
// query を消す処理自体は毎回実行して問題ない
function handleRemoteGuestLoginResult() {
	const params = new URLSearchParams(window.location.search);
	const result = params.get('remoteGuestResult');
	if (result == null) return;

	const token = params.get('remoteGuestToken');
	const expiresAt = params.get('remoteGuestExpiresAt');
	const acct = params.get('remoteGuestAcct');

	// query を消してリロード/共有時の再表示を防ぐ (トークンを URL に残さない)
	window.history.replaceState(null, '', window.location.pathname);

	switch (result) {
		case 'linked':
			if (token != null && expiresAt != null) {
				saveRemoteGuestSession({ token, expiresAt, acct: acct ?? '' });
				os.alert({ type: 'success', text: i18n.ts._remoteGuestLogin.linked });
			}
			break;
		case 'denied':
			os.alert({ type: 'warning', text: i18n.ts._remoteGuestLogin.denied });
			break;
		case 'usernameMismatch':
			os.alert({ type: 'error', text: i18n.ts._remoteGuestLogin.usernameMismatch });
			break;
		case 'expired':
			os.alert({ type: 'warning', text: i18n.ts._remoteGuestLogin.expired });
			break;
	}
}

watch(() => props.acct, reload);

onMounted(() => {
	handleRemoteGuestLoginResult();
	reload();
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
	title: twitchInfo.value?.stream?.title ?? (isPreview.value ? i18n.ts._twitch.previewModeNotice : i18n.ts._twitch.liveStreams),
	icon: 'ti ti-broadcast',
	// watch ページは常にデッキ UI の「デッキへ戻る」バナーを險す
	hideDeckNav: true,
	// スマホのグローバルボトムナビ (ホーム/通知/ウィジェット) は視聴の邪魔になるため非表示にする
	hideMobileFooter: true,
}));
</script>

<style lang="scss" module>
.watch {
	display: flex;
	gap: 12px;
	align-items: stretch;
	// フルスクリーンアプリ的に実際に使える高さへ固定し、ページ全体はスクロール
	// させない (スマホ側と同じ考え方)。100dvh (ブラウザビューポート基準) ではなく
	// 100cqh (コンテナクエリ基準) を使うことで、通常ページだけでなく MkPageWindow
	// (デッキ上でリンクを開いたときのポップアップウィンドウ) のような、ブラウザ
	// ビューポートより小さい枠内に表示される場合でも正しい高さに解決される。
	// _pageContainer (RouterView.vue) が container-type: size を張っており、
	// 通常ページ・ウィンドウどちらの場合もそれが実際の表示枠の高さと一致する
	// (PageWithHeader.vue の .body { min-height: calc(100cqh - ...) } と同じ考え方)。
	// --MI-minBottomSpacing は差し引かない: universal.vue では RouterView と
	// XMobileFooterMenu は同じ flex 列の兄弟要素で、_pageContainer の高さは
	// flex レイアウトの時点でモバイルフッター分を既に除いた値になっている
	// (100dvh 基準だった旧実装ではビューポート全体を指していたため差し引きが
	// 必要だったが、100cqh に切り替えた今は二重減算になり下部に余白ができる)
	height: 100cqh;
	min-height: 480px;
}

.main {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 12px;
	min-height: 0;
}

.playerContainer {
	// PC: 情報パネルの残りの縦幅いっぱいにプレイヤーを広げる (Twitch のシアターモード相当)。
	// aspect-ratio は使わず、埋め込みプレイヤー自身が与えられた領域に合わせて描画する
	position: relative;
	flex: 1;
	min-height: 0;
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

.restrictedPanel {
	width: 100%;
	height: 100%;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 8px;
	padding: 24px;
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

.streamerSettingsButton {
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

.remoteGuestMenu {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 6px 12px;
	border: solid 1px var(--MI_THEME-divider);
	border-radius: 999px;
	font-size: 0.9em;

	&:hover {
		color: var(--MI_THEME-accent);
		border-color: var(--MI_THEME-accent);
	}
}

.remoteGuestAcct {
	max-width: 160px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.chat {
	flex-shrink: 0;
	width: 360px;
	min-height: 0;
}

// スマホ / 縦画面相当の狭いペイン: プレイヤー上部・チャット下部の縦積みに切り替える。
// 絶対的な幅だけでなく「ペインの縦横比」でも判定する。固定幅 360px のチャット欄を
// 確保したまま 2 ペインで並べると、正方形〜縦長のペイン (例: 縦置きモニタ、デッキの
// ポップアップウィンドウを正方形寄りにリサイズした場合) ではプレイヤーが極端に
// 細長い領域に押し込まれ、Twitch 埋め込みプレイヤーが上下に大きくレターボックスされて
// 実質的な表示サイズが小さくなってしまう。ペインが少しでも縦長 (aspect-ratio < 1/1)
// になったら、幅に余裕があっても縦積みへ切り替え、プレイヤーが横幅いっぱいを使える
// ようにする。
// window.innerWidth ではなく container query を基準にする (Misskey はデッキ表示等で
// ペイン幅が実ビューポート幅と一致しないため、他のレスポンシブ分岐 (例: XMessage.vue
// の @container (max-width: 450px)) と同じ流儀に揃える)。aspect-ratio の評価には
// block-size のコンテナ包含が必要なため、_spacer (container-type: inline-size のみ)
// ではなく、より外側の _pageContainer (RouterView.vue, container-type: size) が
// このクエリの基準コンテナになる (幅だけの条件なら _spacer が使われるところ、
// aspect-ratio を含めることで自動的に size 対応の祖先まで遡って解決される)
// 同名クラスの上書きなので、CSS Modules 上も同じ詳細度になり、ソース順序が後にある
// このブロックを末尾に置かないと上の基本定義に負けて narrow レイアウトが効かない
@container (max-width: 700px) or (aspect-ratio < 1/1) {
	.watch {
		flex-direction: column;
		// 高さ固定 (100cqh 基準) は PC と共通の base 定義を流用し、ここでは
		// 縦積みへの向き変更と min-height の解除のみ行う
		min-height: 0;
	}

	.main {
		// PC 版はプレイヤーが残り高さいっぱいに広がる (flex: 1) が、スマホでは
		// 通常のアスペクト比固定の動画として上部に収め、残りをチャットに譲る
		flex: none;
	}

	.playerContainer {
		flex: none;
		aspect-ratio: 16 / 9;
	}

	.chat {
		width: 100%;
		// 60dvh 等の決め打ちではなく、.watch の残り高さいっぱいに広げる。
		// 内部のスクロール (チャット履歴) / 非スクロール (入力欄) は
		// live-stream.chat.vue 側の flex レイアウトが担当する
		flex: 1;
		min-height: 0;
	}
}
</style>
