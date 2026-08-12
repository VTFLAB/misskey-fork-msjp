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

	<div v-if="offline && offlineImageUrl" :class="$style.offlineImageOverlay">
		<img :src="offlineImageUrl" :alt="i18n.ts._liveChannel.reconnecting" :class="$style.offlineImage"/>
	</div>
	<div v-else-if="offline" :class="$style.offlineOverlay">
		<span>{{ i18n.ts._liveChannel.reconnecting }}</span>
	</div>

	<!-- 自前コントロールバー: ホバーで表示するオートハイド -->
	<div :class="[$style.controls, { [$style.controlsVisible]: controlsVisible }]">
		<div :class="[$style.volumeGroup, { [$style.volumeGroupMuted]: muted || volumeNum === 0 }]">
			<button class="_button" :class="$style.controlButton" :aria-label="i18n.ts._liveChannel.mute" @click="toggleMute">
				<i v-if="muted || volumeNum === 0" class="ti ti-volume-3"></i>
				<i v-else-if="volumeNum < 0.5" class="ti ti-volume-2"></i>
				<i v-else class="ti ti-volume"></i>
			</button>
			<MkMediaRange v-model="volume" :class="$style.volumeSeekbar" :ariaLabel="i18n.ts.volume"/>
			<!-- SR にはスライダー値と二重に読まれる視覚専用の表示のため aria-hidden -->
			<span class="_noSelect" :class="$style.volumeValue" aria-hidden="true">{{ volumePercent }}%</span>
		</div>
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
	pageKey?: string; // 視聴ページ識別子 (acct)。音量をページごとに保持するためのキー。
	offlineImageUrl?: string | null; // 配信者が設定したオフライン画像。配信停止/再接続中に表示する。
}>();

const emit = defineEmits<{
	(ev: 'error', detail: { fatal: boolean }): void;
}>();

const playerElementId = `ome-player-${uuid()}`;
const rootEl = useTemplateRef('rootEl');
const playerContainerEl = useTemplateRef('playerContainerEl');

let player: OvenPlayerInstance | null = null;

// --- 音量/ミュート ---
// OvenPlayer の setVolume は 0-100 スケール (Provider.js: elVideo.volume = volume / 100)。
// MkMediaRange / volume ref は 0-1 スケールのため、player へ渡す際は必ず *100 する
// (これを忘れると最大でも 1% 音量になり「音量操作で無音=ミュート」に見える)。
// 音量は視聴ページ (props.pageKey = acct) ごとに JSON マップで保持する (bsky-fork 独自)。
const STORAGE_KEY_VOLUME = 'omePlayerVolume';
const DEFAULT_VOLUME = 0.5; // 初回ミュート解除時の既定音量 (最大は耳への負担が大きいため 50%)

function loadVolumeMap(): Record<string, number> {
	try {
		const parsed = JSON.parse(miLocalStorage.getItem(STORAGE_KEY_VOLUME) ?? '{}') as unknown;
		return (parsed != null && typeof parsed === 'object') ? parsed as Record<string, number> : {};
	} catch {
		return {};
	}
}

function savedVolume(): number | null {
	// MkMediaRange (defineModel<string | number>) は <input type="range"> の値を
	// 文字列で書き戻すため、localStorage には数値・数値文字列どちらが入っていてもおかしくない。
	// Number() で両対応にする (key 未存在時は undefined → Number(undefined) は NaN → null)。
	const raw = loadVolumeMap()[props.pageKey ?? ''];
	const n = Number(raw);
	return Number.isFinite(n) ? n : null;
}

function persistVolume(v: number | string): void {
	const map = loadVolumeMap();
	map[props.pageKey ?? ''] = Number(v);
	miLocalStorage.setItem(STORAGE_KEY_VOLUME, JSON.stringify(map));
}

// volume は 0-1 だが、MkMediaRange の v-model 経由でドラッグ操作すると文字列で書き戻される
// (defineModel<string | number> + <input type="range"> の value は常に string)。
// そのため volume 自体は string | number の両方を許容し、実際の判定・演算は必ず
// volumeNum (数値化した単一ソース) 経由で行う。
const volume = ref<string | number>(savedVolume() ?? DEFAULT_VOLUME);
const volumeNum = computed(() => {
	const n = Number(volume.value);
	return Number.isFinite(n) ? n : DEFAULT_VOLUME;
});
// コントロールバーに表示する音量パーセント。v-model 経由でドラッグ中もリアルタイムに追従する。
const volumePercent = computed(() => Math.round(volumeNum.value * 100));
// muted は player の実状態 (mute:true 起動) と一致させ true 起動。localStorage 復元はしない
// (§7 / L198-200)。localStorage 由来で false 起動すると、オーバーレイクリックで muted が
// 既に false になり watch が発火せず setMute(false) が呼ばれない不具合になる。
const muted = ref(true);

