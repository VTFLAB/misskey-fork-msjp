/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { randomBytes } from 'node:crypto';
import { Injectable, Inject } from '@nestjs/common';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import type { MusicServiceAccountsRepository } from '@/models/_.js';
import { MiMusicServiceAccount, type MusicServiceAccountService } from '@/models/MusicServiceAccount.js';
import type { MiUser } from '@/models/User.js';
import { IdService } from '@/core/IdService.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { isDuplicateKeyValueError } from '@/misc/is-duplicate-key-value-error.js';
import { LastfmApiService } from './LastfmApiService.js';
import { ListenBrainzApiService } from './ListenBrainzApiService.js';
import { NowPlayingLoggerService } from './NowPlayingLoggerService.js';

// NowPlaying (fork 独自): Last.fm / ListenBrainz 連携アカウントの管理 + 現在再生中トラックの集約。

const LASTFM_STATE_REDIS_PREFIX = 'nowPlayingLastfmState:';
const LASTFM_STATE_TTL_SEC = 60 * 10;

type LastfmStatePayload = {
	userId: MiUser['id'];
};

export type NowPlayingCurrent = {
	source: 'listenbrainz' | 'lastfm';
	title: string;
	artist: string;
	album: string | null;
	url: string | null;
	thumbnailUrl: string | null;
	serviceLabel: string;
};

export type NowPlayingAccountSummary = {
	service: MusicServiceAccountService;
	serviceUsername: string | null;
	createdAt: Date;
};

export class NowPlayingCallbackError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NowPlayingCallbackError';
	}
}

@Injectable()
export class NowPlayingService {
	private logger: Logger;

	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.musicServiceAccountsRepository)
		private musicServiceAccountsRepository: MusicServiceAccountsRepository,

		private idService: IdService,
		private lastfmApiService: LastfmApiService,
		private listenBrainzApiService: ListenBrainzApiService,
		private nowPlayingLoggerService: NowPlayingLoggerService,
	) {
		this.logger = this.nowPlayingLoggerService.child('service');
	}

	//#region Last.fm link flow (web auth, Twitch OAuth state と同じ Redis one-shot state パターン)

	@bindThis
	public async generateLastfmAuthUrl(userId: MiUser['id']): Promise<string> {
		if (!this.lastfmApiService.isEnabled) {
			throw new Error('Last.fm integration is not configured.');
		}

		const state = randomBytes(32).toString('hex');
		const payload: LastfmStatePayload = { userId };
		await this.redisClient.set(`${LASTFM_STATE_REDIS_PREFIX}${state}`, JSON.stringify(payload), 'EX', LASTFM_STATE_TTL_SEC);

		return this.lastfmApiService.generateAuthUrl(state);
	}

	@bindThis
	public async handleLastfmCallback(token: string, state: string): Promise<NowPlayingAccountSummary> {
		const stateKey = `${LASTFM_STATE_REDIS_PREFIX}${state}`;
		const payloadRaw = await this.redisClient.getdel(stateKey);
		if (payloadRaw == null) {
			throw new NowPlayingCallbackError('Invalid or expired state.');
		}
		const payload = JSON.parse(payloadRaw) as LastfmStatePayload;

		const session = await this.lastfmApiService.getSession(token);
		const account = await this.upsert(payload.userId, 'lastfm', session.username, session.sessionKey);
		this.logger.info(`lastfm account linked: user=${payload.userId} lastfm=${session.username}`);
		return this.toSummary(account);
	}

	//#endregion

	@bindThis
	public async linkListenBrainz(userId: MiUser['id'], token: string): Promise<NowPlayingAccountSummary> {
		const username = await this.listenBrainzApiService.validateToken(token);
		const account = await this.upsert(userId, 'listenbrainz', username, token);
		this.logger.info(`listenbrainz account linked: user=${userId} listenbrainz=${username}`);
		return this.toSummary(account);
	}

	@bindThis
	public async unlink(userId: MiUser['id'], service: MusicServiceAccountService): Promise<boolean> {
		const account = await this.musicServiceAccountsRepository.findOneBy({ userId, service });
		if (account == null) return false;
		await this.musicServiceAccountsRepository.delete(account.id);
		this.logger.info(`account unlinked: user=${userId} service=${service}`);
		return true;
	}

	@bindThis
	public async listAccounts(userId: MiUser['id']): Promise<NowPlayingAccountSummary[]> {
		const accounts = await this.musicServiceAccountsRepository.findBy({ userId });
		return accounts.map(a => this.toSummary(a));
	}

	/**
	 * リンク済アカウントの中から現在再生中のトラックを探す。ListenBrainz を優先し、無ければ Last.fm。
	 * リンクが1件も無い場合、および現在再生中のトラックが無い場合はどちらも null を返す
	 * (リンク有無の判別は呼び出し側で listAccounts を使う)。
	 */
	@bindThis
	public async getCurrent(userId: MiUser['id']): Promise<NowPlayingCurrent | null> {
		const accounts = await this.musicServiceAccountsRepository.findBy({ userId });
		if (accounts.length === 0) return null;

		const listenBrainz = accounts.find(a => a.service === 'listenbrainz');
		if (listenBrainz != null && listenBrainz.serviceUsername != null) {
			const track = await this.listenBrainzApiService.getNowPlaying(listenBrainz.serviceUsername);
			if (track != null) {
				return {
					source: 'listenbrainz',
					title: track.title,
					artist: track.artist,
					album: track.album,
					url: track.url,
					thumbnailUrl: null,
					serviceLabel: track.musicService ?? 'ListenBrainz',
				};
			}
		}

		const lastfm = accounts.find(a => a.service === 'lastfm');
		if (lastfm != null && lastfm.serviceUsername != null) {
			const track = await this.lastfmApiService.getNowPlaying(lastfm.serviceUsername);
			if (track != null) {
				return {
					source: 'lastfm',
					title: track.title,
					artist: track.artist,
					album: track.album,
					url: track.url,
					thumbnailUrl: track.thumbnailUrl,
					serviceLabel: 'Last.fm',
				};
			}
		}

		return null;
	}

	@bindThis
	private async upsert(userId: MiUser['id'], service: MusicServiceAccountService, serviceUsername: string, credential: string): Promise<MiMusicServiceAccount> {
		const existing = await this.musicServiceAccountsRepository.findOneBy({ userId, service });
		if (existing != null) {
			await this.musicServiceAccountsRepository.update(existing.id, { serviceUsername, credential });
			return { ...existing, serviceUsername, credential };
		}
		try {
			return await this.musicServiceAccountsRepository.insertOne(new MiMusicServiceAccount({
				id: this.idService.gen(),
				userId,
				service,
				serviceUsername,
				credential,
				createdAt: new Date(),
			}));
		} catch (err) {
			// Concurrent link for the same (userId, service): the unique index rejected the second
			// insert, so fall back to updating the row that won the race (idempotent link).
			if (!isDuplicateKeyValueError(err)) throw err;
			const winner = await this.musicServiceAccountsRepository.findOneByOrFail({ userId, service });
			await this.musicServiceAccountsRepository.update(winner.id, { serviceUsername, credential });
			return { ...winner, serviceUsername, credential };
		}
	}

	@bindThis
	private toSummary(account: MiMusicServiceAccount): NowPlayingAccountSummary {
		return {
			service: account.service,
			serviceUsername: account.serviceUsername,
			createdAt: account.createdAt,
		};
	}
}
