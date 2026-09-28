/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { MemoryKVCache } from '@/misc/cache.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
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

	constructor(
		private httpRequestService: HttpRequestService,
		private nowPlayingLoggerService: NowPlayingLoggerService,
	) {
		this.logger = this.nowPlayingLoggerService.child('url-resolver');
		// The key is a user-supplied URL, so cap the entry count to bound memory under abuse.
		this.cache = new MemoryKVCache<ResolvedMusicUrl>(CACHE_TTL_MS, 5000);
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
