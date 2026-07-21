/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { randomBytes } from 'node:crypto';
import { Injectable, Inject } from '@nestjs/common';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { GoogleAccountsRepository } from '@/models/_.js';
import { MiGoogleAccount } from '@/models/GoogleAccount.js';
import type { MiUser } from '@/models/User.js';
import { IdService } from '@/core/IdService.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { GoogleLoggerService } from './GoogleLoggerService.js';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const REQUEST_TIMEOUT_MS = 10000;

const STATE_REDIS_PREFIX = 'googleOAuthState:';
const STATE_TTL_SEC = 60 * 10;

// drive.file: アプリが作成/開いたファイルのみアクセス可 (配信アーカイブのアップロード専用に十分)
// youtube.upload: 配信アーカイブの YouTube アップロード専用 (granular consent で拒否されうるため
// GoogleYoutubeService.isAuthorizedForUpload が実際に許可されたか scopes を都度確認する)
const SCOPES = ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/youtube.upload', 'openid', 'email'];

// accessToken の残り有効期間がこれを切ったら refresh する
const TOKEN_REFRESH_MARGIN_MS = 1000 * 60 * 5;

type GoogleTokenResponse = {
	access_token: string;
	refresh_token?: string;
	expires_in: number;
	scope?: string;
	token_type: string;
	id_token?: string;
};

type GoogleUserInfo = {
	sub: string;
	email?: string;
	email_verified?: boolean;
};

export class GoogleApiError extends Error {
	constructor(
		public readonly status: number,
		public readonly endpoint: string,
		public readonly body: string,
	) {
		super(`Google HTTP ${status} ${endpoint}: ${body.slice(0, 200)}`);
		this.name = 'GoogleApiError';
	}
}

export class GoogleOAuthCallbackError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'GoogleOAuthCallbackError';
	}
}

type OAuthStatePayload = {
	userId: MiUser['id'];
};

