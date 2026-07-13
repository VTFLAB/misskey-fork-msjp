<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

# 05: フロントエンドプレイヤー実装設計書

## 位置づけ

本書は「ライブチャンネル」機能 (misskey-bsky-fork 独自配信システム、命名は `00-overview.md` §0 準拠) のうち、視聴ページ (`/live/:acct`) のプレイヤー部分・セッション切替 UI の詳細設計を扱う。実装フェーズ分割上の **Phase 4 (プレイヤー、frontend)** に対応する。

本書は以下を前提として書かれている。読んでいない場合は先に読むこと。矛盾がある場合はそちらが正:

- `00-overview.md` — 用語・命名 (「ライブチャンネル」「MSJP配信」、i18n キー接頭辞 `_liveChannel`)、全体アーキテクチャ概観
- `03-backend-ome-integration.md` — `twitch_stream` テーブルの `source` カラムによるセッション統合、`twitch/streams/show` 拡張レスポンスの形、同時配信 (Twitch + OME) 時の挙動
- `04-frontend-channel-page.md` — OvenPlayer 採用決定・コンポーネント分割方針の決定そのもの (決定の原本は `architecture-decisions.md` §4)

本書が前提とする確定事項 (`architecture-decisions.md` より、蒸し返さない):

- OvenPlayer は npm 依存 (`ovenplayer`) としてそのまま使う。`ovenplayer-vue3` は使わず自前 Vue ラップ (§4)
- `twitch_stream` テーブルを `source: 'twitch'|'ome'` で汎用化して共用、チャットは `streamId` のみに依存するため無改修〜最小改修 (§3)
- 視聴用 WebRTC URL (`playbackUrl`) は backend が組み立てて返す。フロントに SignedPolicy 生成ロジックは置かない (§4 末尾)

## 完了条件

- [ ] `pnpm --filter frontend add ovenplayer` 実行済み、`packages/frontend/package.json` にバージョン固定 (キャレット無し) で追加
- [ ] `packages/frontend/src/components/MkOmePlayer.vue` 新規作成 (本書 §2 のスケルトンを満たす)
- [ ] `packages/frontend/src/components/MkTwitchPlayer.vue` 新規作成 (本書 §3)
- [ ] `packages/frontend/src/components/MkStreamPlayer.vue` 新規作成 (本書 §4)
- [ ] `packages/frontend/src/pages/live-stream.vue` 改修 (本書 §5、セグメントトグル・チャット追従・単一ライブ自動選択)
- [ ] `pnpm lint` (typecheck + eslint) が通る
- [ ] 本書 §9 の実機確認チェックリストを実施し、結果を引き継ぎメモに記録

---

## 1. 依存追加

```fish
pnpm --filter frontend add ovenplayer
```

