/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// グローバルオーディオプレイヤー: ページ遷移・スクロールをまたいで再生を継続する単一のシングルトン。
// <audio> 要素はこのモジュールの中に一つだけ存在する。

import { computed, reactive } from 'vue';
import * as Misskey from 'misskey-js';

export type AudioTrack = {
	id: string; // ドライブファイルID
	file: Misskey.entities.DriveFile;
	user?: Misskey.entities.UserLite | null;
	noteId?: string;
	/** リモートノートの場合、元サーバー上のノート URL (note.url ?? note.uri) */
	noteUrl?: string | null;
};

export type LoopMode = 'off' | 'one' | 'all';

const VOLUME_STORAGE_KEY = 'mkGlobalAudioPlayerVolume';
const LOOP_ORDER: LoopMode[] = ['off', 'one', 'all'];
const SEEK_STEP_SEC = 10;

function loadStoredVolume(): number {
	try {
		const raw = window.localStorage.getItem(VOLUME_STORAGE_KEY);
		if (raw == null) return 1;
		const parsed = parseFloat(raw);
		return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 1;
	} catch {
		return 1; // プライベートブラウジング等でlocalStorageが使えない場合
	}
}

function persistVolume(volume: number): void {
	try {
		window.localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
	} catch {
		// ignore
	}
}

const audioEl = new Audio();
audioEl.crossOrigin = 'anonymous';
audioEl.preload = 'metadata';

export const audioPlayerState = reactive({
	queue: [] as AudioTrack[],
	index: -1,
	playing: false,
	currentTime: 0,
	duration: 0,
	buffered: 0, // 0..1 の割合 (MkMediaRangeのbufferプロパティにそのまま渡せる)
	volume: loadStoredVolume(),
	muted: false,
	loop: 'off' as LoopMode,
});

audioEl.volume = audioPlayerState.volume;
audioEl.muted = audioPlayerState.muted;

export const hasQueue = computed(() => audioPlayerState.queue.length > 0);
export const currentTrack = computed<AudioTrack | null>(() => audioPlayerState.queue[audioPlayerState.index] ?? null);

// サムネイルが無いファイルは投稿者のアバターをアートワーク代わりに表示する。
export function trackArtworkUrl(track: AudioTrack | null | undefined): string | null {
	if (track == null) return null;
	return track.file.thumbnailUrl || track.user?.avatarUrl || null;
}

function syncBuffered(): void {
	const buffered = audioEl.buffered;
	if (buffered.length === 0 || !Number.isFinite(audioEl.duration) || audioEl.duration === 0) {
		audioPlayerState.buffered = 0;
		return;
	}
	let end = 0;
	for (let i = 0; i < buffered.length; i++) {
		if (buffered.end(i) > end) end = buffered.end(i);
	}
	audioPlayerState.buffered = end / audioEl.duration;
}

function hasMediaSession(): boolean {
	return typeof navigator !== 'undefined' && 'mediaSession' in navigator;
}

function updateMediaSessionMetadata(): void {
	if (!hasMediaSession() || typeof MediaMetadata === 'undefined') return;

	const track = currentTrack.value;
	if (track == null) {
		navigator.mediaSession.metadata = null;
		return;
	}

	const artist = track.user != null ? (track.user.name || track.user.username) : '';
	const artworkUrl = track.file.thumbnailUrl || track.user?.avatarUrl || null;

	navigator.mediaSession.metadata = new MediaMetadata({
		title: track.file.comment || track.file.name,
		artist,
		artwork: artworkUrl ? [{ src: artworkUrl }] : [],
	});
}

function updatePositionState(): void {
	if (!hasMediaSession() || typeof navigator.mediaSession.setPositionState !== 'function') return;
	if (!Number.isFinite(audioEl.duration) || audioEl.duration <= 0) return;

	try {
		navigator.mediaSession.setPositionState({
			duration: audioEl.duration,
			playbackRate: audioEl.playbackRate,
			position: Math.min(audioEl.currentTime, audioEl.duration),
		});
	} catch {
		// ブラウザによってはstate遷移の順序次第で例外になりうるが、致命的ではないので握りつぶす
	}
}

function setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null): void {
	try {
		navigator.mediaSession.setActionHandler(action, handler);
	} catch {
		// このブラウザでは未対応のactionの可能性
	}
}

function setupMediaSessionActions(): void {
	if (!hasMediaSession()) return;

	setActionHandler('play', () => play());
	setActionHandler('pause', () => pause());
	setActionHandler('previoustrack', () => prev());
	setActionHandler('nexttrack', () => next());
	setActionHandler('stop', () => clear());
	setActionHandler('seekto', (details) => {
		if (details.seekTime != null) seek(details.seekTime);
	});
	setActionHandler('seekbackward', (details) => {
		seek(Math.max(0, audioEl.currentTime - (details.seekOffset ?? SEEK_STEP_SEC)));
	});
	setActionHandler('seekforward', (details) => {
		seek(Math.min(audioEl.duration || Infinity, audioEl.currentTime + (details.seekOffset ?? SEEK_STEP_SEC)));
	});
}

function loadAt(i: number, autoplay: boolean): void {
	if (i < 0 || i >= audioPlayerState.queue.length) {
		audioPlayerState.index = -1;
		audioEl.pause();
		audioEl.removeAttribute('src');
		audioEl.load();
		audioPlayerState.playing = false;
		audioPlayerState.currentTime = 0;
		audioPlayerState.duration = 0;
		audioPlayerState.buffered = 0;
		updateMediaSessionMetadata();
		return;
	}

	audioPlayerState.index = i;
	const track = audioPlayerState.queue[i];
	audioEl.src = track.file.url;
	audioPlayerState.currentTime = 0;
	audioPlayerState.duration = 0;
	audioPlayerState.buffered = 0;
	updateMediaSessionMetadata();

	if (autoplay) {
		play();
	}
}

