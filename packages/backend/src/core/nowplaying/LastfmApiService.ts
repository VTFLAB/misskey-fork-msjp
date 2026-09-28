/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import { Injectable, Inject } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { MemoryKVCache } from '@/misc/cache.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { NowPlayingLoggerService } from './NowPlayingLoggerService.js';

// NowPlaying (fork 独自): Last.fm Web Services (https://www.last.fm/api) との連携。
// 自前 app なので api_key/api_secret はインスタンス設定 (config.lastfm) から取る。

const API_BASE = 'https://ws.audioscrobbler.com/2.0/';
const AUTH_BASE = 'https://www.last.fm/api/auth/';
const NOW_PLAYING_CACHE_TTL_MS = 1000 * 15;

export type LastfmTrack = {
	title: string;
	artist: string;
	album: string | null;
	url: string;
	thumbnailUrl: string | null;
};

export class LastfmApiError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'LastfmApiError';
	}
}

type LastfmImage = { '#text': string; size: string };

type LastfmRecentTracksResponse = {
	recenttracks?: {
		track?: Array<{
			name: string;
			artist?: { '#text': string };
			album?: { '#text': string };
			url: string;
			image?: LastfmImage[];
			'@attr'?: { nowplaying?: string };
		}>;
	};
	error?: number;
	message?: string;
};

type LastfmSessionResponse = {
	session?: { name: string; key: string; subscriber?: number };
	error?: number;
	message?: string;
};

@Injectable()
export class LastfmApiService {
	private logger: Logger;
	// nowplaying trackが無い(=null)場合もキャッシュしたいので Map の値自体を wrap する
	private readonly nowPlayingCache: MemoryKVCache<{ track: LastfmTrack | null }>;

	constructor(
		@Inject(DI.config)
		private config: Config,

		private httpRequestService: HttpRequestService,
		private nowPlayingLoggerService: NowPlayingLoggerService,
	) {
		this.logger = this.nowPlayingLoggerService.child('lastfm');
		this.nowPlayingCache = new MemoryKVCache(NOW_PLAYING_CACHE_TTL_MS);
	}

	public get isEnabled(): boolean {
		return this.config.lastfm != null;
	}

	@bindThis
	private getCredentials(): { apiKey: string; apiSecret: string } {
		if (this.config.lastfm == null) {
			throw new LastfmApiError('Last.fm integration is not configured on this instance.');
		}
		return this.config.lastfm;
	}

	/**
	 * Last.fm の Web Auth フロー用認可 URL。認可後 `cb` に token 付きで redirect される。
	 */
	@bindThis
	public generateAuthUrl(state: string): string {
		const { apiKey } = this.getCredentials();
		const callback = `${this.config.url}/nowplaying/lastfm/callback?state=${encodeURIComponent(state)}`;

		const url = new URL(AUTH_BASE);
		url.searchParams.set('api_key', apiKey);
		url.searchParams.set('cb', callback);
		return url.toString();
	}

	@bindThis
	private sign(params: Record<string, string>, apiSecret: string): string {
		// Last.fm の api_sig 仕様: パラメータをキー順にソートして連結し、末尾に secret を付けて md5
		const sorted = Object.keys(params).sort();
		let base = '';
		for (const key of sorted) {
			base += key + params[key];
		}
		base += apiSecret;
		return createHash('md5').update(base, 'utf8').digest('hex');
	}

	/**
	 * Web Auth token を session key に交換する (auth.getSession)。
	 */
	@bindThis
	public async getSession(token: string): Promise<{ sessionKey: string; username: string }> {
		const { apiKey, apiSecret } = this.getCredentials();

		const params: Record<string, string> = {
			method: 'auth.getSession',
			api_key: apiKey,
			token,
		};
		const apiSig = this.sign(params, apiSecret);

		const url = new URL(API_BASE);
		for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
		url.searchParams.set('api_sig', apiSig);
		url.searchParams.set('format', 'json');

		const res = await this.httpRequestService.getJson<LastfmSessionResponse>(url.toString());
		if (res.session == null) {
			throw new LastfmApiError(res.message ?? 'Failed to obtain a Last.fm session.');
		}
		return { sessionKey: res.session.key, username: res.session.name };
	}

	/**
	 * 現在再生中のトラックを返す (user.getrecenttracks, limit=1, @attr.nowplaying="true" のみ採用)。
	 * 15秒キャッシュ (per username)。取得失敗時は null を返し例外は投げない。
	 */
	@bindThis
	public async getNowPlaying(username: string): Promise<LastfmTrack | null> {
		const cached = this.nowPlayingCache.get(username);
		if (cached != null) return cached.track;

		let track: LastfmTrack | null = null;
		try {
			const { apiKey } = this.getCredentials();
			const url = new URL(API_BASE);
			url.searchParams.set('method', 'user.getrecenttracks');
			url.searchParams.set('user', username);
			url.searchParams.set('api_key', apiKey);
			url.searchParams.set('format', 'json');
			url.searchParams.set('limit', '1');

			const res = await this.httpRequestService.getJson<LastfmRecentTracksResponse>(url.toString());
			const first = res.recenttracks?.track?.[0];
			if (first != null && first['@attr']?.nowplaying === 'true') {
				const images = first.image ?? [];
				const largest = images[images.length - 1]?.['#text'];
				track = {
					title: first.name,
					artist: first.artist?.['#text'] ?? '',
					album: first.album?.['#text'] || null,
					url: first.url,
					thumbnailUrl: largest != null && largest.length > 0 ? largest : null,
				};
			}
		} catch (err) {
			// scrobble取得の一時失敗は「再生中トラック無し」として扱う (呼び出し側を500にしない)
			this.logger.warn(`getNowPlaying failed for ${username}: ${err instanceof Error ? err.message : err}`);
		}

		this.nowPlayingCache.set(username, { track });
		return track;
	}
}
