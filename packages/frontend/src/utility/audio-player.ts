/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// グローバルオーディオプレイヤー: ページ遷移・スクロールをまたいで再生を継続する単一のシングルトン。
// <audio> 要素はこのモジュールの中に一つだけ存在する。
// YouTube の曲 (bsky-fork 独自) は audio-player-youtube.ts の IFrame Player で再生し、再生位置・状態は
// どちらの再生方式でも audioPlayerState に集約する。

import { computed, reactive, watch } from 'vue';
import * as Misskey from 'misskey-js';
import { genId } from '@/utility/id.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import {
	setYoutubeHandlers,
	youtubeLoad,
	youtubePlay,
	youtubePause,
	youtubeStop,
	youtubeSeek,
	youtubeSetVolume,
	youtubeSetMuted,
} from '@/utility/audio-player-youtube.js';
import { refreshStaleYoutubeTracks } from '@/utility/youtube-metadata.js';

export type FileAudioTrack = {
	kind?: 'file';
	id: string; // ドライブファイルID
	file: Misskey.entities.DriveFile;
	user?: Misskey.entities.UserLite | null;
	noteId?: string;
	/** リモートノートの場合、元サーバー上のノート URL (note.url ?? note.uri) */
	noteUrl?: string | null;
	/** キュー内でエントリを一意に識別するキー (同じファイルを複数回積めるため id とは別)。キュー投入時に採番する */
	qid?: string;
};

export type YoutubeTrackInfo = {
	videoId: string;
	title: string;
	author: string | null;
	thumbnailUrl: string | null;
	/** 共有・NowPlaying 用の URL (YouTube Music から追加した場合は music.youtube.com) */
	url: string;
	service: 'youtube' | 'youtubeMusic';
	/** 曲名等を YouTube から取得した日時 (ms)。YouTube API ポリシー (III.E.4) により 30 日以内に取得し直す */
	fetchedAt?: number;
	/** 再生できない理由。削除・非公開は定期更新 (oEmbed) で、埋め込み不可などは再生時のエラーで判明する */
	unavailable?: YoutubeUnavailableReason | null;
};

export type YoutubeUnavailableReason = 'removed' | 'private' | 'notEmbeddable' | 'unavailable';

export function isUnplayableTrack(track: AudioTrack | null | undefined): boolean {
	return track?.kind === 'youtube' && track.youtube.unavailable != null;
}

export function trackUnavailableLabel(track: AudioTrack | null | undefined): string | null {
	if (track?.kind !== 'youtube' || track.youtube.unavailable == null) return null;
	switch (track.youtube.unavailable) {
		case 'removed': return i18n.ts._audioPlayer.videoRemoved;
		case 'private': return i18n.ts._audioPlayer.videoPrivate;
		case 'notEmbeddable': return i18n.ts._audioPlayer.videoNotEmbeddable;
		default: return i18n.ts._audioPlayer.videoUnavailable;
	}
}

export type YoutubeAudioTrack = {
	kind: 'youtube';
	id: string; // `yt:${videoId}`
	youtube: YoutubeTrackInfo;
	qid?: string;
};

export type AudioTrack = FileAudioTrack | YoutubeAudioTrack;

// プレイリスト・再生セッションの保存用に、再生・表示・NowPlaying に必要な項目だけを残した軽量なスナップショットにする。
// DriveFile / UserLite を丸ごと保存すると 1 曲 2KB 前後になり、API の body 上限 (1MB) に近づくため。
// 再生キュー用の qid も保存しない。
export function toPersistableTrack(track: AudioTrack): AudioTrack {
	if (track.kind === 'youtube') {
		return { kind: 'youtube', id: track.id, youtube: { ...track.youtube } };
	}
	const file = track.file;
	const user = track.user ?? null;
	return {
		id: track.id,
		file: {
			id: file.id,
			createdAt: file.createdAt,
			name: file.name,
			type: file.type,
			md5: file.md5,
			size: file.size,
			isSensitive: file.isSensitive,
			blurhash: null,
			properties: {},
			url: file.url,
			thumbnailUrl: file.thumbnailUrl,
			comment: file.comment,
			folderId: null,
			folder: null,
			userId: null,
			user: null,
		} as Misskey.entities.DriveFile,
		user: user == null ? null : {
			id: user.id,
			name: user.name,
			username: user.username,
			host: user.host,
			avatarUrl: user.avatarUrl,
			avatarBlurhash: null,
			avatarDecorations: [],
			isBot: user.isBot,
			isCat: user.isCat,
			instance: user.instance != null ? { ...user.instance } : undefined,
			emojis: {},
			onlineStatus: 'unknown',
			badgeRoles: [],
		} as Misskey.entities.UserLite,
		noteId: track.noteId,
		noteUrl: track.noteUrl ?? null,
	};
}

