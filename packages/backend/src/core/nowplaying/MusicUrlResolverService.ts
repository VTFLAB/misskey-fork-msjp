/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { MemoryKVCache } from '@/misc/cache.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { StatusError } from '@/misc/status-error.js';
import { NowPlayingLoggerService } from './NowPlayingLoggerService.js';

// NowPlaying (fork 独自): ユーザーが貼った音楽共有 URL をタイトル/アーティスト/サムネイルに解決する。
// 対応外のサービスは 'other' として og:* から best-effort でメタデータを拾う。

export type MusicUrlService = 'spotify' | 'youtube' | 'youtubeMusic' | 'appleMusic' | 'amazonMusic' | 'other';

export type ResolvedMusicUrl = {
	service: MusicUrlService;
	serviceLabel: string;
	title: string | null;
	artist: string | null;
	url: string;
	thumbnailUrl: string | null;
};

const CACHE_TTL_MS = 1000 * 60 * 60; // 1h

// YouTube 動画情報の一括取得 (常駐プレイヤーのプレイリストの 30 日ごとの更新・インポート用)。
// 多数のユーザーが同じ動画を更新しても oEmbed への問い合わせが増えないよう長めにキャッシュし、
// 1 リクエスト内の問い合わせも同時実行数を絞る
const YOUTUBE_VIDEO_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6h
const YOUTUBE_LOOKUP_CONCURRENCY = 6;
// 1 リクエスト全体の上限。間に合わなかった動画は error (呼び出し側が後で再試行) として返す
const YOUTUBE_LOOKUP_DEADLINE_MS = 20 * 1000;

// available: 再生可能 / removed: 削除済み・存在しない / private: 非公開 (または埋め込み不可) /
// error: 一時的な失敗 (呼び出し側は前回の情報を維持して後で再試行する)
export type YoutubeVideoStatus = 'available' | 'removed' | 'private' | 'error';

export type YoutubeVideoInfo = {
	videoId: string;
	status: YoutubeVideoStatus;
	title: string | null;
	author: string | null;
	thumbnailUrl: string | null;
};

function decodeHtmlEntities(s: string): string {
	return s
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&#0?39;/g, '\'')
		.replace(/&apos;/g, '\'')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>');
}

function extractOgMeta(html: string, property: string): string | null {
	const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	// property=".." content=".." の順
	const re1 = new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]*content=["']([^"']*)["']`, 'i');
	const m1 = html.match(re1);
	if (m1) return decodeHtmlEntities(m1[1]);
	// content=".." property=".." の順 (順序が逆のページ対策)
	const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*property=["']${escaped}["']`, 'i');
	const m2 = html.match(re2);
	return m2 ? decodeHtmlEntities(m2[1]) : null;
}

// "Song by Artist" / "Song - Artist" のような og:description / og:title を分割する
function splitTitleByArtist(text: string): { title: string; artist: string } | null {
	const byMatch = text.match(/^(.+?)\s+by\s+(.+?)(?:\s+on\s+.+)?$/i);
	if (byMatch) return { title: byMatch[1].trim(), artist: byMatch[2].trim() };
	const dashMatch = text.match(/^(.+?)\s[-–—]\s(.+)$/);
	if (dashMatch) return { title: dashMatch[1].trim(), artist: dashMatch[2].trim() };
	return null;
}

@Injectable()
export class MusicUrlResolverService {
	private logger: Logger;
	private readonly cache: MemoryKVCache<ResolvedMusicUrl>;
	private readonly youtubeVideoCache: MemoryKVCache<YoutubeVideoInfo>;
	private readonly youtubePlaylistTitleCache: MemoryKVCache<string>;

	constructor(
		private httpRequestService: HttpRequestService,
		private nowPlayingLoggerService: NowPlayingLoggerService,
	) {
		this.logger = this.nowPlayingLoggerService.child('url-resolver');
		// The key is a user-supplied URL, so cap the entry count to bound memory under abuse.
		this.cache = new MemoryKVCache<ResolvedMusicUrl>(CACHE_TTL_MS, 5000);
		this.youtubeVideoCache = new MemoryKVCache<YoutubeVideoInfo>(YOUTUBE_VIDEO_CACHE_TTL_MS, 20000);
		this.youtubePlaylistTitleCache = new MemoryKVCache<string>(YOUTUBE_VIDEO_CACHE_TTL_MS, 2000);
	}

	@bindThis
	public async resolve(rawUrl: string): Promise<ResolvedMusicUrl> {
		let url: URL;
		try {
			url = new URL(rawUrl);
		} catch {
			throw new Error('Invalid URL.');
		}
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			throw new Error('Only http(s) URLs are supported.');
		}

		const host = url.hostname.toLowerCase();
		const cacheKey = url.toString();
		const cached = this.cache.get(cacheKey);
		if (cached) return cached;

