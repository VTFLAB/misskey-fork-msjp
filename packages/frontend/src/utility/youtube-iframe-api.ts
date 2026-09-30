/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// YouTube IFrame Player API の最小限の型宣言 + スクリプトロードの Promise キャッシュ (bsky-fork 独自)。
// このリポジトリの依存に公式型パッケージ (@types/youtube) が無く、新規 npm 依存を追加しない方針のため
// 自前で最小限を宣言する。<script> タグの注入と window.onYouTubeIframeAPIReady の登録は、
// 複数の利用箇所 (アーカイブ視聴プレイヤー・常駐オーディオプレイヤー) があってもこのモジュールで 1 度だけ行う。

export interface YTPlayer {
	getCurrentTime(): number;
	getDuration(): number;
	getVideoLoadedFraction(): number;
	getPlayerState(): number;
	seekTo(seconds: number, allowSeekAhead: boolean): void;
	setVolume(volume: number): void;
	mute(): void;
	unMute(): void;
	playVideo(): void;
	pauseVideo(): void;
	stopVideo(): void;
	loadVideoById(args: { videoId: string; startSeconds?: number }): void;
	cueVideoById(args: { videoId: string; startSeconds?: number }): void;
	cuePlaylist(args: { list: string; listType: 'playlist'; index?: number }): void;
	getPlaylist(): string[] | null;
	destroy(): void;
}

export interface YTPlayerOptions {
	videoId?: string;
	width?: string | number;
	height?: string | number;
	playerVars?: Record<string, string | number>;
	events?: {
		onReady?: () => void;
		onStateChange?: (ev: { data: number }) => void;
		onError?: (ev: { data: number }) => void;
	};
}

export interface YTNamespace {
	Player: new (el: HTMLElement, options: YTPlayerOptions) => YTPlayer;
}

// YT.PlayerState の値 (公式仕様)
export const YT_STATE = {
	UNSTARTED: -1,
	ENDED: 0,
	PLAYING: 1,
	PAUSED: 2,
	BUFFERING: 3,
	CUED: 5,
} as const;

declare global {
	interface Window {
		YT?: YTNamespace;
		onYouTubeIframeAPIReady?: () => void;
	}
}

let iframeApiPromise: Promise<YTNamespace> | null = null;

export function loadYoutubeIframeApi(): Promise<YTNamespace> {
	if (iframeApiPromise != null) return iframeApiPromise;

	iframeApiPromise = new Promise((resolve, reject) => {
		if (window.YT?.Player != null) {
			resolve(window.YT);
			return;
		}
		// YouTube IFrame API はスクリプトの実行完了後にこの名前のグローバル関数を自動的に
		// 呼び出す (公式仕様)。他由来のコールバックが既に登録されていた場合は連鎖呼び出しする
		const previous = window.onYouTubeIframeAPIReady;
		window.onYouTubeIframeAPIReady = () => {
			previous?.();
			resolve(window.YT!);
		};
		const script = window.document.createElement('script');
		script.async = true;
		script.src = 'https://www.youtube.com/iframe_api';
		script.onerror = () => {
			// 次回呼び出し時に再試行できるようキャッシュを捨てる
			iframeApiPromise = null;
			reject(new Error('Failed to load YouTube IFrame API'));
		};
		window.document.head.appendChild(script);
	});

	return iframeApiPromise;
}

// YouTube / YouTube Music のプレイリスト URL (または ID そのもの) からプレイリスト ID を取り出す。
// YouTube Music の "VL" 付き ID は通常の ID に直す。中身が毎回変わる自動生成のミックス (RD...) は対象外
export function extractYoutubePlaylistId(raw: string): { id: string; isMusic: boolean } | { error: 'mix' } | null {
	const text = raw.trim();
	let id: string | null = null;
	let isMusic = false;
	try {
		const url = new URL(text);
		const host = url.hostname.toLowerCase();
		if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) return null;
		isMusic = host === 'music.youtube.com';
		id = url.searchParams.get('list');
	} catch {
		id = text;
	}
	if (id == null || !/^[A-Za-z0-9_-]{2,64}$/.test(id)) return null;
	if (id.startsWith('VL')) id = id.slice(2);
	if (id.startsWith('RD')) return { error: 'mix' };
	return { id, isMusic };
}

// YouTube / YouTube Music の共有 URL から動画 ID を取り出す。該当しなければ null
export function extractYoutubeVideoId(raw: string): string | null {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return null;
	}
	const host = url.hostname.toLowerCase();
	let id: string | null = null;
	if (host === 'youtu.be') {
		id = url.pathname.slice(1).split('/')[0] ?? null;
	} else if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
		if (url.pathname === '/watch') {
			id = url.searchParams.get('v');
		} else {
			const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
			id = m?.[1] ?? null;
		}
	}
	return id != null && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}
