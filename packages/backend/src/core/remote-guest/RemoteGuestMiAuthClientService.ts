/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { randomBytes } from 'node:crypto';
import { Injectable, Inject } from '@nestjs/common';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { RemoteGuestLoggerService } from './RemoteGuestLoggerService.js';
import { RemoteGuestHostAllowlistService } from './RemoteGuestHostAllowlistService.js';
import { RemoteGuestAccountService } from './RemoteGuestAccountService.js';
import { RemoteGuestSessionService } from './RemoteGuestSessionService.js';

const LOGIN_REDIS_PREFIX = 'remoteGuestLogin:';
const LOGIN_TTL_SEC = 60 * 10;
const REQUEST_TIMEOUT_MS = 10000;

type LoginStatePayload = {
	host: string;
	expectedUsernameLower: string;
	returnTo: string;
};

// リモートインスタンスの MiAuth check レスポンス (必要なフィールドのみ)
type MiAuthCheckResponse = {
	ok: boolean;
	token?: string;
	user?: {
		username: string;
		host: string | null;
		name: string | null;
		avatarUrl: string | null;
	};
};

export type RemoteGuestCallbackResult =
	| { result: 'expired' | 'denied' | 'usernameMismatch'; returnTo: string }
	| { result: 'linked'; returnTo: string; token: string; expiresAt: Date; acct: string };

export class RemoteGuestLoginError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RemoteGuestLoginError';
	}
}

// リモート Misskey インスタンスの MiAuth を「こちらがクライアントとして消費する」実装。
// 通常の MiAuth は「このインスタンスが提供する側」だが、ここでは逆方向 (他インスタンスへログインさせに行く)。
@Injectable()
export class RemoteGuestMiAuthClientService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		private hostAllowlistService: RemoteGuestHostAllowlistService,
		private remoteGuestAccountService: RemoteGuestAccountService,
		private remoteGuestSessionService: RemoteGuestSessionService,
		private remoteGuestLoggerService: RemoteGuestLoggerService,
	) {
		this.logger = this.remoteGuestLoggerService.child('miauth-client');
	}

	private get callbackUrl(): string {
		return `${this.config.url}/remote-guest/callback`;
	}

	/**
	 * ログイン開始。host は呼び出し側で isAllowed 済みであること (この関数内でも再検証する)。
	 * @param returnTo "/live/" 始まりの相対パスのみ許可 (オープンリダイレクト対策、呼び出し側で検証済み前提だがここでも確認する)
	 */
	@bindThis
	public async generateLoginUrl(host: string, username: string, returnTo: string): Promise<string> {
		const normalizedHost = this.hostAllowlistService.normalize(host);
		if (!this.hostAllowlistService.isAllowed(normalizedHost)) {
			throw new RemoteGuestLoginError(`Host not allowed: ${normalizedHost}`);
		}
		if (!returnTo.startsWith('/live/')) {
			throw new RemoteGuestLoginError(`Invalid returnTo: ${returnTo}`);
		}

		const session = randomBytes(32).toString('hex');
		const payload: LoginStatePayload = {
			host: normalizedHost,
			expectedUsernameLower: username.toLowerCase(),
			returnTo,
		};
		await this.redisClient.set(`${LOGIN_REDIS_PREFIX}${session}`, JSON.stringify(payload), 'EX', LOGIN_TTL_SEC);

		const url = new URL(`https://${normalizedHost}/miauth/${session}`);
		url.searchParams.set('name', this.config.url);
		url.searchParams.set('callback', this.callbackUrl);
		return url.toString();
	}

	/**
	 * コールバック処理。session は一度きり消費 (Redis getdel)。
	 */
	@bindThis
	public async handleCallback(session: string): Promise<RemoteGuestCallbackResult> {
		const key = `${LOGIN_REDIS_PREFIX}${session}`;
		const payloadRaw = await this.redisClient.getdel(key);
		if (payloadRaw == null) {
			this.logger.info('callback: expired or unknown session');
			return { result: 'expired', returnTo: '/' };
		}
		const payload = JSON.parse(payloadRaw) as LoginStatePayload;

		// 10 分の間に allowlist が変更された場合への防御 (二重チェック)
		if (!this.hostAllowlistService.isAllowed(payload.host)) {
			this.logger.warn(`callback: host no longer allowed: ${payload.host}`);
			return { result: 'denied', returnTo: payload.returnTo };
		}

		let check: MiAuthCheckResponse;
		try {
			check = await this.fetchMiAuthCheck(payload.host, session);
		} catch (err) {
			this.logger.error(`callback: miauth check request failed (${payload.host}): ${err instanceof Error ? err.message : err}`);
			return { result: 'denied', returnTo: payload.returnTo };
		}

		if (!check.ok || check.user == null) {
			this.logger.info(`callback: denied by remote host (${payload.host})`);
			return { result: 'denied', returnTo: payload.returnTo };
		}

		if (check.user.username.toLowerCase() !== payload.expectedUsernameLower) {
			this.logger.warn(`callback: username mismatch (expected=${payload.expectedUsernameLower}, got=${check.user.username}@${payload.host})`);
			return { result: 'usernameMismatch', returnTo: payload.returnTo };
		}

		const account = await this.remoteGuestAccountService.upsertFromMiAuthUser(check.user.username, payload.host, {
			displayName: check.user.name,
			avatarUrl: check.user.avatarUrl,
		});
		const { token, expiresAt } = await this.remoteGuestSessionService.issue(account);

		this.logger.info(`callback: linked @${check.user.username}@${payload.host}`);
		return { result: 'linked', returnTo: payload.returnTo, token, expiresAt, acct: `${check.user.username}@${payload.host}` };
	}

	@bindThis
	private async fetchMiAuthCheck(host: string, session: string): Promise<MiAuthCheckResponse> {
		const url = `https://${host}/api/miauth/${session}/check`;
		const ac = new AbortController();
		const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
		try {
			// TwitchApiService / AtpHttpClientService と同様、Node built-in fetch (undici) を使う。
			// 到達先は事前に allowlist 照合済みの host からのみ組み立てられる。
			const res = await fetch(url, {
				method: 'POST',
				headers: {
					'Accept': 'application/json',
					'User-Agent': `Misskey/${this.config.version} (remote-guest-login)`,
				},
				signal: ac.signal,
			});
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}`);
			}
			return await res.json() as MiAuthCheckResponse;
		} finally {
			clearTimeout(timer);
		}
	}
}
