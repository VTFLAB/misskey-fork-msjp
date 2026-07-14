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
import { ref, watch, onMounted, onBeforeUnmount, useTemplateRef } from 'vue';
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
// 起動は autoplay policy により必ず mute:true (createPlayer の config)。muted ref も true 起動で
// player の実状態と一致させる (localStorage からの復元はしない — §7 / L198-200 の方針どおり)。
// これを localStorage で初期化すると、前回 false 保存時に「オーバーレイをクリックしても
// muted が既に false で watch(muted) が発火せず setMute(false) が呼ばれない」不具合になる。
const muted = ref(true);

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

	player.setVolume(volume.value);
	// player の mute を UI 状態 (muted ref) に同期する。初回は muted=true (autoplay policy 準拠)、
	// ユーザーが一度 unmute した後の再接続 (destroy→create) では muted=false が復元されて音が戻る。
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
