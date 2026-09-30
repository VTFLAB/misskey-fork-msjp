/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 常駐オーディオプレイヤーの YouTube 再生エンジン (bsky-fork 独自)。
// YouTube の規約上、動画は画面に表示したまま再生する必要があるため、ミニプレイヤー (audio-player-dock) が
// 動画の表示領域 (host) を attach し、このモジュールがその中に YouTube IFrame Player を 1 つだけ作って使い回す。
// 動画上のコントロールは公式の playerVars (controls=0 等) で消し、操作はプレイヤー側から行う。
// 再生状態の変化は handlers 経由で audio-player.ts に通知する (このモジュールは audio-player.ts を import しない)。

import { loadYoutubeIframeApi, YT_STATE } from '@/utility/youtube-iframe-api.js';
import type { YTPlayer } from '@/utility/youtube-iframe-api.js';

export type YoutubeEngineHandlers = {
	onPlay: () => void;
	onPause: () => void;
	onEnded: () => void;
	onError: (code: number) => void;
	onTick: (currentTime: number, duration: number, buffered: number) => void;
};

// 動画を読み込めなかった場合に onError へ渡すコード (YouTube 側のエラーコードとは別に、API スクリプトの読み込み失敗)
export const YOUTUBE_API_LOAD_ERROR = -1;

const TICK_INTERVAL_MS = 250;

let handlers: YoutubeEngineHandlers | null = null;
let host: HTMLElement | null = null;
let player: YTPlayer | null = null;
let ready = false;
let creating = false;
// 再生したい動画 (プレイヤーの準備完了前に要求された場合もここに残し、準備完了時に反映する)
let desired: { videoId: string; autoplay: boolean; startSeconds: number } | null = null;
let volume = 1;
let muted = false;
let tickTimer: number | null = null;
// loadVideoById 直後は前の動画の再生位置・長さが返ってくるため、新しい動画の状態通知が来るまで tick を止める
let awaitingState = false;
// プレイヤーに最後に読み込ませた動画 ID
let loadingVideoId: string | null = null;
// 再生せずに読み込んだ (cue した) 動画の開始位置。cue 中は getCurrentTime が 0 を返すので、表示にはこちらを使う
let cuedStart: number | null = null;

export function setYoutubeHandlers(h: YoutubeEngineHandlers): void {
	handlers = h;
}

function startTick(): void {
	if (tickTimer != null) return;
	tickTimer = window.setInterval(tick, TICK_INTERVAL_MS);
}

function stopTick(): void {
	if (tickTimer == null) return;
	window.clearInterval(tickTimer);
	tickTimer = null;
}

function tick(): void {
	if (player == null || !ready || desired == null || awaitingState) return;
	try {
		const currentTime = cuedStart ?? player.getCurrentTime();
		handlers?.onTick(currentTime, player.getDuration(), player.getVideoLoadedFraction());
	} catch {
		// プレイヤーの破棄直後などに呼ばれた場合は無視する
	}
}

function applyVolume(): void {
	if (player == null || !ready) return;
	player.setVolume(Math.round(volume * 100));
	if (muted) {
		player.mute();
	} else {
		player.unMute();
	}
}

function applyDesired(): void {
	if (player == null || !ready || desired == null) return;
	awaitingState = true;
	loadingVideoId = desired.videoId;
	const args = { videoId: desired.videoId, startSeconds: desired.startSeconds };
	if (desired.autoplay) {
		cuedStart = null;
		player.loadVideoById(args);
	} else {
		cuedStart = desired.startSeconds;
		player.cueVideoById(args);
	}
	startTick();
}