watch(volume, (v) => {
	const n = Number(v);
	const safe = Number.isFinite(n) ? n : DEFAULT_VOLUME;
	persistVolume(safe);
	player?.setVolume(safe * 100);
	// スライダーを 0 より大きくしたらミュート解除する (一般的なプレイヤー挙動、アイコンとも同期)。
	if (safe > 0 && muted.value) muted.value = false;
});

watch(muted, (m) => {
	player?.setMute(m);
});

function toggleMute() {
	// アイコンの表示条件 (muted || volumeNum === 0) と一致させる。無音状態から 1 クリックで復帰させる。
	const effectivelyMuted = muted.value || volumeNum.value === 0;
	if (effectivelyMuted) {
		// ミュート解除。音量が 0 のままだと無音になるので保存値 or 既定へ戻す。
		if (volumeNum.value === 0) volume.value = savedVolume() ?? DEFAULT_VOLUME;
		muted.value = false;
	} else {
		muted.value = true;
	}
}

// --- autoplay policy: mute:true で起動し、初回インタラクションでオーバーレイを消す (§7) ---
const showUnmuteOverlay = ref(true);

function onUnmuteOverlayClick() {
	// 仕様: 保持している音量があれば復元、なければ既定 50% で有効化する (最大は耳を痛めるため)。
	volume.value = savedVolume() ?? DEFAULT_VOLUME;
	muted.value = false;
	showUnmuteOverlay.value = false;
}

// --- オートハイド (ホバー時のみコントロール表示) ---
const controlsVisible = ref(false);
let hideTimer: number | null = null;

function onMouseenter() {
	controlsVisible.value = true;
}

function onMousemove() {
	controlsVisible.value = true;
	if (hideTimer != null) window.clearTimeout(hideTimer);
	hideTimer = window.setTimeout(() => { controlsVisible.value = false; }, 2500);
}

