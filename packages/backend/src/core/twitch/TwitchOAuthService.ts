/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { randomBytes } from 'node:crypto';
import { Injectable, Inject } from '@nestjs/common';
import * as Redis from 'ioredis';
import { IsNull, Not } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { TwitchAccountsRepository } from '@/models/_.js';
import { MiTwitchAccount } from '@/models/TwitchAccount.js';
import type { MiUser } from '@/models/User.js';
import { IdService } from '@/core/IdService.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { TwitchApiService, TwitchApiError } from './TwitchApiService.js';
import { TwitchLoggerService } from './TwitchLoggerService.js';

const AUTHORIZE_URL = 'https://id.twitch.tv/oauth2/authorize';

const STATE_REDIS_PREFIX = 'twitchOAuthState:';
const STATE_TTL_SEC = 60 * 10;

// 一般ユーザー (配信者): channel:bot で中継 bot の入室/発言を事前許可する。
// channel:read:stream_key は Twitch 同時転送 (OME Push) でストリームキーを都度取得するために使う
// (2026-07-31 追加。追加以前に連携したユーザーは再連携するまでこの scope を持たない)。
const USER_SCOPES = ['channel:bot', 'channel:read:stream_key'];
// インスタンス共通 bot: チャット読み書き
const BOT_SCOPES = ['user:read:chat', 'user:write:chat', 'user:bot'];

// accessToken の残り有効期間がこれを切ったら refresh する
const TOKEN_REFRESH_MARGIN_MS = 1000 * 60 * 5;

type OAuthStatePayload = {
	userId: MiUser['id'];
	forBot: boolean;
};

export class TwitchOAuthCallbackError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TwitchOAuthCallbackError';
	}
}

