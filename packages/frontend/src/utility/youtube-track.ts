/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// YouTube / YouTube Music の URL から常駐プレイヤー用のトラックを作る (bsky-fork 独自)

import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { createYoutubeTrack } from '@/utility/audio-player.js';
import { extractYoutubeVideoId } from '@/utility/youtube-iframe-api.js';
import type { YoutubeAudioTrack } from '@/utility/audio-player.js';

export async function resolveYoutubeTrack(rawUrl: string): Promise<YoutubeAudioTrack | null> {
	const videoId = extractYoutubeVideoId(rawUrl);
	if (videoId == null) return null;

	const isMusic = (() => {
		try {
			return new URL(rawUrl.trim()).hostname.toLowerCase() === 'music.youtube.com';
		} catch {
			return false;
		}
	})();
	const service = isMusic ? 'youtubeMusic' as const : 'youtube' as const;
	const url = isMusic ? `https://music.youtube.com/watch?v=${videoId}` : `https://www.youtube.com/watch?v=${videoId}`;

	let title: string | null = null;
	let author: string | null = null;
	let thumbnailUrl: string | null = null;
	let fetchedAt: number | undefined;

	// 曲名・チャンネル名・サムネイルは NowPlaying と同じサーバー側の解析 (oEmbed) で取る。ログインが必要なので
	// 未ログイン時や失敗時は動画 ID だけで登録する
	if ($i != null) {
		try {
			const res = await misskeyApi('nowplaying/resolve-url', { url });
			title = res.title;
			author = res.artist;
			thumbnailUrl = res.thumbnailUrl;
			if (res.title != null) fetchedAt = Date.now();
		} catch {
			// ignore
		}
	}

	return createYoutubeTrack({
		videoId,
		title: title ?? `YouTube (${videoId})`,
		author,
		thumbnailUrl: thumbnailUrl ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
		url,
		service,
		fetchedAt,
	});
}

export async function openYoutubePlaylistImport(): Promise<void> {
	const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkYoutubePlaylistImportDialog.vue').then(x => x.default), {}, {
		closed: () => dispose(),
	});
}

// URL の入力を求めて YouTube のトラックを作る。キャンセル時・解析できない URL の場合は null
export async function promptYoutubeTrack(): Promise<YoutubeAudioTrack | null> {
	const { canceled, result } = await os.inputText({
		type: 'url',
		title: i18n.ts._audioPlayer.addFromYoutube,
		placeholder: 'https://www.youtube.com/watch?v=...',
		minLength: 1,
	});
	if (canceled) return null;

	if (extractYoutubeVideoId(result) == null) {
		os.alert({ type: 'error', text: i18n.ts._audioPlayer.invalidYoutubeUrl });
		return null;
	}

	const track = await os.promiseDialog(resolveYoutubeTrack(result), null, null);
	return track;
}