@Injectable()
export class GoogleOAuthService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.googleAccountsRepository)
		private googleAccountsRepository: GoogleAccountsRepository,

		private idService: IdService,
		private googleLoggerService: GoogleLoggerService,
	) {
		this.logger = this.googleLoggerService.child('oauth');
	}

	public get isEnabled(): boolean {
		return this.config.google != null;
	}

	public get redirectUri(): string {
		return `${this.config.url}/google-drive/oauth/callback`;
	}

	// config.google が無い状態で呼ばれたら実装バグ (エンドポイント側で isEnabled を先に確認する)
	@bindThis
	private getCredentials(): { clientId: string; clientSecret: string } {
		if (this.config.google == null) {
			throw new Error('Google integration is not configured.');
		}
		return this.config.google;
	}

	/**
	 * 認可 URL を生成する。state は Redis に保存され callback で一度だけ消費される。
	 * access_type=offline + prompt=consent で refresh_token を確実に取得する。
	 */
	@bindThis
	public async generateAuthorizeUrl(userId: MiUser['id']): Promise<string> {
		const { clientId } = this.getCredentials();

		const state = randomBytes(32).toString('hex');
		const payload: OAuthStatePayload = { userId };
		await this.redisClient.set(`${STATE_REDIS_PREFIX}${state}`, JSON.stringify(payload), 'EX', STATE_TTL_SEC);

		const url = new URL(AUTHORIZE_URL);
		url.searchParams.set('response_type', 'code');
		url.searchParams.set('client_id', clientId);
		url.searchParams.set('redirect_uri', this.redirectUri);
		url.searchParams.set('scope', SCOPES.join(' '));
		url.searchParams.set('state', state);
		url.searchParams.set('access_type', 'offline');
		url.searchParams.set('prompt', 'consent');
		return url.toString();
	}

	/**
	 * OAuth callback を処理し、google_account を upsert する。
	 */
	@bindThis
	public async handleCallback(code: string, state: string): Promise<void> {
		const stateKey = `${STATE_REDIS_PREFIX}${state}`;
		const payloadRaw = await this.redisClient.getdel(stateKey);
		if (payloadRaw == null) {
			throw new GoogleOAuthCallbackError('Invalid or expired state.');
		}
		const payload = JSON.parse(payloadRaw) as OAuthStatePayload;

		const token = await this.exchangeCode(code);
		if (token.refresh_token == null) {
			// prompt=consent を指定しているので通常は発行されるが、既存の同意状態によっては
			// refresh_token が省略されることがある。既存行の refreshToken を維持する。
			this.logger.warn(`no refresh_token returned for user=${payload.userId}, keeping existing one if any`);
		}

		const userInfo = await this.getUserInfo(token.access_token);
		if (userInfo.email == null) {
			throw new GoogleOAuthCallbackError('Failed to fetch the Google account email for the granted token.');
		}

		const expiresAt = new Date(Date.now() + token.expires_in * 1000);
		const existing = await this.googleAccountsRepository.findOneBy({ userId: payload.userId });

		const values = {
			googleEmail: userInfo.email,
			accessToken: token.access_token,
			refreshToken: token.refresh_token ?? existing?.refreshToken ?? null,
			expiresAt,
			scopes: token.scope?.split(' ') ?? existing?.scopes ?? [],
		} satisfies Partial<MiGoogleAccount>;

		if (existing != null) {
			await this.googleAccountsRepository.update(existing.id, values);
		} else {
			await this.googleAccountsRepository.insertOne(new MiGoogleAccount({
				id: this.idService.gen(),
				userId: payload.userId,
				folderId: null,
				...values,
			}));
		}
		this.logger.info(`account linked: user=${payload.userId} google=${userInfo.email}`);
	}

	/**
	 * 連携解除。トークンの revoke は best-effort。
	 */
	@bindThis
	public async unlink(userId: MiUser['id']): Promise<boolean> {
		const account = await this.googleAccountsRepository.findOneBy({ userId });
		if (account == null) return false;

		if (account.accessToken != null) {
			await this.revokeToken(account.accessToken).catch(err => {
				this.logger.warn(`token revoke failed: ${err instanceof Error ? err.message : err}`);
			});
		}
		await this.googleAccountsRepository.delete(account.id);
		this.logger.info(`account unlinked: user=${userId} google=${account.googleEmail}`);
		return true;
	}

	@bindThis
	public async getLinkedAccount(userId: MiUser['id']): Promise<MiGoogleAccount | null> {
		return await this.googleAccountsRepository.findOneBy({ userId });
	}

	/**
	 * 有効な access token を返す。失効間際なら refresh して DB を更新する。
	 * refresh が拒否された (ユーザーが Google 側で連携解除した) 場合は行を削除して null を返す。
	 */
	@bindThis
	public async getValidAccessToken(userId: MiUser['id']): Promise<string | null> {
		const account = await this.googleAccountsRepository.findOneBy({ userId });
		if (account == null) return null;

		if (account.accessToken != null && account.expiresAt.getTime() - Date.now() > TOKEN_REFRESH_MARGIN_MS) {
			return account.accessToken;
		}

		if (account.refreshToken == null) {
			this.logger.warn(`token expired without refresh token: ${account.googleEmail}`);
			await this.googleAccountsRepository.delete(account.id);
			return null;
		}

		try {
			const token = await this.refreshToken(account.refreshToken);
			await this.googleAccountsRepository.update(account.id, {
				accessToken: token.access_token,
				expiresAt: new Date(Date.now() + token.expires_in * 1000),
				scopes: token.scope?.split(' ') ?? account.scopes,
			});
			return token.access_token;
		} catch (err) {
			// invalid_grant (400) = Google 側で許可が取り消されている → 連携を解除する。
			// ネットワーク断や Google 障害などの一時的エラーで連携を消さないよう、削除は明確な拒否時のみ
			if (err instanceof GoogleApiError && err.status === 400 && err.body.includes('invalid_grant')) {
				this.logger.warn(`token refresh rejected, unlinking ${account.googleEmail}: ${err.message}`);
				await this.googleAccountsRepository.delete(account.id);
			} else {
				this.logger.warn(`token refresh failed (transient, keeping account) ${account.googleEmail}: ${err instanceof Error ? err.message : err}`);
			}
			return null;
		}
	}

	//#region token endpoint (oauth2.googleapis.com)

	@bindThis
	private async exchangeCode(code: string): Promise<GoogleTokenResponse> {
		const { clientId, clientSecret } = this.getCredentials();
		return await this.postForm<GoogleTokenResponse>(TOKEN_URL, {
			client_id: clientId,
			client_secret: clientSecret,
			code,
			grant_type: 'authorization_code',
			redirect_uri: this.redirectUri,
		});
	}

	@bindThis
	private async refreshToken(refreshToken: string): Promise<GoogleTokenResponse> {
		const { clientId, clientSecret } = this.getCredentials();
		return await this.postForm<GoogleTokenResponse>(TOKEN_URL, {
			client_id: clientId,
			client_secret: clientSecret,
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
		});
	}

	@bindThis
	private async revokeToken(token: string): Promise<void> {
		await this.postForm('https://oauth2.googleapis.com/revoke', { token });
	}

	@bindThis
	private async getUserInfo(accessToken: string): Promise<GoogleUserInfo> {
		return await this.fetchJson<GoogleUserInfo>(USERINFO_URL, {
			method: 'GET',
			headers: {
				'Authorization': `Bearer ${accessToken}`,
				'Accept': 'application/json',
			},
		});
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
			const res = await fetch(urlStr, {
				...init,
				headers: {
					...init.headers as Record<string, string>,
					'User-Agent': `Misskey/${this.config.version} (google-drive-integration)`,
				},
				signal: ac.signal,
			});
			if (!res.ok) {
				const body = await res.text().catch(() => '');
				// トークンを含みうる query は落とし、パスだけログに残す
				throw new GoogleApiError(res.status, new URL(urlStr).pathname, body);
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