export function createYoutubeTrack(info: YoutubeTrackInfo): YoutubeAudioTrack {
	return { kind: 'youtube', id: `yt:${info.videoId}`, youtube: info };
}

export type LoopMode = 'off' | 'one' | 'all';

const VOLUME_STORAGE_KEY = 'mkGlobalAudioPlayerVolume';
const LOOP_ORDER: LoopMode[] = ['off', 'one', 'all'];
const SEEK_STEP_SEC = 10;

// YouTube の曲の連続再生失敗数 (下の onError ハンドラ参照)
let youtubeErrorStreak = 0;

// 再生セッション (キュー・再生中の曲・再生位置) の保存先 (bsky-fork 独自)。ページの再読み込みや
// キャッシュクリア後に同じ状態へ戻すため。キューは大きくなりうるので、頻繁に更新する再生位置とはキーを分ける
// アカウントを切り替えた際に別アカウントのキューが出ないよう、アカウントごとに分ける
const SESSION_ACCOUNT = $i?.id ?? 'guest';
const SESSION_QUEUE_KEY = `mkGlobalAudioPlayerQueue:${SESSION_ACCOUNT}`;
const SESSION_POSITION_KEY = `mkGlobalAudioPlayerPosition:${SESSION_ACCOUNT}`;
const SESSION_MAX_TRACKS = 1000;
const POSITION_SAVE_INTERVAL_MS = 5000;

// 裏 (タブ非表示・アプリ切り替え・画面消灯) にいる間に YouTube の曲の順番が来たときは再生を始めず、
// 画面に戻ったら再開する。YouTube API のポリシーは、表示されていないプレイヤーでの再生機能を禁止している
let resumeYoutubeOnVisible = false;
// 再読み込み後の復元などで、読み込み完了後にシークしたい位置
let pendingStartAt: number | null = null;

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
	// ナビゲーションから呼び出したときは、キューが空でもミニプレイヤーを表示する
	dockRequested: false,
});

audioEl.volume = audioPlayerState.volume;
audioEl.muted = audioPlayerState.muted;
youtubeSetVolume(audioPlayerState.volume);

export const hasQueue = computed(() => audioPlayerState.queue.length > 0);
export const dockShown = computed(() => hasQueue.value || audioPlayerState.dockRequested);

export function showDock(): void {
	audioPlayerState.dockRequested = true;
}

// ミニプレイヤーの閉じるボタン: 再生を止めてキューを空にし、プレイヤーを隠す
export function closeDock(): void {
	clear();
	audioPlayerState.dockRequested = false;
}
export const currentTrack = computed<AudioTrack | null>(() => audioPlayerState.queue[audioPlayerState.index] ?? null);

const isYoutubeCurrent = computed(() => currentTrack.value?.kind === 'youtube');
export { isYoutubeCurrent };

// サムネイルが無いファイルは投稿者のアバターをアートワーク代わりに表示する。
export function trackArtworkUrl(track: AudioTrack | null | undefined): string | null {
	if (track == null) return null;
	if (track.kind === 'youtube') return track.youtube.thumbnailUrl;
	return track.file.thumbnailUrl || track.user?.avatarUrl || null;
}

export function trackTitle(track: AudioTrack | null | undefined): string {
	if (track == null) return '';
	if (track.kind === 'youtube') return track.youtube.title;
	return track.file.comment || track.file.name;
}

export function trackNoteId(track: AudioTrack | null | undefined): string | null {
	if (track == null || track.kind === 'youtube') return null;
	return track.noteId ?? null;
}

export function trackArtist(track: AudioTrack | null | undefined): string {
	if (track == null) return '';
	if (track.kind === 'youtube') return track.youtube.author ?? '';
	return track.user != null ? (track.user.name || track.user.username) : '';
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

	const artworkUrl = trackArtworkUrl(track);

	navigator.mediaSession.metadata = new MediaMetadata({
		title: trackTitle(track),
		artist: trackArtist(track),
		artwork: artworkUrl ? [{ src: artworkUrl }] : [],
	});
}

