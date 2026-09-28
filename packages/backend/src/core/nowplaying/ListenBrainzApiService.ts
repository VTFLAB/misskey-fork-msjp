/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, Inject } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { MemoryKVCache } from '@/misc/cache.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { NowPlayingLoggerService } from './NowPlayingLoggerService.js';

// NowPlaying (fork 独自): ListenBrainz API (https://listenbrainz.org/) との連携。
// anonymous app 登録不要、ユーザーが自分の user token を貼るだけで使える。

const API_BASE = 'https://api.listenbrainz.org/1';
const NOW_PLAYING_CACHE_TTL_MS = 1000 * 15;

export type ListenBrainzTrack = {
	title: string;
	artist: string;
	album: string | null;
	url: string | null;
	// 元の再生元サービス (additional_info.music_service / origin_url から推測)。判別不能なら null
	musicService: string | null;
};

export class ListenBrainzApiError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ListenBrainzApiError';
	}
}

type ValidateTokenResponse = {
	valid: boolean;
	user_name?: string;
	message?: string;
};

type PlayingNowResponse = {
	payload?: {
		listens?: Array<{
			track_metadata?: {
				track_name?: string;
				artist_name?: string;
				release_name?: string;
				additional_info?: {
					music_service?: string;
					music_service_name?: string;
					origin_url?: string;
				};
			};
		}>;
	};
};

@Injectable()
export class ListenBrainzApiService {
	private logger: Logger;
	private readonly nowPlayingCache: MemoryKVCache<{ track: ListenBrainzTrack | null }>;

	constructor(
		@Inject(DI.config)
		private config: Config,

		private httpRequestService: HttpRequestService,
		private nowPlayingLoggerService: NowPlayingLoggerService,
	) {
		this.logger = this.nowPlayingLoggerService.child('listenbrainz');
		this.nowPlayingCache = new MemoryKVCache(NOW_PLAYING_CACHE_TTL_MS);
	}

	private get userAgent(): string {
		return `Misskey-bsky-fork/${this.config.version} (+${this.config.url})`;
	}

	/**
	 * user token を検証し、ListenBrainz 上のユーザー名を返す。
	 */
	@bindThis
	public async validateToken(token: string): Promise<string> {
		const res = await this.httpRequestService.getJson<ValidateTokenResponse>(
			`${API_BASE}/validate-token`,
			'application/json, */*',
			{
				'Authorization': `Token ${token}`,
				'User-Agent': this.userAgent,
			},
		);
		if (!res.valid || res.user_name == null) {
			throw new ListenBrainzApiError(res.message ?? 'Invalid ListenBrainz token.');
		}
		return res.user_name;
	}

	/**
	 * 現在再生中のトラックを返す (playing-now)。15秒キャッシュ (per username)。
	 * 取得失敗時は null を返し例外は投げない。
	 */
	@bindThis
	public async getNowPlaying(username: string): Promise<ListenBrainzTrack | null> {
		const cached = this.nowPlayingCache.get(username);
		if (cached != null) return cached.track;

		let track: ListenBrainzTrack | null = null;
		try {
			const res = await this.httpRequestService.getJson<PlayingNowResponse>(
				`${API_BASE}/user/${encodeURIComponent(username)}/playing-now`,
				'application/json, */*',
				{ 'User-Agent': this.userAgent },
			);
			const meta = res.payload?.listens?.[0]?.track_metadata;
			if (meta?.track_name != null) {
				track = {
					title: meta.track_name,
					artist: meta.artist_name ?? '',
					album: meta.release_name ?? null,
					url: meta.additional_info?.origin_url ?? null,
					musicService: this.detectMusicService(
						meta.additional_info?.music_service ??
						meta.additional_info?.music_service_name ??
						meta.additional_info?.origin_url ??
						null,
					),
				};
			}
		} catch (err) {
			// 一時的な取得失敗は「再生中トラック無し」として扱う (呼び出し側を500にしない)
			this.logger.warn(`getNowPlaying failed for ${username}: ${err instanceof Error ? err.message : err}`);
		}

		this.nowPlayingCache.set(username, { track });
		return track;
	}

	@bindThis
	private detectMusicService(hint: string | null): string | null {
		if (hint == null) return null;
		const lower = hint.toLowerCase();
		if (lower.includes('music.youtube') || lower.includes('youtube music')) return 'YouTube Music';
		if (lower.includes('youtube')) return 'YouTube';
		if (lower.includes('music.amazon') || lower.includes('amazon music')) return 'Amazon Music';
		if (lower.includes('music.apple') || lower.includes('apple music')) return 'Apple Music';
		if (lower.includes('spotify')) return 'Spotify';
		return null;
	}
}
