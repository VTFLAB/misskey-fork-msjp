/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 音声秘書など外部アプリからの常駐オーディオプレイヤー操作 (bsky-fork 独自)。
// サーバーがメインストリームの audioPlayerCommand で中継したコマンドを、この端末で受けて動かす。
// どの端末が受けるかは端末ごとの設定 (localStorage、既定オフ) で決める。
// 起動時に読み込まれるので、プレイヤー本体は静的 import せず、コマンドを受けたときに動的 import する。

import { miLocalStorage } from '@/local-storage.js';
import type { AudioTrack } from '@/utility/audio-player.js';

export type AudioPlayerCommand = {
	action: 'play' | 'pause' | 'toggle' | 'next' | 'prev' | 'playPlaylist';
	playlistId: string | null;
	shuffle: boolean;
};

// 同じブラウザで Misskey のタブを複数開いていると、どのタブにも同じ指示が届く (設定は localStorage で共有)。
// 二重に鳴らないよう、Web Locks で 1 タブだけが受け持つ。受け持ちのタブを閉じると、次に指示を受けたタブが引き継ぐ。
// 受ける設定のタブで再生が始まったら、そのタブが受け持ちを奪う (鳴っているタブと指示を受けるタブを揃える)。
const LOCK_NAME = 'misskey-audio-player-remote';
let lockState: 'idle' | 'waiting' | 'held' = 'idle';
let lockPromise: Promise<void> | null = null;

function requestLock(steal = false): Promise<void> {
	lockState = 'waiting';
	lockPromise = new Promise(resolve => {
		navigator.locks.request(LOCK_NAME, steal ? { steal: true } : {}, () => {
			lockState = 'held';
			resolve();
			// タブが閉じるまで (またはほかのタブに奪われるまで) 持ち続ける
			return new Promise<void>(() => {});
		}).catch(() => {
			// 奪われたときは AbortError で reject される
			lockState = 'idle';
			resolve();
		});
	});
	return lockPromise;
}

function hasLocks(): boolean {
	return typeof navigator !== 'undefined' && navigator.locks != null;
}

async function controlsThisBrowser(): Promise<boolean> {
	// Web Locks が無い環境では、受ける設定のタブがすべて受ける
	if (!hasLocks()) return true;
	if (lockState === 'idle') requestLock();
	if (lockState === 'waiting' && lockPromise != null) {
		// 空いていればすぐ取れる。ほかのタブが持っていれば待ち行列に入り、そのタブが閉じたときに引き継ぐ
		await Promise.race([lockPromise, new Promise(resolve => window.setTimeout(resolve, 200))]);
	}
	return lockState === 'held';
}

// このタブで再生が始まったときに audio-player.ts から呼ばれる
export function claimAudioPlayerRemoteControl(): void {
	if (!isAudioPlayerRemoteControlEnabled() || !hasLocks() || lockState === 'held') return;
	requestLock(true);
}

export function isAudioPlayerRemoteControlEnabled(): boolean {
	return miLocalStorage.getItem('audioPlayerRemoteControl') === 'true';
}

export function setAudioPlayerRemoteControlEnabled(enabled: boolean): void {
	if (enabled) {
		miLocalStorage.setItem('audioPlayerRemoteControl', 'true');
		void controlsThisBrowser();
	} else {
		miLocalStorage.removeItem('audioPlayerRemoteControl');
	}
}

function shuffled<T>(items: readonly T[]): T[] {
	const result = items.slice();
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[result[i], result[j]] = [result[j], result[i]];
	}
	return result;
}

export async function handleAudioPlayerCommand(payload: AudioPlayerCommand): Promise<void> {
	if (!isAudioPlayerRemoteControlEnabled()) return;
	if (!await controlsThisBrowser()) return;

	const player = await import('@/utility/audio-player.js');

	switch (payload.action) {
		case 'play':
			// プレイヤーを閉じてキューが空なら、保存したキューを開き直してから再生する
			if (!player.hasQueue.value) player.showDock();
			player.play();
			return;
		case 'pause':
			player.pause();
			return;
		case 'toggle':
			if (!player.hasQueue.value) player.showDock();
			player.toggle();
			return;
		case 'next':
			player.next();
			return;
		case 'prev':
			player.prev();
			return;
		case 'playPlaylist': {
			if (payload.playlistId == null) return;
			const { getPlaylist } = await import('@/utility/audio-playlists.js');
			const playlist = await getPlaylist(payload.playlistId);
			if (playlist == null) {
				console.warn('[audio-player-remote] playlist not found:', payload.playlistId);
				return;
			}
			const tracks: AudioTrack[] = playlist.tracks.filter(track => !player.isUnplayableTrack(track));
			if (tracks.length === 0) {
				console.warn('[audio-player-remote] playlist has no playable tracks:', payload.playlistId);
				return;
			}
			player.playTracks(payload.shuffle ? shuffled(tracks) : tracks, 0);
			player.showDock();
			return;
		}
	}
}

// 受ける設定のブラウザでは、起動したタブが早めに受け持ちを取っておく (先に開いていたタブが優先される)
if (isAudioPlayerRemoteControlEnabled()) void controlsThisBrowser();
