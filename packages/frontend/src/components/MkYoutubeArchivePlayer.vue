<!--
SPDX-FileCopyrightText: misskey-bsky-integration fork
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<MkLoading v-if="initializing"/>
	<div ref="playerEl" :class="$style.player" :style="{ visibility: initializing ? 'hidden' : 'visible' }"></div>
</div>
</template>

<script lang="ts">
// モジュールスコープ (bsky-fork 独自): YouTube IFrame Player API の最小限の型宣言 +
// スクリプトロードの Promise キャッシュ。このリポジトリの依存に公式型パッケージ
// (@types/youtube) が無く、今回のスコープでは新規 npm 依存を追加しない方針のため自前で最小限を宣言する。
// 複数の MkYoutubeArchivePlayer インスタンスが同時にマウントされても、<script> タグの注入と
// window.onYouTubeIframeAPIReady の登録は (setup ブロックはインスタンスごとに再実行されるため)
// このモジュールスコープの Promise キャッシュを介して 1 度だけ行われる。

interface YTPlayer {
	getCurrentTime(): number;
	seekTo(seconds: number, allowSeekAhead: boolean): void;
	destroy(): void;
}

interface YTPlayerOptions {
	videoId: string;
	width?: string | number;
	height?: string | number;
	events?: {
		onReady?: () => void;
	};
}

interface YTNamespace {
	Player: new (el: HTMLElement, options: YTPlayerOptions) => YTPlayer;
}

declare global {
	interface Window {
		YT?: YTNamespace;
		onYouTubeIframeAPIReady?: () => void;
	}
}

let iframeApiPromise: Promise<YTNamespace> | null = null;

function loadYoutubeIframeApi(): Promise<YTNamespace> {
	if (iframeApiPromise != null) return iframeApiPromise;

	iframeApiPromise = new Promise((resolve) => {
		if (window.YT?.Player != null) {
			resolve(window.YT);
			return;
		}
		// YouTube IFrame API はスクリプトの実行完了後にこの名前のグローバル関数を自動的に
		// 呼び出す (公式仕様)。他インスタンス由来のコールバックが既に登録されていた場合は連鎖呼び出しする
		const previous = window.onYouTubeIframeAPIReady;
		window.onYouTubeIframeAPIReady = () => {
			previous?.();
			resolve(window.YT!);
		};
		const script = window.document.createElement('script');
		script.async = true;
		script.src = 'https://www.youtube.com/iframe_api';
		window.document.head.appendChild(script);
	});

	return iframeApiPromise;
}
</script>

<script lang="ts" setup>
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import MkLoading from '@/components/global/MkLoading.vue';

const props = defineProps<{
	youtubeVideoId: string;
}>();

const playerEl = useTemplateRef('playerEl');
const initializing = ref(true);

let player: YTPlayer | null = null;
let playerReady = false;

onMounted(async () => {
	const YT = await loadYoutubeIframeApi();
	// API ロード待ちの間にアンマウントされていたら何もしない
	if (playerEl.value == null) return;
	player = new YT.Player(playerEl.value, {
		videoId: props.youtubeVideoId,
		width: '100%',
		height: '100%',
		events: {
			onReady: () => { playerReady = true; },
		},
	});
	initializing.value = false;
});

onBeforeUnmount(() => {
	playerReady = false;
	player?.destroy();
	player = null;
});

// 呼び出し元 (アーカイブ視聴ページ) が好きな頻度でポーリングする設計のため、
// このコンポーネント自身はポーリングタイマーを持たない (bsky-fork 独自)
function getCurrentTime(): number | null {
	if (player == null || !playerReady) return null;
	return player.getCurrentTime();
}

function seekTo(seconds: number): void {
	if (player == null || !playerReady) return;
	player.seekTo(seconds, true);
}

defineExpose({
	getCurrentTime,
	seekTo,
});
</script>

<style lang="scss" module>
.root {
	position: relative;
	width: 100%;
	aspect-ratio: 16 / 9;
	background: var(--MI_THEME-bg);
	display: grid;

	// MkLoading (v-if) と player 用 div (visibility 切り替えのため常駐) を同じセルに重ねて表示する。
	// grid でなければ player 用 div が visibility: hidden でもレイアウト上の高さを占有し続け、
	// MkLoading が中央からずれてしまう
	> * {
		grid-area: 1 / 1;
	}
}

.player {
	width: 100%;
	height: 100%;
}
</style>
