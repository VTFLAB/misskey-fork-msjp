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
		<button class="_button" :class="$style.controlButton" :aria-label="i18n.ts._liveChannel.mute" @click="toggleMute">
			<i v-if="muted || volumeNum === 0" class="ti ti-volume-3"></i>
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

// タッチ/coarse pointer 環境 (スマホ等): hover が無く onMouseenter/onMousemove の
// オートハイドが機能しないため、controls を常時表示にする。PC (hover: hover) は
// 既存のオートハイド挙動を維持するため、このブロックの外側には一切影響しない (修正2)。
@media (hover: none) {
	.controls {
		opacity: 1;
		pointer-events: auto;
	}

	.controlButton {
		width: 44px;
		height: 44px;
	}

	.volumeSeekbar {
		width: 140px;
		// MkMediaRange 側の --thumbSize / --sliderBg は自身の CSS Modules スコープ
		// (.controlsSeekbar) で定義されるが、同一要素に付与される class なので
		// カスタムプロパティとして上書きできる (タッチ操作の当たり判定を拡大)。
		--thumbSize: 26px;
	}
}
</style>
