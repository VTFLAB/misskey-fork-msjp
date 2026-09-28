/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// NowPlaying: 「今聴いている曲」を投稿フォームへ差し込むテキストを組み立てるヘルパー群。
// テンプレート展開はユーザー入力に依存するため、どんな壊れたテンプレートでも例外を投げない。

import * as Misskey from 'misskey-js';
import { instance } from '@/instance.js';
import { host, url } from '@@/js/config.js';
import { prefer } from '@/preferences.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { useStream } from '@/stream.js';
import { genId } from '@/utility/id.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import type { AudioTrack } from '@/utility/audio-player.js';

export type NowPlayingTrack = {
	title: string;
	artist: string | null;
	serviceLabel: string;
	url: string | null;
	/** 添付するアートワーク (ジャケット画像や投稿者アイコン) の URL。無ければ画像なしで投稿する */
	artworkUrl?: string | null;
};

// 差し込む値 (曲名・アーティスト名・サービス名) は他人が付けたファイル名やコメント、表示名、
// 外部サイトのメタデータなど信頼できない文字列。そのまま MFM として解釈されると、投稿者本人が
// 意図しないメンション・ハッシュタグ・MFM 関数・改行が混入するため、1 行に畳んだうえで
// 語頭 (行頭または空白直後) の @ / # と MFM 関数開始 "$[" を全角に置き換えて無効化する。
export function sanitizeNowPlayingValue(value: string): string {
	return value
		.replace(/\s+/g, ' ')
		.replace(/(^|\s)[@＠]/g, '$1＠')
		.replace(/(^|\s)#/g, '$1＃')
		.replace(/\$\[/g, '＄[')
		.replace(/</g, '＜')
		.trim();
}

// 区切り文字として扱う記号 ("/", "-", "|", "," など)。artist が無いときに浮いた区切りを畳む。
const SEPARATOR = '[\\/\\-–—|,、・:：]';

// {title} / {artist} / {service} の3種を差し替える。artistがnullの場合は
// " / {artist}" や "{artist} - " のような区切り文字だけが浮いた断片も畳んで消す。
export function buildNowPlayingText(track: NowPlayingTrack, template: string = prefer.s.nowPlayingTemplate): string {
	let text = template;

	if (track.artist == null) {
		text = text.replace(new RegExp(`\\s*${SEPARATOR}\\s*\\{artist\\}`, 'g'), '');
		text = text.replace(new RegExp(`\\{artist\\}\\s*${SEPARATOR}\\s*`, 'g'), '');
	}

	// 1 パスで置換する: 値に "{title}" や "$&" のような文字列が含まれていても
	// 再展開・String.replace の特殊パターン解釈が起きないよう、関数置換で値をそのまま差し込む。
	const values: Record<string, string> = {
		title: sanitizeNowPlayingValue(track.title),
		artist: track.artist != null ? sanitizeNowPlayingValue(track.artist) : '',
		service: sanitizeNowPlayingValue(track.serviceLabel),
	};
	text = text.replace(/\{(title|artist|service)\}/g, (_m, key: string) => values[key] ?? '');

	text = text.trim();

	if (track.url != null && track.url !== '') {
		text = `${text}\n${track.url}`;
	}

	return text;
}

let misskeyLabelCache: string | null = null;
let misskeyLabelPromise: Promise<string> | null = null;

async function fetchMisskeyLabel(): Promise<string> {
	if (misskeyLabelCache != null) return misskeyLabelCache;
	if (misskeyLabelPromise != null) return misskeyLabelPromise;

	misskeyLabelPromise = misskeyApi('nowplaying/misskey-label', {})
		.then(res => {
			misskeyLabelCache = res.serviceLabel;
			return misskeyLabelCache;
		})
		.catch(() => {
			return instance.name || host;
		})
		.finally(() => {
			misskeyLabelPromise = null;
		});

	return misskeyLabelPromise;
}

function stripExtension(fileName: string): string {
	const i = fileName.lastIndexOf('.');
	if (i <= 0) return fileName;
	return fileName.slice(0, i);
}

export async function misskeyTrackToNowPlaying(track: AudioTrack): Promise<NowPlayingTrack> {
	const title = track.file.comment || stripExtension(track.file.name);
	const artist = track.user != null ? (track.user.name || track.user.username) : null;
	const trackUrl = track.noteId != null ? `${url}/notes/${track.noteId}` : track.file.url;
	const serviceLabel = await fetchMisskeyLabel();

	return {
		title,
		artist,
		serviceLabel,
		url: trackUrl,
		// Misskey 内の楽曲はジャケット画像を持たないので、投稿者のアイコンをアートワークにする
		artworkUrl: track.user?.avatarUrl ?? null,
	};
}

// アートワーク画像をサーバー経由でドライブに取り込む (drive/files/upload-from-url は非同期で、
// 完了は main ストリームの urlUploadFinished に marker 付きで届く)。同じ画像は md5 で
// 重複排除されるので、同じ曲を何度 NowPlaying してもドライブが増え続けることはない。
export function uploadNowPlayingArtwork(imageUrl: string, comment: string | null, timeoutMs = 20000): Promise<Misskey.entities.DriveFile | null> {
	return new Promise((resolve) => {
		const marker = genId();
		const connection = useStream().useChannel('main');
		let settled = false;
		const finish = (file: Misskey.entities.DriveFile | null) => {
			if (settled) return;
			settled = true;
			connection.dispose();
			resolve(file);
		};
		const timer = window.setTimeout(() => finish(null), timeoutMs);
		connection.on('urlUploadFinished', (res) => {
			if (res.marker !== marker) return;
			window.clearTimeout(timer);
			finish(res.file);
		});
		misskeyApi('drive/files/upload-from-url', {
			url: imageUrl,
			folderId: prefer.s.uploadFolder,
			comment: comment != null && comment !== '' ? comment.slice(0, 512) : null,
			marker,
		}).catch(() => {
			window.clearTimeout(timer);
			finish(null);
		});
	});
}

export async function openNowPlayingPost(track: NowPlayingTrack): Promise<void> {
	let initialFiles: Misskey.entities.DriveFile[] | undefined;
	if (track.artworkUrl) {
		const file = await uploadNowPlayingArtwork(track.artworkUrl, [track.title, track.artist].filter(Boolean).join(' / '));
		if (file != null) {
			initialFiles = [file];
		} else {
			os.toast(i18n.ts._nowPlaying.artworkUploadFailed);
		}
	}
	await os.post({
		initialText: buildNowPlayingText(track),
		initialFiles,
	});
}

// プレイヤーのボタン用: メタデータ取得を待つ間の連打で投稿フォームが複数開かないようにする。
let postingMisskeyTrack = false;
export async function postNowPlayingForMisskeyTrack(track: AudioTrack): Promise<void> {
	if (postingMisskeyTrack) return;
	postingMisskeyTrack = true;
	try {
		await openNowPlayingPost(await misskeyTrackToNowPlaying(track));
	} finally {
		postingMisskeyTrack = false;
	}
}