- バージョン固定方針: `package.json` の `dependencies` にキャレット (`^`) を付けず完全一致 (`"ovenplayer": "0.10.52"` のように具体バージョンのみ) で固定する。理由: `research-ovenplayer.md` §5 の通り WebRTC 自動再接続に既知の弱点があり (GitHub Issue #240)、マイナーアップデートで挙動が変わるリスクを avoid したい。upstream Misskey の他依存 (`hls.js` 等) も同様にほぼ固定バージョン運用のため fork の流儀とも合致する。バージョンアップは意図的な検証を経てから行う。
- **バンドルサイズへの注意**: `research-ovenplayer.md` §7 の通り `ovenplayer` は単一 UMD バンドルで LLHLS/WebRTC/DASH が全部入りになっている可能性が高く、正確な gzip サイズは未計測 (⚠ 要実機確認: `pnpm --filter frontend build` 後に `du -h` または webpack-bundle-analyzer 相当で確認すること)。**静的 import で全ページの初期バンドルに含めることは絶対にしない**。`MkOmePlayer.vue` 内で `await import('ovenplayer')` による dynamic import を行い、OME 配信を実際に視聴するタイミング (= `MkOmePlayer.vue` がマウントされるタイミング) でのみ読み込む設計にする (§2 参照)。トップレベル `import OvenPlayer from 'ovenplayer'` は禁止。

---

## 2. `MkOmePlayer.vue`

配置: `packages/frontend/src/components/MkOmePlayer.vue`

### 責務

- OvenPlayer (WebRTC source) を `controls:false` で mount し、自前コントロールバー (ミュート・音量・全画面のみ、再生/停止/シークは無い) を被せる
- KeepAlive 対応 (`onActivated`/`onDeactivated` で create/destroy、`live-stream.vue` の既存 `playerActive` パターンを踏襲: `live-stream.vue:262-268`)
- 再接続 watchdog (`error`/`stalled` 検知 → destroy→re-create、5 秒開始・指数バックオフ上限 60 秒)
- 配信終了 (`streamEnded`、親から props で通知) を受けたら watchdog を止めてオフライン表示に遷移
- 音量・ミュート状態を `miLocalStorage` に永続化 (キー例: `omePlayerVolume` / `omePlayerMuted`)

### props / emits

```ts
const props = defineProps<{
	playbackUrl: string; // OME WebRTC signalling URL (wss://...)。backend が組み立てて渡す (streams/show 拡張レスポンス由来)
	active: boolean; // KeepAlive の playerActive 相当。false の間は内部で create しない
}>();

const emit = defineEmits<{
	(ev: 'error', detail: { fatal: boolean }): void; // watchdog が上限バックオフに達した等、親側でのオフライン表示切替に使う
}>();
```

`playbackUrl` の由来 (`03-backend-ome-integration.md` §8 で確定済み): `twitch/streams/show` 拡張レスポンスの `sessions[].playbackUrl` を親コンポーネント (`live-stream.vue`) が選択し、`MkStreamPlayer.vue` 経由でここまで渡す。

### コンポーネント全体スケルトン

```vue
<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div
	ref="rootEl"
	:class="$style.root"
	@mouseenter="onMouseenter"
	@mouseleave="onMouseleave"
	@mousemove="onMousemove"
>
	<div :id="playerElementId" ref="playerContainerEl" :class="$style.playerContainer"></div>

	<!-- autoplay policy: mute:true 起動直後のみ表示するオーバーレイ (§7) -->
	<button
		v-if="showUnmuteOverlay"
		:class="$style.unmuteOverlay"
		@click="onUnmuteOverlayClick"
	>
		<i class="ti ti-volume-3"></i>
		<span>{{ i18n.ts._liveChannel.tapToUnmute }}</span>
	</button>

	<div v-if="offline" :class="$style.offlineOverlay">
		<span>{{ i18n.ts._liveChannel.reconnecting }}</span>
	</div>

	<!-- 自前コントロールバー: ホバーで表示するオートハイド -->
	<div :class="[$style.controls, { [$style.controlsVisible]: controlsVisible }]">
		<button class="_button" :class="$style.controlButton" :aria-label="i18n.ts._liveChannel.mute" @click="toggleMute">
			<i v-if="muted || volume === 0" class="ti ti-volume-3"></i>
			<i v-else class="ti ti-volume"></i>
		</button>
		<MkMediaRange v-model="volume" :class="$style.volumeSeekbar"/>
		<div :class="$style.spacer"></div>
		<button class="_button" :class="$style.controlButton" :aria-label="i18n.ts._liveChannel.fullscreen" @click="onFullscreenClick">
			<i class="ti ti-maximize"></i>
		</button>
	</div>
</div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, useTemplateRef } from 'vue';
import { v4 as uuid } from 'uuid';
import MkMediaRange from '@/components/MkMediaRange.vue';
import { i18n } from '@/i18n.js';
import { miLocalStorage } from '@/local-storage.js';
import { requestFullscreen, exitFullscreen } from '@/utility/fullscreen.js';

// OvenPlayer は controls:false + on('stateChanged')/on('error') 以外の詳細な型を
// 公式が d.ts で配布していない (research-ovenplayer.md 時点で未確認) ため、
// 型は any 経由で最小限に絞る。⚠ 実装時に @types/ovenplayer 相当が無いか確認すること
type OvenPlayerInstance = {
	remove(): void;
	setMute(muted: boolean): void;
	setVolume(volume: number): void; // 0-100 か 0-1 かは ⚠ 要実機確認 (research-ovenplayer.md に明記なし)
	getState(): string;
	on(event: 'stateChanged', cb: (data: { prevstate: string; newstate: string }) => void): void;
	on(event: 'error', cb: (error: unknown) => void): void;
};

const props = defineProps<{
	playbackUrl: string;
	active: boolean;
}>();

const emit = defineEmits<{
	(ev: 'error', detail: { fatal: boolean }): void;
}>();

const playerElementId = `ome-player-${uuid()}`;
const rootEl = useTemplateRef('rootEl');
const playerContainerEl = useTemplateRef('playerContainerEl');

let player: OvenPlayerInstance | null = null;

// --- 音量/ミュート: miLocalStorage 永続化 ---
// live-stream.comment-generator-settings.vue の miLocalStorage.getItem/setItem パターンを踏襲
const STORAGE_KEY_VOLUME = 'omePlayerVolume';
const STORAGE_KEY_MUTED = 'omePlayerMuted';

const volume = ref(Number(miLocalStorage.getItem(STORAGE_KEY_VOLUME) ?? '1'));
const muted = ref(miLocalStorage.getItem(STORAGE_KEY_MUTED) === 'true');

watch(volume, (v) => {
	miLocalStorage.setItem(STORAGE_KEY_VOLUME, String(v));
	player?.setVolume(v);
});

watch(muted, (m) => {
	miLocalStorage.setItem(STORAGE_KEY_MUTED, String(m));
	player?.setMute(m);
});

function toggleMute() {
	muted.value = !muted.value;
}

// --- autoplay policy: mute:true で起動し、初回インタラクションでオーバーレイを消す (§7) ---
const showUnmuteOverlay = ref(true);

function onUnmuteOverlayClick() {
	muted.value = false;
	showUnmuteOverlay.value = false;
}

// --- オートハイド (ホバー時のみコントロール表示) ---
const controlsVisible = ref(false);
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function onMouseenter() {
	controlsVisible.value = true;
}
function onMousemove() {
	controlsVisible.value = true;
	if (hideTimer != null) clearTimeout(hideTimer);
	hideTimer = setTimeout(() => { controlsVisible.value = false; }, 2500);
}
function onMouseleave() {
	if (hideTimer != null) clearTimeout(hideTimer);
	controlsVisible.value = false;
}

// --- 全画面: ブラウザ Fullscreen API を利用 (§6) ---
function onFullscreenClick() {
	if (rootEl.value == null) return;
	// OvenPlayer 内部の <video> 要素を webkitEnterFullscreen フォールバック用に取得する。
	// DOM 構造 (.op-player video 等) はバージョン依存のため querySelector は実装時に
	// 実際の DOM を確認して調整すること (⚠ 要実機確認)
	const videoEl = rootEl.value.querySelector('video') as HTMLVideoElement | null;
	requestFullscreen({
		videoEl: (videoEl ?? {}) as HTMLVideoElement,
		playerEl: rootEl.value,
	});
}

// --- 再接続 watchdog ---
const offline = ref(false);
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelayMs = 5000;
const RECONNECT_DELAY_MAX_MS = 60000;
let watchdogStopped = false;

function clearReconnectTimer() {
	if (reconnectTimer != null) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
}

function scheduleReconnect() {
	if (watchdogStopped) return;
	clearReconnectTimer();
	reconnectTimer = setTimeout(async () => {
		await destroyPlayer();
		await createPlayer();
		reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_DELAY_MAX_MS);
	}, reconnectDelayMs);
}

// 配信終了通知 (親から streamEnded イベント経由で呼ぶ想定、live-stream.chat.vue の
// streamEnded emit と同じソースイベントに追従する。詳細配線は §5 参照)
function stopWatchdogOnStreamEnded() {
	watchdogStopped = true;
	clearReconnectTimer();
	offline.value = true;
}

defineExpose({ stopWatchdogOnStreamEnded });

// --- OvenPlayer create/destroy ---
async function createPlayer() {
	if (player != null) return;
	if (playerContainerEl.value == null) return;

	// dynamic import: OME 視聴時のみバンドルをロードする (§1)
	const { default: OvenPlayer } = await import('ovenplayer') as { default: {
		create(elementId: string, config: Record<string, unknown>): OvenPlayerInstance;
	} };

	player = OvenPlayer.create(playerElementId, {
		sources: [{
			label: 'live',
			type: 'webrtc',
			file: props.playbackUrl,
		}],
		autoStart: true,
		mute: true, // autoplay policy 対応。ミュート解除は §7 のオーバーレイ経由のユーザー操作でのみ行う
		controls: false,
	});

	player.setVolume(volume.value);
	// mute:true で起動するため、ユーザーが以前セッションでミュート解除していた状態を
	// 即座に復元することはしない (ブラウザの autoplay policy に反するため)。
	// showUnmuteOverlay が表示されている間は muted=true を維持する

	player.on('stateChanged', ({ newstate }) => {
		if (newstate === 'error' || newstate === 'stalled') {
			offline.value = true;
			scheduleReconnect();
		} else if (newstate === 'playing') {
			offline.value = false;
			reconnectDelayMs = 5000; // 復帰したらバックオフをリセット
		}
	});

	player.on('error', () => {
		offline.value = true;
		scheduleReconnect();
	});
}

async function destroyPlayer() {
	if (player == null) return;
	player.remove();
	player = null;
}

watch(() => props.active, async (active) => {
	if (active) {
		watchdogStopped = false;
		await createPlayer();
	} else {
		clearReconnectTimer();
		await destroyPlayer();
	}
});

// playbackUrl が変わった場合 (セッション切替、同一 source 内での再接続等) は
// 作り直す。KeepAlive での二重 create を避けるため、既存 player があれば必ず
// destroy してから create する (§8)
watch(() => props.playbackUrl, async () => {
	await destroyPlayer();
	if (props.active) await createPlayer();
});

onMounted(async () => {
	if (props.active) await createPlayer();
});

onBeforeUnmount(async () => {
	clearReconnectTimer();
	await destroyPlayer();
});
</script>

<style lang="scss" module>
.root {
	position: relative;
	width: 100%;
	height: 100%;
	background: #000;
	// live-stream.vue の .playerContainer と同じ 100cqh 系コンテナクエリ前提の
	// 親 (MkStreamPlayer.vue) の中に置かれる想定。このコンポーネント自身は
	// container-type を張らない (親側で完結させる、§8 の CSS Modules ソース順序の罠を参照)
}

.playerContainer {
	width: 100%;
	height: 100%;
}

.unmuteOverlay {
	position: absolute;
	inset: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 8px;
	background: rgba(0, 0, 0, 0.5);
	color: #fff;
	border: none;
	font-size: 1.1em;
	cursor: pointer;
}

.offlineOverlay {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	color: #fff;
	background: rgba(0, 0, 0, 0.4);
	pointer-events: none;
}

.controls {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0;
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 12px;
	background: linear-gradient(to top, rgba(0, 0, 0, 0.6), transparent);
	opacity: 0;
	transition: opacity 150ms ease;
	pointer-events: none;
}

.controlsVisible {
	opacity: 1;
	pointer-events: auto;
}

.controlButton {
	color: #fff;
	width: 32px;
	height: 32px;
}

.volumeSeekbar {
	width: 80px;
}

.spacer {
	flex: 1;
}
</style>
```

### 実装メモ

- `OvenPlayer.create()` / `sources[].type: 'webrtc'` / `autoStart` / `mute` / `controls` / `on('stateChanged')` / `on('error')` は `research-ovenplayer.md` §2・§3・§5 に一次情報源つきで確認済みの API のみ使用している。
- `setVolume()` の値域 (0-1 か 0-100 か)・`OvenPlayer.remove()` 以外の破棄用 API の有無・`stateChanged` の `newstate` に `stalled` が実際に含まれるか (§5 の state 一覧には `idle, complete, paused, playing, error, loading, stalled` と記載があるが、WebRTC source で `stalled` が発火するかは未検証) は **⚠ 要実機確認**。Phase 0 のインフラ実証時に実際の `on('stateChanged')` ログを取り、このコンポーネントの分岐条件を調整すること。
- OvenPlayer 内部 DOM 構造 (`querySelector('video')` が実在するか) も ⚠ 要実機確認。取得できない場合は `playerEl` (コンテナ要素) のみで `requestFullscreen` する (`videoEl` 引数は `webkitEnterFullscreen` フォールバックにのみ使われるため、無くても機能は落ちるが動作はする)。

---

## 3. `MkTwitchPlayer.vue`

配置: `packages/frontend/src/components/MkTwitchPlayer.vue`

`live-stream.vue` の既存 iframe 実装 (`live-stream.vue:116-123` の `playerUrl` computed と `live-stream.vue:28-34` のテンプレート) をロジック変更なしで切り出す。

### props

```ts
const props = defineProps<{
	twitchLogin: string;
	active: boolean; // 既存 playerActive 相当。false の間は iframe を描画しない (live-stream.vue:262-268 と同じ理由)
}>();
```

### 切り出し元 (現物確認済み、行番号は本書執筆時点)

- `playerUrl` computed: `live-stream.vue:116-123`
  ```ts
  const playerUrl = computed(() => {
  	if (twitchInfo.value == null) return '';
  	const url = new URL('https://player.twitch.tv/');
  	url.searchParams.set('channel', twitchInfo.value.twitchLogin);
  	url.searchParams.set('parent', hostname);
  	url.searchParams.set('autoplay', 'true');
  	return url.toString();
  });
  ```
  移植時は `twitchInfo.value.twitchLogin` を `props.twitchLogin` に置換するのみ。ロジック変更なし。
- iframe テンプレート: `live-stream.vue:28-34`
  ```html
  <iframe
  	v-if="playerActive"
  	:src="playerUrl"
  	:class="$style.player"
  	allowfullscreen
  	allow="autoplay; fullscreen"
  ></iframe>
  ```
  `playerActive` → `props.active` に置換。

### スケルトン

```vue
<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<iframe
	v-if="active"
	:src="playerUrl"
	:class="$style.player"
	allowfullscreen
	allow="autoplay; fullscreen"
></iframe>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { hostname } from '@@/js/config.js';

const props = defineProps<{
	twitchLogin: string;
	active: boolean;
}>();

const playerUrl = computed(() => {
	const url = new URL('https://player.twitch.tv/');
	url.searchParams.set('channel', props.twitchLogin);
	url.searchParams.set('parent', hostname);
	url.searchParams.set('autoplay', 'true');
	return url.toString();
});
</script>

<style lang="scss" module>
.player {
	width: 100%;
	height: 100%;
	border: none;
	display: block;
}
</style>
```

Twitch 側は iframe が音量・ミュート・全画面 UI を Twitch 公式プレイヤー内蔵で提供しているため、`MkOmePlayer.vue` のような自前コントロールバーは実装しない (要件通り)。

---

## 4. `MkStreamPlayer.vue`

配置: `packages/frontend/src/components/MkStreamPlayer.vue`

`source` に応じて `MkOmePlayer.vue` / `MkTwitchPlayer.vue` を切り替える薄いスイッチャー。

```vue
<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<MkOmePlayer
		v-if="source === 'ome' && playbackUrl != null"
		:playbackUrl="playbackUrl"
		:active="active"
	/>
	<MkTwitchPlayer
		v-else-if="source === 'twitch' && twitchLogin != null"
		:twitchLogin="twitchLogin"
		:active="active"
	/>
</div>
</template>

<script lang="ts" setup>
import MkOmePlayer from '@/components/MkOmePlayer.vue';
import MkTwitchPlayer from '@/components/MkTwitchPlayer.vue';

const props = defineProps<{
	source: 'ome' | 'twitch';
	playbackUrl?: string | null; // source === 'ome' のとき必須
	twitchLogin?: string | null; // source === 'twitch' のとき必須
	active: boolean;
}>();
</script>

<style lang="scss" module>
.root {
	width: 100%;
	height: 100%;
}
</style>
```

`MkStreamPlayer.vue` 自身は状態を持たない (どのセッションを選ぶかは `live-stream.vue` 側が `activeSource` として保持し、v-model で渡す設計は §5 参照。本コンポーネントは表示切替のみを担当し、選択 UI 自体は持たない — 要件5のセグメントトグルは `live-stream.vue` 側に置く)。

---

## 5. `live-stream.vue` 側の改修

### 5.1 拡張レスポンスの受け方

`03-backend-ome-integration.md` §8 の確定契約により `twitch/streams/show` は「アクティブセッション配列」(`sessions`) を返す形に拡張される。フロント側の型・変数名は以下のように変更する (フィールド名・形状は 03 §8 / 06 §11 整合性課題#2 の裁定で確定済み — キー名は `streamId`、`isLive: boolean` を含む):

```ts
// live-stream.vue:96 相当の置き換え。twitchInfo という変数名・型は Twitch 専用形状
// だったため、汎用型 streamsInfo に置き換える (research-codebase.md §5 の指摘通り)
type StreamSession = {
	source: 'twitch' | 'ome';
	streamId: string;
	isLive: boolean;
	// ome の場合のみ有効
	playbackUrl?: string;
	// twitch の場合のみ有効
	twitchLogin?: string;
};

const streamsInfo = ref<{ sessions: StreamSession[]; user: Misskey.entities.UserDetailed } | null>(null);

const liveSessions = computed(() => streamsInfo.value?.sessions.filter(s => s.isLive) ?? []);
```

既存の `twitchInfo` / `streamInfo` (`live-stream.vue:96,101`) は `streamsInfo` / `liveSessions` に置き換わる想定。プレビューモード (`previewStream`, `live-stream.vue:99`) は Twitch 専用機能のため既存のまま残す (OME にプレビューモードは本設計のスコープ外)。

### 5.2 セグメントトグル UI (両方ライブ時)

プレイヤー右上オーバーレイに配置する。`architecture-decisions.md` §4 の決定通り「両 source が同時ライブの場合のみ表示、片方のみなら自動選択・トグル非表示」。

```ts
const activeSource = ref<'ome' | 'twitch'>('ome'); // デフォルトは ome 優先 (§4決定)

watch(liveSessions, (sessions) => {
	if (sessions.length === 0) return;
	const hasOme = sessions.some(s => s.source === 'ome');
	const hasTwitch = sessions.some(s => s.source === 'twitch');
	if (hasOme && !hasTwitch) activeSource.value = 'ome';
	else if (!hasOme && hasTwitch) activeSource.value = 'twitch';
	// 両方ライブの場合は既存の activeSource (デフォルト 'ome') を維持し、
	// ユーザーが明示的に切り替えるまで自動では変えない
}, { immediate: true });

const activeSession = computed(() => liveSessions.value.find(s => s.source === activeSource.value) ?? liveSessions.value[0] ?? null);

const showSourceToggle = computed(() => {
	const sources = new Set(liveSessions.value.map(s => s.source));
	return sources.size > 1;
});
```

テンプレート (プレイヤーコンテナ内、右上オーバーレイとして重ねる):

```html
<div :class="$style.playerContainer">
	<MkStreamPlayer
		v-if="activeSession != null"
		:key="activeSession.streamId"
		:source="activeSession.source"
		:playbackUrl="activeSession.playbackUrl"
		:twitchLogin="activeSession.twitchLogin"
		:active="playerActive"
	/>
	<div v-if="showSourceToggle" :class="$style.sourceToggle">
		<button
			class="_button"
			:class="[$style.sourceToggleButton, { [$style.sourceToggleButtonActive]: activeSource === 'ome' }]"
			@click="activeSource = 'ome'"
		>{{ i18n.ts._liveChannel.selfStream }}</button>
		<button
			class="_button"
			:class="[$style.sourceToggleButton, { [$style.sourceToggleButtonActive]: activeSource === 'twitch' }]"
			@click="activeSource = 'twitch'"
		>Twitch</button>
	</div>
</div>
```

トグルのラベルは「MSJP配信 / Twitch」の 2 択表示とする。`_liveChannel.selfStream` (キー名は変更しない) の `ja-JP.yml` 値は「MSJP配信」(00 §3 命名表の user-facing 名)。

`:key="activeSession.streamId"` を付けることで、セッション切替時に `MkStreamPlayer` (およびその子の `MkOmePlayer`/`MkTwitchPlayer`) を確実に作り直す (Vue の再利用によって古い `playbackUrl` を保持したままの不整合を防ぐ、§8 KeepAlive 二重 create 罠とは別の一般的な key 管理の注意点)。

CSS はオーバーレイとして `position: absolute; top: 12px; right: 12px;` 相当を `.playerContainer { position: relative; }` に対して配置する (`live-stream.vue` 既存の `.playerContainer` は `position` 未指定のため、`position: relative;` を追加する改修が必要)。

### 5.3 チャットへの `streamId` 受け渡し

既存 (`live-stream.vue:65`):

```html
<XChat :key="streamInfo.id" :streamId="streamInfo.id" :live="true" :returnTo="`/live/${props.acct}`" :canModerate="isOwner" @streamEnded="onStreamEnded"/>
```

改修後は `streamInfo.id` を `activeSession.streamId` に置き換える。`:key` も `activeSession.streamId` のままなので、セグメントトグルでセッションを切り替えるたびに `XChat` (`live-stream.chat.vue`) が破棄・再作成され、`live-stream.chat.vue:560` の `stream.useChannel('twitchLiveStream', { streamId: props.streamId, ... })` が新しい `streamId` で張り直される。これにより「チャットが選択セッションに追従する」要件を、`live-stream.chat.vue` 側のコード変更なしで満たせる (`:key` によるコンポーネント再作成のみで解決する設計)。

```html
<XChat v-if="activeSession != null" :key="activeSession.streamId" :streamId="activeSession.streamId" :live="true" :returnTo="`/live/${props.acct}`" :canModerate="isOwner" @streamEnded="onStreamEnded"/>
```

⚠ streaming channel 名 (`twitchLiveStream`) はセッション統合後も `source` 非依存でそのまま使う決定 (`architecture-decisions.md` §3 末尾: 「イベント名の一般化リネームはしない」)。`live-stream.chat.vue` の改修は本書のスコープ外 (無改修で成立する設計のため)。

### 5.4 単一ライブ時の自動選択

§5.2 の `watch(liveSessions, ...)` が担う。両方オフラインなら `liveSessions` は空配列になり、既存のオフライン表示分岐 (`live-stream.vue:11-23` の `v-else-if="streamInfo == null"`) を `liveSessions.length === 0 && !isPreview` 相当の条件に置き換える。

---

## 6. 全画面

- ブラウザ標準の Fullscreen API を使う。既存ユーティリティ `packages/frontend/src/utility/fullscreen.ts` の `requestFullscreen({ videoEl, playerEl, options })` / `exitFullscreen({ videoEl })` をそのまま利用する (新規実装しない)。
  - `requestFullscreen` の実装 (`fullscreen.ts:25-34`): `playerEl.requestFullscreen()` を最優先で試み、無ければ `videoEl.webkitEnterFullscreen()` にフォールバックする。**iOS Safari は `Element.requestFullscreen()` を持たないため、必ず `webkitEnterFullscreen` フォールバック側に落ちる** — このユーティリティを使う限り自動的にハンドリングされるので、`MkOmePlayer.vue`/`MkTwitchPlayer.vue` 側で iOS 分岐を自前実装する必要はない。
  - `playerEl` にはコンポーネントのルート要素 (`rootEl`) を渡す。`videoEl` は OvenPlayer が内部生成する `<video>` 要素を渡すのが理想だが、DOM 構造がバージョン依存のため取得失敗時のフォールバック処理を入れること (§2 スケルトンの `onFullscreenClick` 参照)。
  - Twitch iframe 側 (`MkTwitchPlayer.vue`) は Twitch 公式プレイヤーが内蔵の全画面ボタンを持つため、`allowfullscreen` 属性 (`live-stream.vue:32` で既に付与済み) のみで足り、`fullscreen.ts` を呼ぶ必要はない。

---

## 7. Autoplay policy

- `MkOmePlayer.vue` は `mute: true` で `OvenPlayer.create()` する (`research-ovenplayer.md` §6 の公式サンプル通り、`autoStart: true` と組み合わせる場合はブラウザの自動再生ポリシー上 `mute: true` が必須)。
- 起動直後は `showUnmuteOverlay = true` とし、プレイヤー全面に半透明オーバーレイ + 「タップして音声オン」(i18n キー `_liveChannel.tapToUnmute`、`ja-JP.yml` にのみ追加すること) を表示する。
- オーバーレイをクリック/タップした時点でユーザー操作起点の `player.setMute(false)` を呼び (ブラウザの autoplay policy 上、ユーザー操作起点であれば音声再生が許可される)、オーバーレイを消す。
- オーバーレイクリック以外の経路 (例: 自前コントロールバーのミュートボタン) でミュート解除された場合も、`showUnmuteOverlay` を `false` にする実装にすること (実装時、ミュートボタンの `toggleMute()` からも `showUnmuteOverlay.value = false` を呼ぶよう調整が必要。§2 スケルトンではオーバーレイクリック経路のみ実装しているため、コントロールバーからの解除でオーバーレイが残る場合は追記すること)。
- KeepAlive で再アクティブ化された場合の挙動: 既存 `miLocalStorage` のミュート状態 (`muted.value`) をそのまま復元してよいか、autoplay policy の観点では毎回 `mute: true` で create する必要がある (§2 の `createPlayer()` は常に `mute: true` 固定にしている)。ユーザーが前回ミュート解除していた場合でも、再 create 時は毎回オーバーレイを再表示する設計とする (ブラウザ制約上、これ以上の自動化はできない)。

---

## 8. 既知の罠

### CSS Modules `@container` ソース順序

`live-stream.vue:450` の narrow レイアウト分岐 (`@container (max-width: 700px) or (aspect-ratio < 1/1)`) は、同名クラスの再定義を CSS Modules のソース順序に依存させている (コメント `live-stream.vue:448-449` に詳細あり)。`.playerContainer` にオーバーレイ用の `position: relative` を追加する際、この narrow ブロック側にも `.playerContainer` の再定義が既にある (`live-stream.vue:464-467`) ため、**base 定義とnarrow定義の両方に `position: relative` の整合が取れているか確認すること**。CSS Modules は詳細度ではなくソース順序で上書きが決まるため、narrow ブロックは必ずファイル末尾に置かれたままにする (移動しない)。

### 100cqh

`live-stream.vue:325` の `.watch { height: 100cqh; }` は `_pageContainer` (`container-type: size`) を基準にしたコンテナクエリ単位で、通常ページ・`MkPageWindow` (デッキ上のポップアップウィンドウ) どちらでも正しい高さに解決される設計 (詳細コメント `live-stream.vue:312-324`)。`MkStreamPlayer.vue` / `MkOmePlayer.vue` / `MkTwitchPlayer.vue` はいずれも `width: 100%; height: 100%;` で親のサイズに追従するのみとし、**新たに `100dvh` や `100vh` を使わないこと** (ビューポート基準の単位は `MkPageWindow` 内で誤動作する既知の罠、`live-stream.vue:320-324` のコメント参照)。

### KeepAlive での二重 create 防止

- `MkOmePlayer.vue` は `props.active` の変化 (`watch(() => props.active, ...)`) でのみ `createPlayer()`/`destroyPlayer()` を呼ぶ。`onMounted` 時にも `props.active` が true なら create するが、**`onActivated` では明示的に create を呼ばない** (`props.active` の変化を親 `live-stream.vue` の `onActivated`/`onDeactivated` (`live-stream.vue:263-268`) が `playerActive` 経由で駆動し、それが `MkStreamPlayer.vue` → `MkOmePlayer.vue` の `active` prop に伝播する設計のため、子コンポーネント自身が独自に `onActivated`/`onDeactivated` を持つと二重に create/destroy が走る危険がある)。
- `createPlayer()` の冒頭で `if (player != null) return;` のガードを必ず入れる (§2 スケルトン済み)。これが無いと、`watch(() => props.active)` と `onMounted` の両方から create が呼ばれた場合に二重 mount が起きる。
- `:key="activeSession.streamId"` (§5.2) によるコンポーネント再作成と、`props.active` による内部 create/destroy は独立した機構であることに注意。セッション切替時は `:key` 変化でコンポーネント自体が破棄されるため `onBeforeUnmount` の `destroyPlayer()` が呼ばれ、KeepAlive の deactivate とは別経路で確実にクリーンアップされる。

---

## 9. 検証チェックリスト

### 静的検証

- [ ] `pnpm lint` (typecheck + eslint、全パッケージ) が通る
- [ ] `pnpm --filter frontend build` が通り、`ovenplayer` が初期バンドルに含まれていないこと (dynamic import が効いているか、ビルド成果物の chunk 分割を確認)
- [ ] 新規ファイル (`MkOmePlayer.vue` / `MkTwitchPlayer.vue` / `MkStreamPlayer.vue`) すべてに SPDX ヘッダー (HTML コメント形式) が付いている
- [ ] `_liveChannel.*` 系の新規 i18n キーが `locales/ja-JP.yml` にのみ追加されている (他 locale yml は編集しない)

### 実機確認

- [ ] **自動再生**: OME 配信中に `/live/:acct` を開き、ミュート状態で自動再生が始まる
- [ ] **ミュート解除**: 「タップして音声オン」オーバーレイをクリックすると音声が出る。自前コントロールバーのミュートボタンでも解除できる
- [ ] **音量スライダー**: ドラッグで音量が変わり、リロード後も `miLocalStorage` の値が復元される
- [ ] **全画面**: 全画面ボタンでブラウザ全画面になる。iOS Safari 実機 (or シミュレータ) で `webkitEnterFullscreen` フォールバックが機能する (⚠ 実機必須、Chrome DevTools のデバイスエミュレーションでは検証不可)
- [ ] **切断→再接続**: OME 配信側 (OBS 等) を意図的に切断し、5 秒後に再接続を試みることを確認。複数回失敗させ、バックオフが 60 秒で頭打ちになることを確認
- [ ] **配信終了 → オフライン表示**: OME 側で正常に配信を止めた場合、watchdog が止まりオフライン表示に遷移すること (再接続ループに入らないこと)
- [ ] **Twitch⇔OME 切替**: 同一ユーザーが Twitch と OME を同時配信している状態を作り、セグメントトグルで両方に切り替えられること。切替のたびにチャットが正しい `streamId` に追従すること (トグル操作後にコメント投稿し、正しいセッションに紐づくか確認)
- [ ] **単一ライブ時の自動選択**: 片方のみ配信中の場合、トグルが表示されずそちらが自動選択されること
- [ ] **デッキ `MkPageWindow` 内表示**: デッキ UI からポップアップウィンドウとして `/live/:acct` を開き、100cqh レイアウトが正しく機能すること (ビューポートより小さい枠内でプレイヤーが正しい高さになる)
- [ ] **狭い画面 (縦長ペイン)**: `@container (max-width: 700px) or (aspect-ratio < 1/1)` の narrow レイアウトでプレイヤー・コントロールバー・トグル UI が破綻しないこと