function updatePositionState(): void {
	if (!hasMediaSession() || typeof navigator.mediaSession.setPositionState !== 'function') return;
	const duration = audioPlayerState.duration;
	if (!Number.isFinite(duration) || duration <= 0) return;

	try {
		navigator.mediaSession.setPositionState({
			duration,
			playbackRate: 1,
			position: Math.min(audioPlayerState.currentTime, duration),
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
		seek(Math.max(0, audioPlayerState.currentTime - (details.seekOffset ?? SEEK_STEP_SEC)));
	});
	setActionHandler('seekforward', (details) => {
		seek(Math.min(audioPlayerState.duration || Infinity, audioPlayerState.currentTime + (details.seekOffset ?? SEEK_STEP_SEC)));
	});
}

// i から direction 方向に、再生できる曲を探す (i 自身は含まない)。全曲ループ時のみ端で折り返す
function findPlayableIndex(i: number, direction: 1 | -1): number | null {
	const length = audioPlayerState.queue.length;
	for (let step = 1; step < length; step++) {
		let j = i + direction * step;
		if (j < 0 || j >= length) {
			if (audioPlayerState.loop !== 'all') return null;
			j = (j + length) % length;
		}
		if (!isUnplayableTrack(audioPlayerState.queue[j])) return j;
	}
	return null;
}

function loadAt(i: number, autoplay: boolean, startAt = 0, direction: 1 | -1 = 1): void {
	resumeYoutubeOnVisible = false;
	pendingStartAt = null;

	// 削除・非公開などで再生できない YouTube の曲は、リストには残したまま飛ばす
	if (autoplay && i >= 0 && i < audioPlayerState.queue.length && isUnplayableTrack(audioPlayerState.queue[i])) {
		const j = findPlayableIndex(i, direction);
		if (j != null) {
			i = j;
			startAt = 0;
		} else {
			autoplay = false;
		}
	}
	if (i < 0 || i >= audioPlayerState.queue.length) {
		audioPlayerState.index = -1;
		youtubeStop();
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
	audioPlayerState.currentTime = startAt;
	audioPlayerState.duration = 0;
	audioPlayerState.buffered = 0;

	if (track.kind === 'youtube') {
		audioEl.pause();
		audioEl.removeAttribute('src');
		audioEl.load();
		audioPlayerState.playing = false;
		updateMediaSessionMetadata();
		if (track.youtube.unavailable != null) {
			// 再生できない曲を選んだまま止める (プレイヤーには読み込まない)
			youtubeStop();
			if (hasMediaSession()) navigator.mediaSession.playbackState = 'paused';
			savePosition();
			return;
		}
		const hidden = window.document.visibilityState === 'hidden';
		if (autoplay && hidden) {
			resumeYoutubeOnVisible = true;
			if (hasMediaSession()) navigator.mediaSession.playbackState = 'paused';
		}
		youtubeLoad(track.youtube.videoId, autoplay && !hidden, startAt);
		savePosition();
		return;
	}

	youtubeErrorStreak = 0;
	youtubeStop();
	audioEl.src = track.file.url;
	if (startAt > 0) pendingStartAt = startAt;
	updateMediaSessionMetadata();
	savePosition();

	if (autoplay) {
		play();
	}
}

function play(): void {
	if (audioPlayerState.index === -1 && audioPlayerState.queue.length > 0) {
		loadAt(0, true);
		return;
	}

	if (isUnplayableTrack(currentTrack.value)) {
		loadAt(audioPlayerState.index, true);
		return;
	}

	if (isYoutubeCurrent.value) {
		resumeYoutubeOnVisible = false;
		youtubePlay();
		return;
	}

	// 自動再生ブロック等でrejectしうるが、再生ボタンが出たままになるだけなので握りつぶす
	audioEl.play().catch(() => {
		audioPlayerState.playing = false;
	});
}

function pause(): void {
	resumeYoutubeOnVisible = false;
	if (isYoutubeCurrent.value) {
		youtubePause();
		return;
	}
	audioEl.pause();
}

function toggle(): void {
	if (!audioPlayerState.playing) {
		play();
	} else {
		pause();
	}
}

function onEnded(): void {
	if (audioPlayerState.loop === 'one') {
		seek(0);
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

	if (audioPlayerState.currentTime > 3) {
		seek(0);
		return;
	}

	if (audioPlayerState.index <= 0) {
		if (audioPlayerState.loop === 'all' && audioPlayerState.queue.length > 1) {
			loadAt(audioPlayerState.queue.length - 1, true, 0, -1);
		} else {
			seek(0);
		}
		return;
	}

	loadAt(audioPlayerState.index - 1, true, 0, -1);
}

function seek(sec: number): void {
	if (!Number.isFinite(sec)) return;
	if (isYoutubeCurrent.value) {
		const max = audioPlayerState.duration > 0 ? audioPlayerState.duration : sec;
		const clamped = Math.min(Math.max(0, sec), max);
		audioPlayerState.currentTime = clamped;
		youtubeSeek(clamped);
		return;
	}
	const max = Number.isFinite(audioEl.duration) ? audioEl.duration : sec;
	audioEl.currentTime = Math.min(Math.max(0, sec), max);
}

function setVolume(v: number): void {
	const clamped = Math.min(1, Math.max(0, v));
	audioPlayerState.volume = clamped;
	audioEl.volume = clamped;
	youtubeSetVolume(clamped);
	persistVolume(clamped);
}

function toggleMute(): void {
	audioPlayerState.muted = !audioPlayerState.muted;
	audioEl.muted = audioPlayerState.muted;
	youtubeSetMuted(audioPlayerState.muted);
}

function cycleLoop(): void {
	const i = LOOP_ORDER.indexOf(audioPlayerState.loop);
	audioPlayerState.loop = LOOP_ORDER[(i + 1) % LOOP_ORDER.length];
}

function toQueueEntries(tracks: AudioTrack[]): AudioTrack[] {
	return tracks.map(track => ({ ...track, qid: genId() }));
}

function playTracks(tracks: AudioTrack[], startIndex = 0): void {
	if (tracks.length === 0) return;
	youtubeErrorStreak = 0;
	audioPlayerState.queue.splice(0, audioPlayerState.queue.length, ...toQueueEntries(tracks));
	loadAt(Math.min(Math.max(0, startIndex), tracks.length - 1), true);
}

function enqueue(tracks: AudioTrack[]): void {
	if (tracks.length === 0) return;
	const wasEmpty = audioPlayerState.queue.length === 0;
	audioPlayerState.queue.push(...toQueueEntries(tracks));
	if (wasEmpty) {
		loadAt(0, true);
	}
}

function playAt(i: number): void {
	youtubeErrorStreak = 0;
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

// キューを並べ替える (D&D の結果をそのまま受け取る)。再生中のトラックは止めずに、その新しい位置へ index を追従させる。
// newQueue は現在のキューの並べ替えであること (要素の追加・削除は remove / enqueue を使う)。
function reorderQueue(newQueue: AudioTrack[]): void {
	const currentQid = currentTrack.value?.qid ?? null;
	audioPlayerState.queue.splice(0, audioPlayerState.queue.length, ...newQueue);
	if (currentQid != null) {
		audioPlayerState.index = audioPlayerState.queue.findIndex(track => track.qid === currentQid);
	}
}

function moveInQueue(from: number, to: number): void {
	const queue = audioPlayerState.queue;
	if (from < 0 || from >= queue.length || to < 0 || to >= queue.length || from === to) return;
	const newQueue = [...queue];
	const [moved] = newQueue.splice(from, 1);
	newQueue.splice(to, 0, moved);
	reorderQueue(newQueue);
}

function clear(): void {
	youtubeStop();
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
	resumeYoutubeOnVisible = false;
	clearSession();
}

// YouTube の曲の再生中は <audio> 側のイベント (src を外した際の pause など) を状態に反映しない
audioEl.addEventListener('play', () => {
	if (isYoutubeCurrent.value) return;
	audioPlayerState.playing = true;
	if (hasMediaSession()) navigator.mediaSession.playbackState = 'playing';
});

audioEl.addEventListener('pause', () => {
	if (isYoutubeCurrent.value) return;
	audioPlayerState.playing = false;
	savePosition();
	if (hasMediaSession()) navigator.mediaSession.playbackState = 'paused';
});

audioEl.addEventListener('timeupdate', () => {
	if (isYoutubeCurrent.value) return;
	audioPlayerState.currentTime = audioEl.currentTime;
	savePositionThrottled();
	updatePositionState();
});

audioEl.addEventListener('loadedmetadata', () => {
	if (isYoutubeCurrent.value || pendingStartAt == null) return;
	const startAt = pendingStartAt;
	pendingStartAt = null;
	if (Number.isFinite(audioEl.duration) && startAt < audioEl.duration) {
		audioEl.currentTime = startAt;
	}
});

audioEl.addEventListener('durationchange', () => {
	if (isYoutubeCurrent.value) return;
	audioPlayerState.duration = Number.isFinite(audioEl.duration) ? audioEl.duration : 0;
});

audioEl.addEventListener('progress', () => {
	if (isYoutubeCurrent.value) return;
	syncBuffered();
});
audioEl.addEventListener('seeked', () => {
	if (isYoutubeCurrent.value) return;
	audioPlayerState.currentTime = audioEl.currentTime;
	syncBuffered();
});
audioEl.addEventListener('ended', () => {
	if (isYoutubeCurrent.value) return;
	onEnded();
});

// 埋め込み禁止・削除済みなどで再生できない YouTube の曲は飛ばして次へ進む。
// キュー全体が再生できない場合に延々と飛ばし続けないよう、連続失敗がキューの長さに達したら止める
function notifySkipped(): void {
	import('@/os.js').then(os => os.toast(i18n.ts._audioPlayer.youtubeUnplayable)).catch(() => {});
}

setYoutubeHandlers({
	onPlay: () => {
		youtubeErrorStreak = 0;
		audioPlayerState.playing = true;
		if (hasMediaSession()) navigator.mediaSession.playbackState = 'playing';
	},
	onPause: () => {
		audioPlayerState.playing = false;
		if (hasMediaSession()) navigator.mediaSession.playbackState = 'paused';
		savePosition();
	},
	onEnded: () => {
		// <audio> と違い ended の前に pause が来ないので、ここで停止状態にしておく
		// (ループ時は onEnded() の中で再び再生される)
		audioPlayerState.playing = false;
		if (hasMediaSession()) navigator.mediaSession.playbackState = 'paused';
		onEnded();
	},
	onError: (code) => {
		audioPlayerState.playing = false;
		notifySkipped();

		// 動画側の理由で再生できない場合は、曲に印を付けて以後は再生せずに飛ばす
		// (100: 削除済み・非公開 / 101, 150: 埋め込み不可。それ以外は一時的な失敗として扱う)
		const reason: YoutubeUnavailableReason | null = code === 100 ? 'unavailable' : code === 101 || code === 150 ? 'notEmbeddable' : null;
		const track = currentTrack.value;
		if (reason != null && track?.kind === 'youtube') {
			track.youtube = { ...track.youtube, unavailable: reason };
			saveQueue();
			loadAt(audioPlayerState.index, true);
			return;
		}

		youtubeErrorStreak += 1;
		if (youtubeErrorStreak >= audioPlayerState.queue.length) {
			youtubeErrorStreak = 0;
			return;
		}
		const isLast = audioPlayerState.index >= audioPlayerState.queue.length - 1;
		if (!isLast) {
			loadAt(audioPlayerState.index + 1, true);
		} else if (audioPlayerState.loop === 'all') {
			loadAt(0, true);
		}
	},
	onTick: (currentTime, duration, buffered) => {
		audioPlayerState.currentTime = currentTime;
		audioPlayerState.duration = Number.isFinite(duration) ? duration : 0;
		audioPlayerState.buffered = buffered;
		updatePositionState();
		savePositionThrottled();
	},
});

// --- 再生セッションの保存と復元 ---

function isRestorableTrack(value: unknown): value is AudioTrack {
	if (value == null || typeof value !== 'object') return false;
	const track = value as Partial<AudioTrack> & { youtube?: Partial<YoutubeTrackInfo>; file?: { url?: unknown } };
	if (typeof track.id !== 'string') return false;
	if (track.kind === 'youtube') return typeof track.youtube?.videoId === 'string' && typeof track.youtube.title === 'string';
	return typeof track.file?.url === 'string';
}

function saveQueue(): void {
	try {
		if (audioPlayerState.queue.length === 0) {
			window.localStorage.removeItem(SESSION_QUEUE_KEY);
			return;
		}
		const queue = audioPlayerState.queue.slice(0, SESSION_MAX_TRACKS).map(toPersistableTrack);
		window.localStorage.setItem(SESSION_QUEUE_KEY, JSON.stringify(queue));
	} catch {
		// 容量超過・プライベートブラウジング等。復元できないだけなので無視する
	}
}

let lastPositionSavedAt = 0;

function savePosition(): void {
	lastPositionSavedAt = Date.now();
	try {
		if (audioPlayerState.queue.length === 0) {
			window.localStorage.removeItem(SESSION_POSITION_KEY);
			return;
		}
		window.localStorage.setItem(SESSION_POSITION_KEY, JSON.stringify({
			index: audioPlayerState.index,
			currentTime: audioPlayerState.currentTime,
			loop: audioPlayerState.loop,
		}));
	} catch {
		// ignore
	}
}

function savePositionThrottled(): void {
	if (Date.now() - lastPositionSavedAt >= POSITION_SAVE_INTERVAL_MS) savePosition();
}

function clearSession(): void {
	try {
		window.localStorage.removeItem(SESSION_QUEUE_KEY);
		window.localStorage.removeItem(SESSION_POSITION_KEY);
	} catch {
		// ignore
	}
}

// 前回のキューと再生位置を読み込み、一時停止した状態で復元する (ブラウザの自動再生制限があるので再生はしない)
function restoreSession(): void {
	let queue: unknown;
	let position: { index?: unknown; currentTime?: unknown; loop?: unknown } | null;
	try {
		queue = JSON.parse(window.localStorage.getItem(SESSION_QUEUE_KEY) ?? 'null');
		position = JSON.parse(window.localStorage.getItem(SESSION_POSITION_KEY) ?? 'null');
	} catch {
		return;
	}
	if (!Array.isArray(queue)) return;
	const tracks = queue.filter(isRestorableTrack).slice(0, SESSION_MAX_TRACKS);
	if (tracks.length === 0) return;

	audioPlayerState.queue.splice(0, audioPlayerState.queue.length, ...toQueueEntries(tracks));
	if (typeof position?.loop === 'string' && (LOOP_ORDER as string[]).includes(position.loop)) {
		audioPlayerState.loop = position.loop as LoopMode;
	}
	const index = typeof position?.index === 'number' && position.index >= 0 && position.index < tracks.length ? position.index : 0;
	const currentTime = typeof position?.currentTime === 'number' && Number.isFinite(position.currentTime) ? Math.max(0, position.currentTime) : 0;
	loadAt(index, false, currentTime);
}

restoreSession();

// キュー内の YouTube の曲情報を差し替える (プレイリスト側で取得し直した結果の反映など)
export function patchQueueYoutubeInfo(infos: Map<string, YoutubeTrackInfo>): void {
	let changed = false;
	for (const track of audioPlayerState.queue) {
		if (track.kind !== 'youtube') continue;
		const info = infos.get(track.youtube.videoId);
		if (info == null) continue;
		track.youtube = { ...info };
		changed = true;
	}
	if (changed) {
		saveQueue();
		updateMediaSessionMetadata();
	}
}

// キュー内の古い YouTube の曲情報を取得し直す (起動直後の読み込みと重ならないよう少し遅らせる)
export async function refreshQueueYoutubeInfo(): Promise<void> {
	const updated = await refreshStaleYoutubeTracks([...audioPlayerState.queue]);
	if (updated == null) return;
	const infos = new Map<string, YoutubeTrackInfo>();
	for (const track of updated) {
		if (track.kind === 'youtube') infos.set(track.youtube.videoId, track.youtube);
	}
	patchQueueYoutubeInfo(infos);
}

if (audioPlayerState.queue.some(track => track.kind === 'youtube')) {
	window.setTimeout(() => {
		refreshQueueYoutubeInfo().catch(() => {});
	}, 10 * 1000);
}

// キューの中身・並びが変わったら保存する (連続した変更はまとめる)
let saveQueueTimer: number | null = null;
watch(() => audioPlayerState.queue.map(track => track.qid).join(','), () => {
	if (saveQueueTimer != null) window.clearTimeout(saveQueueTimer);
	saveQueueTimer = window.setTimeout(() => {
		saveQueueTimer = null;
		saveQueue();
		savePosition();
	}, 300);
});

watch(() => audioPlayerState.loop, () => savePosition());

window.addEventListener('pagehide', () => {
	if (saveQueueTimer != null) {
		window.clearTimeout(saveQueueTimer);
		saveQueueTimer = null;
		saveQueue();
	}
	savePosition();
});

window.document.addEventListener('visibilitychange', () => {
	if (window.document.visibilityState === 'hidden') {
		savePosition();
		return;
	}
	// 裏にいる間に止まった・進んだ状態を画面の表示に合わせる
	if (!isYoutubeCurrent.value && audioEl.src !== '') {
		audioPlayerState.playing = !audioEl.paused;
		audioPlayerState.currentTime = audioEl.currentTime;
	}
	if (resumeYoutubeOnVisible && isYoutubeCurrent.value) {
		resumeYoutubeOnVisible = false;
		play();
	}
});

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
	reorderQueue,
	moveInQueue,
	clear,
};
