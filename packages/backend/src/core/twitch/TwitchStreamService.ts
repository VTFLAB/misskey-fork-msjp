/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import cluster from 'node:cluster';
import { Injectable, Inject, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { FollowingsRepository, TwitchAccountsRepository, TwitchStreamsRepository } from '@/models/_.js';
import { MiTwitchStream } from '@/models/TwitchStream.js';
import type { MiUser } from '@/models/User.js';
import { IdService } from '@/core/IdService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { TwitchApiService } from './TwitchApiService.js';
import type { TwitchHelixStream } from './TwitchApiService.js';
import { TwitchLoggerService } from './TwitchLoggerService.js';

// EventSub の取り逃しを自己修復するための全件ポーリング間隔。
// 連携ユーザーが 100 人以下なら Get Streams 1 リクエストで済む。
const POLL_INTERVAL_MS = 5 * 60_000;

@Injectable()
export class TwitchStreamService implements OnModuleInit, OnApplicationShutdown {
	private logger: Logger;
	private pollTimer: NodeJS.Timeout | null = null;

	constructor(
		@Inject(DI.twitchAccountsRepository)
		private twitchAccountsRepository: TwitchAccountsRepository,

		@Inject(DI.twitchStreamsRepository)
		private twitchStreamsRepository: TwitchStreamsRepository,

		@Inject(DI.followingsRepository)
		private followingsRepository: FollowingsRepository,

		private idService: IdService,
		private globalEventService: GlobalEventService,
		private notificationService: NotificationService,
		private twitchApiService: TwitchApiService,
		private twitchLoggerService: TwitchLoggerService,
	) {
		this.logger = this.twitchLoggerService.child('stream');
	}

	async onModuleInit(): Promise<void> {
		if (!this.twitchApiService.isEnabled) return;
		if (process.env.TWITCH_DISABLE_POLLING === '1') {
			this.logger.info('polling disabled via TWITCH_DISABLE_POLLING env');
			return;
		}
		// AtpJetstreamService と同じ理由で primary process のみで走らせる
		// (disableClustering=true の場合は main が primary を兼ねる)。
		if (!cluster.isPrimary) return;

		this.pollTimer = setInterval(() => {
			this.pollAll().catch(err => {
				this.logger.error(`poll failed: ${err instanceof Error ? err.message : err}`);
			});
		}, POLL_INTERVAL_MS);
		// 起動直後にも一度実行して再起動中の状態変化を取り込む
		this.pollAll().catch(err => {
			this.logger.error(`initial poll failed: ${err instanceof Error ? err.message : err}`);
		});
	}

	async onApplicationShutdown(): Promise<void> {
		if (this.pollTimer != null) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
	}

	/**
	 * stream.online イベント / ポーリングで検知した配信中ストリームを upsert する。
	 */
	@bindThis
	public async upsertLiveStream(userId: MiUser['id'], stream: TwitchHelixStream): Promise<void> {
		const existing = await this.twitchStreamsRepository.findOneBy({ twitchStreamId: stream.id });
		if (existing != null) {
			await this.twitchStreamsRepository.update(existing.id, {
				isLive: true,
				twitchLogin: stream.user_login,
				title: stream.title.slice(0, 512),
				gameName: stream.game_name === '' ? null : stream.game_name.slice(0, 256),
				thumbnailUrl: stream.thumbnail_url === '' ? null : stream.thumbnail_url.slice(0, 1024),
				viewerCount: stream.viewer_count,
				endedAt: null,
			});
		} else {
			const newStream = new MiTwitchStream({
				id: this.idService.gen(),
				userId,
				twitchUserId: stream.user_id,
				twitchStreamId: stream.id,
				twitchLogin: stream.user_login,
				isLive: true,
				title: stream.title.slice(0, 512),
				gameName: stream.game_name === '' ? null : stream.game_name.slice(0, 256),
				thumbnailUrl: stream.thumbnail_url === '' ? null : stream.thumbnail_url.slice(0, 1024),
				viewerCount: stream.viewer_count,
				startedAt: new Date(stream.started_at),
			});
			await this.twitchStreamsRepository.insertOne(newStream);
			this.logger.info(`stream online: user=${userId} twitch=@${stream.user_login} "${stream.title.slice(0, 40)}"`);
			this.notifyFollowers(userId, newStream).catch(err => {
				this.logger.error(`notifyFollowers failed: ${err instanceof Error ? err.message : err}`);
			});
		}
	}

	/**
	 * 配信開始をフォロー中の (ローカル) ユーザーに通知する (bsky-fork 独自)。
	 * 通知単位で受信設定 (全通知種別に共通の never/all 切り替え) を尊重するため、
	 * フォロワー一覧を自前で解決したうえで1件ずつ NotificationService.createNotification を呼ぶ
	 * (EarthquakeAlertService の全ユーザー配信と同じ fire-and-forget パターン)。
	 */
	@bindThis
	private async notifyFollowers(streamerUserId: MiUser['id'], stream: MiTwitchStream): Promise<void> {
		const followings = await this.followingsRepository.find({
			where: {
				followeeId: streamerUserId,
				followerHost: IsNull(),
			},
			select: {
				followerId: true,
			},
		});

		for (const following of followings) {
			this.notificationService.createNotification(following.followerId, 'twitchLiveStreamStarted', {
				streamId: stream.id,
				title: stream.title,
			}, streamerUserId);
		}
	}

	/**
	 * stream.offline イベント / ポーリングで検知した配信終了を反映する。
	 */
	@bindThis
	public async markOffline(twitchUserId: string): Promise<void> {
		const live = await this.twitchStreamsRepository.findBy({ twitchUserId, isLive: true });
		if (live.length === 0) return;
		for (const s of live) {
			await this.twitchStreamsRepository.update(s.id, {
				isLive: false,
				endedAt: new Date(),
			});
			this.globalEventService.publishTwitchLiveStream(s.id, 'streamEnded', {});
		}
		this.logger.info(`stream offline: twitchUserId=${twitchUserId}`);
	}

	/**
	 * stream.online イベント受信時のハンドラ。詳細 (タイトル等) は Helix から取得する。
	 * イベント直後は Get Streams にまだ反映されていないことがあるため、その場合は
	 * 最小限の情報で登録し、次回ポーリングで補完する。
	 */
	@bindThis
	public async handleStreamOnline(twitchUserId: string): Promise<void> {
		const account = await this.twitchAccountsRepository.findOneBy({ twitchUserId });
		if (account == null || account.userId == null) return;

		const streams = await this.twitchApiService.getStreamsByUserIds([twitchUserId]).catch(() => []);
		const stream = streams[0];
		if (stream != null) {
			await this.upsertLiveStream(account.userId, stream);
		} else {
			this.logger.info(`stream.online received but Get Streams is not yet populated (twitchUserId=${twitchUserId}); will be reconciled by polling`);
		}
	}

	/**
	 * 全連携ユーザーの配信状態を Helix Get Streams で照合する (EventSub 欠落の自己修復)。
	 */
	@bindThis
	public async pollAll(): Promise<void> {
		if (!this.twitchApiService.isEnabled) return;

		const accounts = (await this.twitchAccountsRepository.find()).filter(a => !a.isBot && a.userId != null);
		if (accounts.length === 0) return;

		const byTwitchId = new Map(accounts.map(a => [a.twitchUserId, a]));
		const streams: TwitchHelixStream[] = [];
		const ids = [...byTwitchId.keys()];
		for (let i = 0; i < ids.length; i += 100) {
			streams.push(...await this.twitchApiService.getStreamsByUserIds(ids.slice(i, i + 100)));
		}

		const liveTwitchIds = new Set(streams.map(s => s.user_id));

		for (const stream of streams) {
			const account = byTwitchId.get(stream.user_id);
			if (account?.userId == null) continue;
			await this.upsertLiveStream(account.userId, stream);
		}

		// DB 上 isLive のまま Helix 側で配信していないものを offline に倒す
		const staleLive = await this.twitchStreamsRepository.findBy({ isLive: true });
		for (const s of staleLive) {
			if (!liveTwitchIds.has(s.twitchUserId)) {
				await this.markOffline(s.twitchUserId);
			}
		}
	}

	//#region クエリ (API エンドポイント / pack から使う)

	@bindThis
	public async getLiveStreamByUserId(userId: MiUser['id']): Promise<MiTwitchStream | null> {
		return await this.twitchStreamsRepository.findOneBy({ userId, isLive: true });
	}

	@bindThis
	public async getAllLiveStreams(): Promise<MiTwitchStream[]> {
		return await this.twitchStreamsRepository.find({
			where: { isLive: true },
			order: { viewerCount: 'DESC' },
		});
	}

	//#endregion
}