		let result: ResolvedMusicUrl;
		try {
			if (host === 'open.spotify.com') {
				result = await this.resolveSpotify(url);
			} else if (host === 'youtu.be' || host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
				result = await this.resolveYoutube(url, 'youtube');
			} else if (host === 'music.youtube.com') {
				result = await this.resolveYoutube(url, 'youtubeMusic');
			} else if (host === 'music.apple.com') {
				result = await this.resolveAppleMusic(url);
			} else if (host.startsWith('music.amazon.')) {
				result = await this.resolveAmazonMusic(url);
			} else {
				result = await this.resolveOther(url);
			}
		} catch (err) {
			// 対応サービスの解決処理そのものが例外を投げた場合も 500 にはせず other 扱いへ落とす
			this.logger.warn(`resolve failed for ${host}: ${err instanceof Error ? err.message : err}`);
			result = this.fallback(url);
		}

		this.cache.set(cacheKey, result);
		return result;
	}

	@bindThis
	private fallback(url: URL): ResolvedMusicUrl {
		return {
			service: 'other',
			serviceLabel: url.hostname,
			title: null,
			artist: null,
			url: `${url.origin}${url.pathname}`,
			thumbnailUrl: null,
		};
	}

	@bindThis
	private async fetchHtmlSafe(url: string): Promise<string | null> {
		try {
			return await this.httpRequestService.getHtml(url);
		} catch (err) {
			this.logger.debug(`getHtml failed for ${url}: ${err instanceof Error ? err.message : err}`);
			return null;
		}
	}

	@bindThis
	private async fetchJsonSafe<T>(url: string): Promise<T | null> {
		try {
			return await this.httpRequestService.getJson<T>(url);
		} catch (err) {
			this.logger.debug(`getJson failed for ${url}: ${err instanceof Error ? err.message : err}`);
			return null;
		}
	}

	@bindThis
	private async resolveSpotify(url: URL): Promise<ResolvedMusicUrl> {
		const canonical = `${url.origin}${url.pathname}`;

		const oembed = await this.fetchJsonSafe<{ title?: string; thumbnail_url?: string }>(
			`https://open.spotify.com/oembed?url=${encodeURIComponent(canonical)}`,
		);

		let artist: string | null = null;
		const html = await this.fetchHtmlSafe(canonical);
		if (html != null) {
			const desc = extractOgMeta(html, 'og:description');
			if (desc != null) {
				// "Artist · Song · Year" の先頭要素
				const first = desc.split('·')[0]?.trim();
				if (first) artist = first;
			}
		}

		return {
			service: 'spotify',
			serviceLabel: 'Spotify',
			title: oembed?.title ?? null,
			artist,
			url: canonical,
			thumbnailUrl: oembed?.thumbnail_url ?? null,
		};
	}

	@bindThis
	private extractYoutubeVideoId(url: URL): string | null {
		if (url.hostname === 'youtu.be') {
			return url.pathname.replace(/^\//, '').split('/')[0] || null;
		}
		const v = url.searchParams.get('v');
		if (v) return v;
		const m = url.pathname.match(/\/(?:shorts|embed)\/([^/?]+)/);
		return m ? m[1] : null;
	}

	@bindThis
	private async resolveYoutube(url: URL, service: 'youtube' | 'youtubeMusic'): Promise<ResolvedMusicUrl> {
		const videoId = this.extractYoutubeVideoId(url);
		if (videoId == null) return this.fallback(url);

		const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
		const canonical = service === 'youtubeMusic' ? `https://music.youtube.com/watch?v=${videoId}` : watchUrl;

		const oembed = await this.fetchJsonSafe<{ title?: string; author_name?: string; thumbnail_url?: string }>(
			`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
		);

		let title = oembed?.title ?? null;
		let artist = oembed?.author_name?.replace(/\s*-\s*Topic$/, '').trim() || null;

		if (title != null && (artist == null || artist === '')) {
			const m = title.match(/^(.+?)\s[-–—]\s(.+)$/);
			if (m) {
				artist = m[1].trim();
				title = m[2].trim();
			}
		}

		return {
			service,
			serviceLabel: service === 'youtubeMusic' ? 'YouTube Music' : 'YouTube',
			title,
			artist,
			url: canonical,
			thumbnailUrl: oembed?.thumbnail_url ?? null,
		};
	}

	@bindThis
	private async lookupYoutubeVideo(videoId: string): Promise<YoutubeVideoInfo> {
		const cached = this.youtubeVideoCache.get(videoId);
		if (cached) return cached;

		const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
		let info: YoutubeVideoInfo;
		try {
			const oembed = await this.httpRequestService.getJson<{ title?: string; author_name?: string; thumbnail_url?: string }>(
				`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
			);
			info = {
				videoId,
				status: 'available',
				title: oembed.title ?? null,
				author: oembed.author_name?.replace(/\s*-\s*Topic$/, '').trim() || null,
				thumbnailUrl: oembed.thumbnail_url ?? null,
			};
		} catch (err) {
			// oEmbed は削除済み・存在しない動画に 404 (不正な ID は 400)、非公開の動画に 401 / 403 を返す
			const status = err instanceof StatusError ? err.statusCode : null;
			const kind: YoutubeVideoStatus = status === 404 || status === 400 ? 'removed'
				: status === 401 || status === 403 ? 'private'
				: 'error';
			info = { videoId, status: kind, title: null, author: null, thumbnailUrl: null };
			if (kind === 'error') {
				this.logger.debug(`youtube oembed failed for ${videoId}: ${err instanceof Error ? err.message : err}`);
				// 一時的な失敗はキャッシュしない
				return info;
			}
		}

		this.youtubeVideoCache.set(videoId, info);
		return info;
	}

	@bindThis
	public async lookupYoutubeVideos(videoIds: string[]): Promise<YoutubeVideoInfo[]> {
		const results = new Array<YoutubeVideoInfo>(videoIds.length);
		const deadline = Date.now() + YOUTUBE_LOOKUP_DEADLINE_MS;
		let cursor = 0;
		const worker = async () => {
			while (cursor < videoIds.length) {
				const i = cursor++;
				results[i] = Date.now() < deadline
					? await this.lookupYoutubeVideo(videoIds[i])
					: { videoId: videoIds[i], status: 'error', title: null, author: null, thumbnailUrl: null };
			}
		};
		await Promise.all(Array.from({ length: Math.min(YOUTUBE_LOOKUP_CONCURRENCY, videoIds.length) }, worker));
		return results;
	}

	@bindThis
	public async lookupYoutubePlaylistTitle(playlistId: string): Promise<string | null> {
		const cached = this.youtubePlaylistTitleCache.get(playlistId);
		if (cached !== undefined) return cached === '' ? null : cached;
		try {
			const oembed = await this.httpRequestService.getJson<{ title?: string }>(
				`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/playlist?list=${playlistId}`)}&format=json`,
			);
			const title = oembed.title ?? '';
			this.youtubePlaylistTitleCache.set(playlistId, title);
			return title === '' ? null : title;
		} catch (err) {
			// 存在しない・非公開 (4xx) は空文字としてキャッシュし、同じ ID で繰り返し問い合わせない
			if (err instanceof StatusError && err.isClientError) this.youtubePlaylistTitleCache.set(playlistId, '');
			return null;
		}
	}

	@bindThis
	private async resolveAppleMusic(url: URL): Promise<ResolvedMusicUrl> {
		const canonical = `${url.origin}${url.pathname}`;
		const html = await this.fetchHtmlSafe(canonical);

		let title: string | null = null;
		let artist: string | null = null;
		let thumbnailUrl: string | null = null;

		if (html != null) {
			const ogTitle = extractOgMeta(html, 'og:title');
			const ogDescription = extractOgMeta(html, 'og:description');
			thumbnailUrl = extractOgMeta(html, 'og:image');

			const source = ogDescription ?? ogTitle;
			const split = source != null ? splitTitleByArtist(source) : null;
			if (split != null) {
				title = split.title;
				artist = split.artist;
			} else {
				title = ogTitle;
			}
		}

		return {
			service: 'appleMusic',
			serviceLabel: 'Apple Music',
			title,
			artist,
			url: canonical,
			thumbnailUrl,
		};
	}

	@bindThis
	private async resolveAmazonMusic(url: URL): Promise<ResolvedMusicUrl> {
		const canonical = `${url.origin}${url.pathname}`;
		const html = await this.fetchHtmlSafe(canonical);

		let title: string | null = null;
		let artist: string | null = null;
		let thumbnailUrl: string | null = null;

		if (html != null) {
			const ogTitle = extractOgMeta(html, 'og:title');
			thumbnailUrl = extractOgMeta(html, 'og:image');

			if (ogTitle != null) {
				// "Song by Artist on Amazon Music" または "Song - Artist"
				const cleaned = ogTitle.replace(/\s+on\s+Amazon Music$/i, '');
				const split = splitTitleByArtist(cleaned);
				if (split != null) {
					title = split.title;
					artist = split.artist;
				} else {
					title = cleaned;
				}
			}
		}

		return {
			service: 'amazonMusic',
			serviceLabel: 'Amazon Music',
			title,
			artist,
			url: canonical,
			thumbnailUrl,
		};
	}

	@bindThis
	private async resolveOther(url: URL): Promise<ResolvedMusicUrl> {
		const canonical = `${url.origin}${url.pathname}`;
		const html = await this.fetchHtmlSafe(canonical);

		let title: string | null = null;
		let thumbnailUrl: string | null = null;
		let serviceLabel = url.hostname;

		if (html != null) {
			title = extractOgMeta(html, 'og:title');
			thumbnailUrl = extractOgMeta(html, 'og:image');
			const siteName = extractOgMeta(html, 'og:site_name');
			if (siteName != null && siteName.length > 0) serviceLabel = siteName;
		}

		return {
			service: 'other',
			serviceLabel,
			title,
			artist: null,
			url: canonical,
			thumbnailUrl,
		};
	}
}