async function ensurePlayer(): Promise<void> {
	if (player != null || creating || host == null) return;
	creating = true;
	try {
		const YT = await loadYoutubeIframeApi();
		// API ロード待ちの間に host が外されていたら何もしない
		if (host == null || player != null) return;
		// YT.Player は渡した要素を <iframe> に置き換えるので、host 自体ではなく中に作った要素を渡す
		const target = window.document.createElement('div');
		host.replaceChildren(target);
		// 破棄済みの古いプレイヤーから遅れて届いたイベントを無視するため、作成したインスタンスを控えておく
		// (コールバックは非同期に呼ばれるので、この時点で created は代入済み)
		const isCurrent = () => player === created;
		const created: YTPlayer = new YT.Player(target, {
			width: '100%',
			height: '100%',
			playerVars: {
				controls: 0,
				disablekb: 1,
				fs: 0,
				iv_load_policy: 3,
				rel: 0,
				playsinline: 1,
			},
			events: {
				onReady: () => {
					if (!isCurrent()) return;
					ready = true;
					applyVolume();
					applyDesired();
				},
				onStateChange: (ev) => {
					// 音声ファイルの曲に切り替えた後 (stopVideo による状態変化など) は通知しない
					if (!isCurrent() || desired == null) return;
					switch (ev.data) {
						case YT_STATE.PLAYING:
							awaitingState = false;
							cuedStart = null;
							handlers?.onPlay();
							startTick();
							break;
						case YT_STATE.PAUSED:
						case YT_STATE.CUED:
							awaitingState = false;
							handlers?.onPause();
							tick();
							break;
						case YT_STATE.ENDED:
							awaitingState = false;
							tick();
							handlers?.onEnded();
							break;
					}
				},
				onError: (ev) => {
					if (!isCurrent() || desired == null) return;
					// 読み込み中の動画 ID と、エラーが起きた時点の動画 ID が一致する場合だけ通知する
					// (切り替え直後に前の動画のエラーが届いて、新しい動画まで飛ばしてしまうのを防ぐ)
					const erroredVideoId = loadingVideoId;
					if (erroredVideoId != null && erroredVideoId !== desired.videoId) return;
					handlers?.onError(ev.data);
				},
			},
		});
		player = created;
	} catch {
		handlers?.onError(YOUTUBE_API_LOAD_ERROR);
	} finally {
		creating = false;
	}
}

function destroyPlayer(): void {
	stopTick();
	ready = false;
	awaitingState = false;
	try {
		player?.destroy();
	} catch {
		// ignore
	}
	player = null;
	host?.replaceChildren();
}

// ミニプレイヤーが動画の表示領域をマウントしたときに呼ぶ。再生待ちの動画があればプレイヤーを作る
export function attachYoutubeHost(el: HTMLElement): void {
	if (host === el) return;
	if (host != null) destroyPlayer();
	host = el;
	if (desired != null) ensurePlayer();
}

export function detachYoutubeHost(el: HTMLElement): void {
	if (host !== el) return;
	destroyPlayer();
	host = null;
}

export function youtubeLoad(videoId: string, autoplay: boolean, startSeconds = 0): void {
	desired = { videoId, autoplay, startSeconds };
	if (player == null) {
		ensurePlayer();
		return;
	}
	applyDesired();
}

export function youtubePlay(): void {
	if (desired == null) return;
	if (player == null || !ready) {
		desired.autoplay = true;
		ensurePlayer();
		return;
	}
	player.playVideo();
}

export function youtubePause(): void {
	if (desired != null) desired.autoplay = false;
	if (player == null || !ready) return;
	player.pauseVideo();
}

// 音声ファイルの曲へ切り替えたとき・キューを空にしたときに呼ぶ
export function youtubeStop(): void {
	desired = null;
	cuedStart = null;
	stopTick();
	if (player == null || !ready) return;
	player.stopVideo();
}

export function youtubeSeek(sec: number): void {
	if (desired == null) return;
	// cue 中に seekTo すると再生が始まってしまう (公式仕様) ため、開始位置を変えて cue し直す
	if (cuedStart != null || player == null || !ready) {
		desired = { ...desired, autoplay: false, startSeconds: sec };
		applyDesired();
		return;
	}
	player.seekTo(sec, true);
}

export function youtubeSetVolume(v: number): void {
	volume = v;
	applyVolume();
}

export function youtubeSetMuted(m: boolean): void {
	muted = m;
	applyVolume();
}
