/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 常駐プレイヤーに保存している YouTube の曲情報 (曲名・チャンネル名・サムネイル) の更新 (bsky-fork 独自)。
// YouTube API ポリシー III.E.4 は、取得したデータを 30 日を超えて保存せず、削除するか取得し直すことを求める。
// ここでは削除せずに取得し直し、あわせて削除・非公開になった動画を判定する。
// サーバーと YouTube への負荷を抑えるため、更新は「表示・再生するときに、その範囲の古い曲だけ」を基本にし、
// 問い合わせは 1 回 50 件まで・間隔を空けて直列に送る。

import { $i } from '@/i.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import type { AudioTrack, YoutubeAudioTrack, YoutubeTrackInfo } from '@/utility/audio-player.js';

// 30 日の期限に余裕を持たせ、25 日を過ぎたものを更新対象にする
export const YOUTUBE_INFO_REFRESH_AFTER_MS = 1000 * 60 * 60 * 24 * 25;
const BATCH_SIZE = 50;
// エンドポイントのレート制限 (1 分 12 回) に収まる間隔
const BATCH_INTERVAL_MS = 5000;

export type YoutubeVideoLookup = {
	videoId: string;
	status: 'available' | 'removed' | 'private' | 'error';
	title: string | null;
	author: string | null;
	thumbnailUrl: string | null;
};

export function isYoutubeInfoStale(info: YoutubeTrackInfo, now = Date.now()): boolean {
	return info.fetchedAt == null || now - info.fetchedAt > YOUTUBE_INFO_REFRESH_AFTER_MS;
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => window.setTimeout(resolve, ms));
}

// 問い合わせは画面をまたいで 1 本の列に並べ、同時に複数のバッチを送らない
let queueTail: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function enqueueRequest<T>(fn: () => Promise<T>): Promise<T> {
	const run = queueTail.then(async () => {
		const wait = lastRequestAt + BATCH_INTERVAL_MS - Date.now();
		if (wait > 0) await sleep(wait);
		lastRequestAt = Date.now();
		return fn();
	});
	queueTail = run.catch(() => undefined);
	return run;
}

// 動画 ID をまとめて問い合わせる。onProgress には取得済みの件数を渡す
export async function lookupYoutubeVideos(
	videoIds: string[],
	options: { playlistId?: string; onProgress?: (done: number) => void } = {},
): Promise<{ videos: Map<string, YoutubeVideoLookup>; playlistTitle: string | null }> {
	const videos = new Map<string, YoutubeVideoLookup>();
	let playlistTitle: string | null = null;
	const unique = [...new Set(videoIds)];

	for (let i = 0; i < unique.length; i += BATCH_SIZE) {
		const batch = unique.slice(i, i + BATCH_SIZE);
		const withTitle = i === 0 && options.playlistId != null;
		const res = await enqueueRequest(() => misskeyApi('nowplaying/youtube-videos', {
			videoIds: batch,
			...(withTitle ? { playlistId: options.playlistId } : {}),
		}));
		for (const video of res.videos) videos.set(video.videoId, video);
		if (withTitle) playlistTitle = res.playlistTitle;
		options.onProgress?.(Math.min(unique.length, i + batch.length));
	}

	return { videos, playlistTitle };
}

export function applyYoutubeLookup(info: YoutubeTrackInfo, lookup: YoutubeVideoLookup | undefined, now = Date.now()): YoutubeTrackInfo {
	if (lookup == null || lookup.status === 'error') return info;
	if (lookup.status === 'available') {
		return {
			...info,
			title: lookup.title ?? info.title,
			author: lookup.author ?? info.author,
			thumbnailUrl: lookup.thumbnailUrl ?? info.thumbnailUrl,
			fetchedAt: now,
			// 埋め込み不可は再生時にしか分からないので、oEmbed で取得できても印は残す
			unavailable: info.unavailable === 'notEmbeddable' ? 'notEmbeddable' : null,
		};
	}
	// 削除・非公開になった動画は、最後に分かっている曲名のまま印を付ける (リストからは消さない)
	return { ...info, fetchedAt: now, unavailable: lookup.status };
}

// 古い YouTube の曲情報を取得し直す。変更があった場合だけ新しい配列を返す (無ければ null)
export async function refreshStaleYoutubeTracks(tracks: AudioTrack[]): Promise<AudioTrack[] | null> {
	if ($i == null) return null;
	const now = Date.now();
	const staleIds = tracks
		.filter((track): track is YoutubeAudioTrack => track.kind === 'youtube' && isYoutubeInfoStale(track.youtube, now))
		.map(track => track.youtube.videoId);
	if (staleIds.length === 0) return null;

	let videos: Map<string, YoutubeVideoLookup>;
	try {
		({ videos } = await lookupYoutubeVideos(staleIds));
	} catch {
		return null;
	}

	let changed = false;
	const updated = tracks.map(track => {
		if (track.kind !== 'youtube' || !isYoutubeInfoStale(track.youtube, now)) return track;
		const info = applyYoutubeLookup(track.youtube, videos.get(track.youtube.videoId), now);
		if (info === track.youtube) return track;
		changed = true;
		return { ...track, youtube: info };
	});
	return changed ? updated : null;
}
