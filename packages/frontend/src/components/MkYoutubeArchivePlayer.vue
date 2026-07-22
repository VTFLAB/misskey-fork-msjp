<!--
SPDX-FileCopyrightText: misskey-bsky-integration fork
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<!-- new YT.Player() に渡した playerEl は YouTube IFrame Player API により DOM 上で
	直接 <iframe> に置換される (公式仕様)。置換後の要素は Vue の仮想DOM管理から外れるため、
	playerEl 自体に :style 等のリアクティブなバインディングを持たせてはならない
	(バインディングした場合、置換前の初期値が iframe にそのまま焼き付いて以後更新されなくなる、
	という実装バグを踏んだ経緯がある)。ローディング中の隠蔽は重ねた MkLoading 側の
	z-index (v-if で消える) のみで行う -->
	<MkLoading v-if="initializing" :class="$style.loadingOverlay"/>
	<div ref="playerEl" :class="$style.player"></div>
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
	setVolume(volume: number): void;
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

// YouTube IFrame Player API の初期音量は既定で100% (爆音) になるため、
// 視聴開始時の初期値を控えめにしておく (bsky-fork 独自)。プレイヤー内蔵の
// 音量スライダーで視聴者は自由に変更できる (Misskey側で永続化はしない)
const DEFAULT_VOLUME = 50;

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
			// initializing の解除は onReady (実際にプレイヤーが操作可能になった時点) で行う。
			// new YT.Player() の呼び出し完了はプレイヤーの準備完了を意味しない
			onReady: () => {
				playerReady = true;
				player?.setVolume(DEFAULT_VOLUME);
				initializing.value = false;
			},
		},
	});
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

	// MkLoading (v-if) と player 用 div (常駐、YT.Player初期化後は内部でiframeに置換される) を
	// 同じセルに重ねて表示する。grid でなければ player 用 div がレイアウト上の高さを占有し続け、
	// MkLoading が中央からずれてしまう
	> * {
		grid-area: 1 / 1;
	}
}

// MkLoading を player より前面に重ねて隠す (player 側の div/置換後iframeには
// 一切スタイルバインディングを持たせない、理由は template 側コメント参照)
.loadingOverlay {
	z-index: 1;
	background: var(--MI_THEME-bg);
}

.player {
	width: 100%;
	height: 100%;
}
</style>
