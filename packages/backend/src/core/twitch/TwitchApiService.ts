/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, Inject } from '@nestjs/common';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { TwitchLoggerService } from './TwitchLoggerService.js';

const ID_BASE = 'https://id.twitch.tv';
const HELIX_BASE = 'https://api.twitch.tv';
const REQUEST_TIMEOUT_MS = 10000;

// app access token の Redis キャッシュ。失効の 10 分前に自動再取得する。
const APP_TOKEN_REDIS_KEY = 'twitch:appAccessToken';
const APP_TOKEN_EXPIRY_MARGIN_SEC = 60 * 10;

export class TwitchApiError extends Error {
	constructor(
		public readonly status: number,
		public readonly endpoint: string,
		public readonly body: string,
	) {
		super(`Twitch HTTP ${status} ${endpoint}: ${body.slice(0, 200)}`);
		this.name = 'TwitchApiError';
	}
}

export type TwitchTokenResponse = {
	access_token: string;
	refresh_token?: string;
	expires_in: number;
	scope?: string[];
	token_type: string;
};

export type TwitchHelixUser = {
	id: string;
	login: string;
	display_name: string;
	type: string;
	broadcaster_type: string;
	description: string;
	profile_image_url: string;
	offline_image_url: string;
	created_at: string;
};

export type TwitchHelixStream = {
	id: string;
	user_id: string;
	user_login: string;
	user_name: string;
	game_id: string;
	game_name: string;
	type: string;
	title: string;
	viewer_count: number;
	started_at: string;
	language: string;
	thumbnail_url: string;
	is_mature: boolean;
};

