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
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { getProxiedImageUrl } from '@/utility/media-proxy.js';
import { uploadFile } from '@/utility/drive.js';
import { extractDominantColors, renderNowPlayingCard, NOW_PLAYING_CARD_SIZE } from '@/utility/now-playing-card.js';
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

// アートワーク画像を <img> に読み込む。クロスオリジンの画像を canvas から汚染 (tainted) 無しで
// 読み取れるよう、必ず自インスタンス経由のプロキシ URL (mustOrigin) を通して crossOrigin=anonymous
// で読み込む。取得に失敗した場合は null を返し、呼び出し側はアートワーク無しでカードを描画する。
function loadImageForCard(imageUrl: string, timeoutMs = 10000): Promise<HTMLImageElement | null> {
	return new Promise((resolve) => {
		const img = new Image();
		let settled = false;
		const finish = (result: HTMLImageElement | null) => {
			if (settled) return;
			settled = true;
			window.clearTimeout(timer);
			resolve(result);
		};
		const timer = window.setTimeout(() => finish(null), timeoutMs);
		img.crossOrigin = 'anonymous';
		img.onload = () => finish(img);
		img.onerror = () => finish(null);
		img.src = getProxiedImageUrl(imageUrl, undefined, true);
	});
}

// NowPlaying カード画像 (PNG) を生成する。アートワークが取得できない場合は art card として
// 生成する (renderNowPlayingCard 側の仕様)。canvas / 画像読み込みに失敗した場合は null を返す。
export async function generateNowPlayingCard(track: NowPlayingTrack): Promise<Blob | null> {
	try {
		const canvas = window.document.createElement('canvas');
		canvas.width = NOW_PLAYING_CARD_SIZE.width;
		canvas.height = NOW_PLAYING_CARD_SIZE.height;
		const ctx = canvas.getContext('2d');
		if (ctx == null) return null;

		const artwork = track.artworkUrl ? await loadImageForCard(track.artworkUrl) : null;

		let artworkColors: { r: number; g: number; b: number }[] | undefined;
		if (artwork != null) {
			const sampleCanvas = window.document.createElement('canvas');
			sampleCanvas.width = 32;
			sampleCanvas.height = 32;
			const sampleCtx = sampleCanvas.getContext('2d');
			if (sampleCtx != null) {
				artworkColors = extractDominantColors(sampleCtx, artwork, 2);
			}
		}

		renderNowPlayingCard(ctx, {
			title: track.title,
			artist: track.artist,
			serviceLabel: track.serviceLabel,
			footer: `#NowPlaying・${host}`,
			artwork,
			artworkColors,
		});

		return await new Promise<Blob | null>((resolve) => {
			canvas.toBlob((blob) => resolve(blob), 'image/png');
		});
	} catch {
		return null;
	}
}

// カード画像を生成してドライブにアップロードする。生成/アップロードいずれかが失敗したら null を返す
// (呼び出し側は画像無しで投稿を続行する)。
export async function attachNowPlayingCard(track: NowPlayingTrack): Promise<Misskey.entities.DriveFile | null> {
	try {
		const blob = await generateNowPlayingCard(track);
		if (blob == null) return null;
		const { filePromise } = uploadFile(blob, {
			name: 'nowplaying.png',
			folderId: prefer.s.uploadFolder,
			caption: [track.title, track.artist].filter(Boolean).join(' / ') || null,
		});
		return await filePromise;
	} catch {
		return null;
	}
}

export async function openNowPlayingPost(track: NowPlayingTrack): Promise<void> {
	let initialFiles: Misskey.entities.DriveFile[] | undefined;
	if (prefer.s.nowPlayingAttachCard) {
		const file = await attachNowPlayingCard(track);
		if (file != null) {
			initialFiles = [file];
		} else {
			os.toast(i18n.ts._nowPlaying.cardGenerationFailed);
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