@Injectable()
export class TwitchOAuthService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.twitchAccountsRepository)
		private twitchAccountsRepository: TwitchAccountsRepository,

		private idService: IdService,
		private twitchApiService: TwitchApiService,
		private twitchLoggerService: TwitchLoggerService,
	) {
		this.logger = this.twitchLoggerService.child('oauth');
	}

	public get redirectUri(): string {
		return `${this.config.url}/twitch/oauth/callback`;
	}

	/**
	 * 認可 URL を生成する。state は Redis に保存され callback で一度だけ消費される。
	 * @param forBot true ならインスタンス共通 bot アカウントの連携 (admin 専用、呼び出し側で権限確認)
	 */
	@bindThis
	public async generateAuthorizeUrl(userId: MiUser['id'], forBot = false): Promise<string> {
		if (this.config.twitch == null) throw new Error('Twitch integration is not configured.');

		const state = randomBytes(32).toString('hex');
		const payload: OAuthStatePayload = { userId, forBot };
		await this.redisClient.set(`${STATE_REDIS_PREFIX}${state}`, JSON.stringify(payload), 'EX', STATE_TTL_SEC);

		const url = new URL(AUTHORIZE_URL);
		url.searchParams.set('response_type', 'code');
		url.searchParams.set('client_id', this.config.twitch.clientId);
		url.searchParams.set('redirect_uri', this.redirectUri);
		url.searchParams.set('scope', (forBot ? BOT_SCOPES : USER_SCOPES).join(' '));
		url.searchParams.set('state', state);
		// アカウント切替を可能にする (bot 連携時に別アカウントでログインし直すケース)
		url.searchParams.set('force_verify', 'true');
		return url.toString();
	}

	/**
	 * OAuth callback を処理し、twitch_account を upsert する。
	 * @returns forBot: bot 連携だったかどうか (リダイレクト先の出し分け用)
	 */
	@bindThis
	public async handleCallback(code: string, state: string): Promise<{ forBot: boolean }> {
		const stateKey = `${STATE_REDIS_PREFIX}${state}`;
		const payloadRaw = await this.redisClient.getdel(stateKey);
		if (payloadRaw == null) {
			throw new TwitchOAuthCallbackError('Invalid or expired state.');
		}
		const payload = JSON.parse(payloadRaw) as OAuthStatePayload;

		const token = await this.twitchApiService.exchangeCode(code, this.redirectUri);
		const twitchUser = await this.twitchApiService.getUserByToken(token.access_token);
		if (twitchUser == null) {
			throw new TwitchOAuthCallbackError('Failed to fetch the Twitch user for the granted token.');
		}

		const expiresAt = new Date(Date.now() + token.expires_in * 1000);
		const values = {
			twitchUserId: twitchUser.id,
			twitchLogin: twitchUser.login,
			twitchDisplayName: twitchUser.display_name,
			accessToken: token.access_token,
			refreshToken: token.refresh_token ?? null,
			expiresAt,
			scopes: token.scope ?? [],
		} satisfies Partial<MiTwitchAccount>;

		// 同じ Twitch アカウントが別の行 (別ユーザー / bot) に紐付いていたら拒否する
		const conflicting = await this.twitchAccountsRepository.findOneBy({ twitchUserId: twitchUser.id });

		if (payload.forBot) {
			if (conflicting != null && !conflicting.isBot) {
				throw new TwitchOAuthCallbackError(`Twitch account @${twitchUser.login} is already linked to a user.`);
			}
			const existing = await this.twitchAccountsRepository.findOneBy({ isBot: true });
			if (existing != null) {
				await this.twitchAccountsRepository.update(existing.id, values);
			} else {
				await this.twitchAccountsRepository.insertOne(new MiTwitchAccount({
					id: this.idService.gen(),
					userId: null,
					isBot: true,
					...values,
				}));
			}
			this.logger.info(`bot account linked: @${twitchUser.login} (${twitchUser.id})`);
		} else {
			if (conflicting != null && conflicting.userId !== payload.userId) {
				throw new TwitchOAuthCallbackError(`Twitch account @${twitchUser.login} is already linked to another user.`);
			}
			const existing = await this.twitchAccountsRepository.findOneBy({ userId: payload.userId });
			if (existing != null) {
				await this.twitchAccountsRepository.update(existing.id, values);
			} else {
				await this.twitchAccountsRepository.insertOne(new MiTwitchAccount({
					id: this.idService.gen(),
					userId: payload.userId,
					isBot: false,
					...values,
				}));
			}
			this.logger.info(`account linked: user=${payload.userId} twitch=@${twitchUser.login} (${twitchUser.id})`);
		}

		return { forBot: payload.forBot };
	}

	/**
	 * 連携解除。トークンの revoke は best-effort。
	 */
	@bindThis
	public async unlink(userId: MiUser['id']): Promise<boolean> {
		const account = await this.twitchAccountsRepository.findOneBy({ userId });
		if (account == null) return false;

		await this.twitchApiService.revokeToken(account.accessToken);
		await this.twitchAccountsRepository.delete(account.id);
		this.logger.info(`account unlinked: user=${userId} twitch=@${account.twitchLogin}`);
		return true;
	}

	@bindThis
	public async getLinkedAccount(userId: MiUser['id']): Promise<MiTwitchAccount | null> {
		return await this.twitchAccountsRepository.findOneBy({ userId });
	}

	@bindThis
	public async getBotAccount(): Promise<MiTwitchAccount | null> {
		return await this.twitchAccountsRepository.findOneBy({ isBot: true });
	}

	@bindThis
	public async getAllLinkedAccounts(): Promise<MiTwitchAccount[]> {
		return await this.twitchAccountsRepository.findBy({ userId: Not(IsNull()) });
	}

	/**
	 * 有効な user access token を返す。失効間際なら refresh して DB を更新する。
	 * refresh が拒否された (ユーザーが Twitch 側で連携解除した) 場合は行を削除して null を返す。
	 */
	@bindThis
	public async getValidAccessToken(account: MiTwitchAccount): Promise<string | null> {
		if (account.expiresAt.getTime() - Date.now() > TOKEN_REFRESH_MARGIN_MS) {
			return account.accessToken;
		}

		if (account.refreshToken == null) {
			this.logger.warn(`token expired without refresh token: @${account.twitchLogin}`);
			await this.twitchAccountsRepository.delete(account.id);
			return null;
		}

		try {
			const token = await this.twitchApiService.refreshToken(account.refreshToken);
			await this.twitchAccountsRepository.update(account.id, {
				accessToken: token.access_token,
				refreshToken: token.refresh_token ?? account.refreshToken,
				expiresAt: new Date(Date.now() + token.expires_in * 1000),
				scopes: token.scope ?? account.scopes,
			});
			account.accessToken = token.access_token;
			return token.access_token;
		} catch (err) {
			// invalid_grant (400/401) = Twitch 側で許可が取り消されている → 連携を解除する。
			// ネットワーク断や Twitch 障害などの一時的エラーで連携を消さないよう、削除は明確な拒否時のみ
			if (err instanceof TwitchApiError && (err.status === 400 || err.status === 401)) {
				this.logger.warn(`token refresh rejected, unlinking @${account.twitchLogin}: ${err.message}`);
				await this.twitchAccountsRepository.delete(account.id);
			} else {
				this.logger.warn(`token refresh failed (transient, keeping account) @${account.twitchLogin}: ${err instanceof Error ? err.message : err}`);
			}
			return null;
		}
	}
}