function play(): void {
	if (audioPlayerState.index === -1 && audioPlayerState.queue.length > 0) {
		loadAt(0, true);
		return;
	}

	// 自動再生ブロック等でrejectしうるが、再生ボタンが出たままになるだけなので握りつぶす
	audioEl.play().catch(() => {
		audioPlayerState.playing = false;
	});
}

function pause(): void {
	audioEl.pause();
}

function toggle(): void {
	if (audioEl.paused) {
		play();
	} else {
		pause();
	}
}

function onEnded(): void {
	if (audioPlayerState.loop === 'one') {
		audioEl.currentTime = 0;
		play();
		return;
	}

	const isLast = audioPlayerState.index >= audioPlayerState.queue.length - 1;
	if (isLast) {
		if (audioPlayerState.loop === 'all' && audioPlayerState.queue.length > 0) {
			loadAt(0, true);
		}
		// ループなしの場合は末尾で停止状態のまま留まる（キューは維持する）
	} else {
		loadAt(audioPlayerState.index + 1, true);
	}
}

function next(): void {
	if (audioPlayerState.queue.length === 0) return;

	if (audioPlayerState.index >= audioPlayerState.queue.length - 1) {
		if (audioPlayerState.loop === 'all') loadAt(0, true);
		return;
	}

	loadAt(audioPlayerState.index + 1, true);
}

function prev(): void {
	if (audioPlayerState.queue.length === 0) return;

	if (audioEl.currentTime > 3) {
		audioEl.currentTime = 0;
		return;
	}

	if (audioPlayerState.index <= 0) {
		if (audioPlayerState.loop === 'all' && audioPlayerState.queue.length > 1) {
			loadAt(audioPlayerState.queue.length - 1, true);
		} else {
			audioEl.currentTime = 0;
		}
		return;
	}

	loadAt(audioPlayerState.index - 1, true);
}

function seek(sec: number): void {
	if (!Number.isFinite(sec)) return;
	const max = Number.isFinite(audioEl.duration) ? audioEl.duration : sec;
	audioEl.currentTime = Math.min(Math.max(0, sec), max);
}

function setVolume(v: number): void {
	const clamped = Math.min(1, Math.max(0, v));
	audioPlayerState.volume = clamped;
	audioEl.volume = clamped;
	persistVolume(clamped);
}

function toggleMute(): void {
	audioPlayerState.muted = !audioPlayerState.muted;
	audioEl.muted = audioPlayerState.muted;
}

function cycleLoop(): void {
	const i = LOOP_ORDER.indexOf(audioPlayerState.loop);
	audioPlayerState.loop = LOOP_ORDER[(i + 1) % LOOP_ORDER.length];
}

function playTracks(tracks: AudioTrack[], startIndex = 0): void {
	if (tracks.length === 0) return;
	audioPlayerState.queue.splice(0, audioPlayerState.queue.length, ...tracks);
	loadAt(Math.min(Math.max(0, startIndex), tracks.length - 1), true);
}

function enqueue(tracks: AudioTrack[]): void {
	if (tracks.length === 0) return;
	const wasEmpty = audioPlayerState.queue.length === 0;
	audioPlayerState.queue.push(...tracks);
	if (wasEmpty) {
		loadAt(0, true);
	}
}

function playAt(i: number): void {
	loadAt(i, true);
}

function remove(i: number): void {
	if (i < 0 || i >= audioPlayerState.queue.length) return;

	const isCurrent = i === audioPlayerState.index;
	audioPlayerState.queue.splice(i, 1);

	if (audioPlayerState.queue.length === 0) {
		clear();
		return;
	}

	if (isCurrent) {
		const wasPlaying = audioPlayerState.playing;
		loadAt(Math.min(i, audioPlayerState.queue.length - 1), wasPlaying);
	} else if (i < audioPlayerState.index) {
		audioPlayerState.index -= 1;
	}
}

function clear(): void {
	audioEl.pause();
	audioEl.removeAttribute('src');
	audioEl.load();
	audioPlayerState.queue.splice(0, audioPlayerState.queue.length);
	audioPlayerState.index = -1;
	audioPlayerState.playing = false;
	audioPlayerState.currentTime = 0;
	audioPlayerState.duration = 0;
	audioPlayerState.buffered = 0;

	if (hasMediaSession()) {
		navigator.mediaSession.metadata = null;
		navigator.mediaSession.playbackState = 'none';
	}
}

audioEl.addEventListener('play', () => {
	audioPlayerState.playing = true;
	if (hasMediaSession()) navigator.mediaSession.playbackState = 'playing';
});

audioEl.addEventListener('pause', () => {
	audioPlayerState.playing = false;
	if (hasMediaSession()) navigator.mediaSession.playbackState = 'paused';
});

audioEl.addEventListener('timeupdate', () => {
	audioPlayerState.currentTime = audioEl.currentTime;
	updatePositionState();
});

audioEl.addEventListener('durationchange', () => {
	audioPlayerState.duration = Number.isFinite(audioEl.duration) ? audioEl.duration : 0;
});

audioEl.addEventListener('progress', syncBuffered);
audioEl.addEventListener('seeked', () => {
	audioPlayerState.currentTime = audioEl.currentTime;
	syncBuffered();
});
audioEl.addEventListener('ended', onEnded);

setupMediaSessionActions();

export {
	playTracks,
	enqueue,
	playAt,
	pause,
	toggle,
	next,
	prev,
	seek,
	setVolume,
	toggleMute,
	cycleLoop,
	remove,
	clear,
};