function onMouseleave() {
	if (hideTimer != null) window.clearTimeout(hideTimer);
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
let reconnectTimer: number | null = null;
let reconnectDelayMs = 5000;
const RECONNECT_DELAY_MAX_MS = 60000;
let watchdogStopped = false;

function clearReconnectTimer() {
	if (reconnectTimer != null) {
		window.clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
}

function scheduleReconnect() {
	if (watchdogStopped) return;
	clearReconnectTimer();
	reconnectTimer = window.setTimeout(async () => {
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

	// setVolume は 0-100 スケール (volume ref は 0-1)。setMute で UI 状態に同期する。
	// 初回は muted=true (autoplay policy 準拠)、unmute 後の再接続 (destroy→create) では
	// muted=false / 保持音量が復元されて音が戻る。
	player.setVolume(volumeNum.value * 100);
	player.setMute(muted.value);

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

	// ovenplayer (node_modules/ovenplayer、サードパーティ) が自身のルート要素として生成する
	// .op-wrapper は height を指定せず、代わりに内部の空 div .op-ratio が
	// padding-bottom:56.25% (幅に対する16:9、古典的な padding-bottom trick) で
	// .op-wrapper の実質的な高さを「幅×9/16」に固定している。実映像/UI を持つ .op-player は
	// .op-wrapper を基準に position:absolute; height:100% で重なるだけなので、結局その高さに
	// 縛られる。呼び出し元 (live-stream.watch.vue) の .playerContainer は aspect-ratio 固定を
	// 使わず画面の残り高さいっぱいに広げる設計のため、このままだと 16:9 分しか使われず
	// 下に大きな黒帯が残る (実機の DOM 計測で確認済み)。
	// !important が必要な理由: .op-ratio 側の実セレクタは .op-wrapper.ovenplayer .op-ratio
	// という 3 クラス複合セレクタ (padding-bottom に !important 無し) で、ここでの記述
	// (単一クラスの子孫セレクタ) より詳細度が高いため、!important を付けないと確実には勝てない。
	// .op-wrapper / .op-ratio は ovenplayer が配布する CSS 由来のクラス名なので、
	// ovenplayer をバージョンアップした際はこれらのクラス名が変わっていないか要確認
	// (変わっていた場合、この上書きが無効化されて本バグが再発する)。
	// なお .op-wrapper.ovenplayer.op-fullscreen{height:100vh !important} は 3 クラス複合で
	// 詳細度がさらに高いため、フルスクリーン時の挙動とは衝突しない。
	//
	// 【重要】.playerContainer (#playerElementId の div) ではなく、この .root に書くこと。
	// ovenplayer は createPlayer() 時に #playerElementId 要素そのものを .op-wrapper 要素で
	// 置き換える (要素の中に挿入するのではなく置換する) ため、初期化後は .playerContainer
	// 自身がDOMから無くなり、.op-wrapper の親は直接 .root になる (実機DOM調査で確認済み)。
	// .playerContainer 側に :global(.op-wrapper) を書いても対象要素が存在せず無効になる。
	:global(.op-wrapper) {
		height: 100% !important;
	}
	:global(.op-ratio) {
		padding-bottom: 0 !important;
	}
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

// 配信者が設定したオフライン画像。OvenPlayer 内部のエラー UI が透けて見えないよう
// inset:0 + z-index で最前面に置く (修正3)。
.offlineImageOverlay {
	position: absolute;
	inset: 0;
	z-index: 10;
	display: flex;
	align-items: center;
	justify-content: center;
	background: #000;
	pointer-events: none;
}

.offlineImage {
	width: 100%;
	height: 100%;
	object-fit: contain;
}

// 注: このコンポーネントのオーバーレイ配色は、テーマに関わらず常に黒背景の映像上へ
// 重ねる前提のため、--MI_THEME-* ではなく白/黒の直値で統一している (既存踏襲)。
.controls {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0;
	// .offlineImageOverlay (z-index: 10) より確実に前面へ出す。オフライン画像表示中も
	// ミュート/フルスクリーン操作を維持するため。
	z-index: 20;
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 28px 12px 8px;
	background: linear-gradient(to top, rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0.4) 55%, transparent);
	opacity: 0;
	transform: translateY(4px);
	transition: opacity 200ms ease, transform 200ms ease;
	pointer-events: none;
}

.controlsVisible {
	opacity: 1;
	transform: translateY(0);
	pointer-events: auto;
}

.controlButton {
	color: #fff;
	width: 36px;
	height: 36px;
	font-size: 15px;
	border-radius: 6px;
	transition: background 150ms ease;

	&:hover {
		background: rgba(255, 255, 255, 0.15);
	}
}

.volumeGroup {
	display: flex;
	align-items: center;
	gap: 4px;

	// :focus-within を併置することで、スライダーをドラッグ中にポインタが上下へ
	// はみ出しても (input が focus を持つ限り) 畳まれない。
	// ホバー展開はホバーが存在する環境に限定する。メディアクエリ無しで書くと、タッチ環境で
	// スライダー操作 (focus-within) のたびに常時展開幅 (140px) から 90px へ縮む競合が起きる。
	@media (hover: hover) {
		&:hover,
		&:focus-within {
			.volumeSeekbar {
				width: 90px;
				opacity: 1;
			}
		}
	}

	// .volumeGroup 配下にネストして詳細度を (0,2,0) に上げる。--sliderBg / --thumbSize は
	// MkMediaRange 側 .controlsSeekbar (同一要素・詳細度 0,1,0) にも定義があり、同詳細度だと
	// 勝敗が CSS Modules の出力順に依存してしまうため (§8 のソース順序の罠)。
	.volumeSeekbar {
		min-width: 0;
		overflow: hidden;
		transition: width 200ms ease, opacity 200ms ease;
		--sliderBg: rgba(255, 255, 255, 0.3);
		--thumbSize: 13px;

		// MkMediaRange の塗りは currentColor (既定はテーマ accent 色)。映像上のオーバーレイでは
		// 白塗りが定番なので、内部の <input type="range"> へ要素セレクタで色を上書きする
		// (子の class 名は CSS Modules でハッシュ化されるため要素セレクタで狙う)。
		input[type='range'] {
			color: #fff;
		}

		// 配信プレイヤー定番の挙動: ホバー環境では普段は畳み、音量まわりのホバー/フォーカスで
		// 展開する (上の &:hover / &:focus-within)。パーセント表示は常時見えるので、
		// 畳まれていても現在音量は分かる。
		@media (hover: hover) {
			width: 0;
			opacity: 0;
		}

		// hover が無い環境ではホバー展開が成立しないため常時展開。--thumbSize はタッチの
		// 当たり判定を拡大。
		@media (hover: none) {
			width: 140px;
			--thumbSize: 26px;
		}
	}
}

// ミュート中/音量0 はパーセント表示を減光してアイコンと状態を揃える
.volumeGroupMuted .volumeValue {
	opacity: 0.5;
}

.volumeValue {
	min-width: 4ch;
	text-align: center;
	font-size: 0.85em;
	font-variant-numeric: tabular-nums;
	color: #fff;
}

.spacer {
	flex: 1;
}

// タッチ/coarse pointer 環境 (スマホ等): hover が無く onMouseenter/onMousemove の
// オートハイドが機能しないため、controls を常時表示にする。PC (hover: hover) は
// 既存のオートハイド挙動を維持するため、このブロックの外側には一切影響しない (修正2)。
@media (hover: none) {
	.controls {
		opacity: 1;
		transform: none;
		pointer-events: auto;
	}

	.controlButton {
		width: 44px;
		height: 44px;
	}

	// 音量バーの常時展開・--thumbSize 拡大は .volumeGroup 側の @media (hover: none) で定義済み
}
</style>