@Injectable()
export class TwitchApiService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		private twitchLoggerService: TwitchLoggerService,
	) {
		this.logger = this.twitchLoggerService.child('api');
	}

	public get isEnabled(): boolean {
		return this.config.twitch != null;
	}

	// config.twitch が無い状態で呼ばれたら実装バグ (エンドポイント側で isEnabled を先に確認する)
	@bindThis
	private getCredentials(): { clientId: string; clientSecret: string } {
		if (this.config.twitch == null) {
			throw new Error('Twitch integration is not configured.');
		}
		return this.config.twitch;
	}

	//#region OAuth token endpoints (id.twitch.tv)

	@bindThis
	public async exchangeCode(code: string, redirectUri: string): Promise<TwitchTokenResponse> {
		const { clientId, clientSecret } = this.getCredentials();
		return await this.postForm<TwitchTokenResponse>(`${ID_BASE}/oauth2/token`, {
			client_id: clientId,
			client_secret: clientSecret,
			code,
			grant_type: 'authorization_code',
			redirect_uri: redirectUri,
		});
	}

	@bindThis
	public async refreshToken(refreshToken: string): Promise<TwitchTokenResponse> {
		const { clientId, clientSecret } = this.getCredentials();
		return await this.postForm<TwitchTokenResponse>(`${ID_BASE}/oauth2/token`, {
			client_id: clientId,
			client_secret: clientSecret,
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
		});
	}

	@bindThis
	public async revokeToken(token: string): Promise<void> {
		const { clientId } = this.getCredentials();
		await this.postForm(`${ID_BASE}/oauth2/revoke`, {
			client_id: clientId,
			token,
		}).catch(err => {
			// revoke は best-effort (既に失効している場合 400 が返る)
			this.logger.warn(`token revoke failed: ${err instanceof Error ? err.message : err}`);
		});
	}

	/**
	 * client_credentials で app access token を取得する。Redis にキャッシュされ、
	 * 全プロセスで共有される。
	 */
	@bindThis
	public async getAppAccessToken(): Promise<string> {
		const cached = await this.redisClient.get(APP_TOKEN_REDIS_KEY);
		if (cached != null) return cached;

		const { clientId, clientSecret } = this.getCredentials();
		const res = await this.postForm<TwitchTokenResponse>(`${ID_BASE}/oauth2/token`, {
			client_id: clientId,
			client_secret: clientSecret,
			grant_type: 'client_credentials',
		});

		const ttl = Math.max(res.expires_in - APP_TOKEN_EXPIRY_MARGIN_SEC, 60);
		await this.redisClient.set(APP_TOKEN_REDIS_KEY, res.access_token, 'EX', ttl);
		this.logger.info(`app access token refreshed (ttl=${ttl}s)`);
		return res.access_token;
	}

	//#endregion

	//#region Helix API (api.twitch.tv)

	/**
	 * Helix GET。token 未指定なら app access token を使う。
	 */
	@bindThis
	public async helixGet<T = unknown>(path: string, params: Record<string, string | number | string[] | undefined>, token?: string): Promise<T> {
		const { clientId } = this.getCredentials();
		const accessToken = token ?? await this.getAppAccessToken();

		const url = new URL(path, HELIX_BASE);
		for (const [k, v] of Object.entries(params)) {
			if (v == null) continue;
			if (Array.isArray(v)) {
				for (const item of v) url.searchParams.append(k, String(item));
			} else {
				url.searchParams.set(k, String(v));
			}
		}

		return await this.fetchJson<T>(url.toString(), {
			method: 'GET',
			headers: {
				'Authorization': `Bearer ${accessToken}`,
				'Client-Id': clientId,
				'Accept': 'application/json',
			},
		});
	}

	@bindThis
	public async helixPost<T = unknown>(path: string, body: Record<string, unknown>, token?: string): Promise<T> {
		const { clientId } = this.getCredentials();
		const accessToken = token ?? await this.getAppAccessToken();

		return await this.fetchJson<T>(new URL(path, HELIX_BASE).toString(), {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${accessToken}`,
				'Client-Id': clientId,
				'Content-Type': 'application/json',
				'Accept': 'application/json',
			},
			body: JSON.stringify(body),
		});
	}

	/**
	 * user access token に紐づく Twitch ユーザーを取得する (OAuth callback で本人特定に使う)。
	 */
	@bindThis
	public async getUserByToken(userAccessToken: string): Promise<TwitchHelixUser | null> {
		const res = await this.helixGet<{ data: TwitchHelixUser[] }>('/helix/users', {}, userAccessToken);
		return res.data[0] ?? null;
	}

	/**
	 * 配信者本人のストリームキーを取得する (bsky-fork 独自、Twitch 同時転送用)。
	 * scope: channel:read:stream_key を持つユーザートークンが必要。キーは DB へ保存せず、
	 * 転送開始時に都度取得して OME へ渡すだけに留める (漏洩面の最小化)。
	 */
	@bindThis
	public async getStreamKey(broadcasterId: string, userAccessToken: string): Promise<string | null> {
		const res = await this.helixGet<{ data: { stream_key: string }[] }>('/helix/streams/key', { broadcaster_id: broadcasterId }, userAccessToken);
		return res.data[0]?.stream_key ?? null;
	}

	/**
	 * Twitch user id (最大 100 件) でユーザー情報を取得する。
	 */
	@bindThis
	public async getUsersByIds(twitchUserIds: string[]): Promise<TwitchHelixUser[]> {
		if (twitchUserIds.length === 0) return [];
		const res = await this.helixGet<{ data: TwitchHelixUser[] }>('/helix/users', { id: twitchUserIds.slice(0, 100) });
		return res.data;
	}

	/**
	 * Twitch user id (最大 100 件) のうち現在配信中のストリームを取得する。
	 */
	@bindThis
	public async getStreamsByUserIds(twitchUserIds: string[]): Promise<TwitchHelixStream[]> {
		if (twitchUserIds.length === 0) return [];
		const res = await this.helixGet<{ data: TwitchHelixStream[] }>('/helix/streams', {
			user_id: twitchUserIds.slice(0, 100),
			first: 100,
		});
		return res.data;
	}

	//#endregion

	@bindThis
	private async postForm<T = unknown>(urlStr: string, form: Record<string, string>): Promise<T> {
		return await this.fetchJson<T>(urlStr, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'Accept': 'application/json',
			},
			body: new URLSearchParams(form).toString(),
		});
	}

	@bindThis
	private async fetchJson<T>(urlStr: string, init: RequestInit): Promise<T> {
		const ac = new AbortController();
		const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
		try {
			// AtpHttpClientService と同様、Node built-in fetch (undici) を使う。
			const res = await fetch(urlStr, {
				...init,
				headers: {
					...init.headers as Record<string, string>,
					'User-Agent': `Misskey/${this.config.version} (twitch-integration)`,
				},
				signal: ac.signal,
			});
			if (!res.ok) {
				const body = await res.text().catch(() => '');
				// トークンを含みうる query は落とし、パスだけログに残す
				throw new TwitchApiError(res.status, new URL(urlStr).pathname, body);
			}
			if (res.status === 204) return undefined as T;
			const text = await res.text();
			if (text.length === 0) return undefined as T;
			return JSON.parse(text) as T;
		} finally {
			clearTimeout(timer);
		}
	}
}
