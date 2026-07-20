/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import cluster from 'node:cluster';
import { Injectable, Inject, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { IsNull, Not } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { ChannelsRepository, FollowingsRepository, LiveChannelsRepository, TwitchAccountsRepository, TwitchStreamsRepository, UsersRepository } from '@/models/_.js';
import { MiTwitchStream } from '@/models/TwitchStream.js';
import type { MiTwitchAccount } from '@/models/TwitchAccount.js';
import type { MiUser } from '@/models/User.js';
import type { Config } from '@/config.js';
import { IdService } from '@/core/IdService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { NoteCreateService } from '@/core/NoteCreateService.js';
import { LiveRecordingService } from '@/core/live/LiveRecordingService.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { TwitchApiService } from './TwitchApiService.js';
import type { TwitchHelixStream } from './TwitchApiService.js';
import { TwitchLoggerService } from './TwitchLoggerService.js';

const DEFAULT_AUTO_POST_TEMPLATE_WITH_TITLE = '「{title}」の配信を開始しました 📡 {url}';
const DEFAULT_AUTO_POST_TEMPLATE_WITHOUT_TITLE = '配信を開始しました 📡 {url}';

// EventSub の取り逃しを自己修復するための全件ポーリング間隔。
// 連携ユーザーが 100 人以下なら Get Streams 1 リクエストで済む。
// EventSub 切断中の取り逃しを早めるため 5 分 → 2 分に短縮 (bsky-fork 独自)。
const POLL_INTERVAL_MS = 2 * 60_000;

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

		@Inject(DI.liveChannelsRepository)
		private liveChannelsRepository: LiveChannelsRepository,

		@Inject(DI.channelsRepository)
		private channelsRepository: ChannelsRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.config)
		private config: Config,

		private idService: IdService,
		private globalEventService: GlobalEventService,
		private notificationService: NotificationService,
		private noteCreateService: NoteCreateService,
		private twitchApiService: TwitchApiService,
		private twitchLoggerService: TwitchLoggerService,
		private liveRecordingService: LiveRecordingService,
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
	 *
	 * 配信チャンネル (live_channel.enabled) が無効なユーザーは、Twitchアカウントの連携
	 * (twitch_account) 自体は保持したまま、検知・通知・チャット中継等の「連携」動作のみを
	 * 停止する (bsky-fork 独自の設計方針: 配信チャンネルが配信行為全体の前提)。ここで
	 * セッション作成/更新を丸ごとスキップすることで、以降の notifyFollowers・チャット中継・
	 * コメント欄 (いずれも isLive な twitch_stream 行の存在を前提に動く) を連鎖的に停止させる。
	 */
	@bindThis
	public async upsertLiveStream(userId: MiUser['id'], stream: TwitchHelixStream): Promise<void> {
		const liveChannel = await this.liveChannelsRepository.findOneBy({ userId });
		if (liveChannel == null || !liveChannel.enabled) {
			this.logger.info(`skip Twitch stream detection (live channel not enabled): user=${userId}`);
			return;
		}

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
	 * OME 配信の検知でライブセッション (source=ome) を find-or-create する (bsky-fork 独自)。
	 * AdmissionWebhooks を使わない構成のため、OmeStreamMonitorService のポーリング
	 * (OME listStreams で publish 中の streamKey を検出) から呼ばれる。
	 * 既に isLive な OME セッションがあれば何もしない (10秒ポーリングに対して冪等)。
	 * 新規作成時のみフォロワーへ配信開始を通知する (upsertLiveStream と同型)。
	 */
	@bindThis
	public async markOmeStreamLive(userId: MiUser['id'], title: string | null): Promise<void> {
		const existing = await this.twitchStreamsRepository.findOneBy({ userId, source: 'ome', isLive: true });
		if (existing != null) return;

		const newStream = new MiTwitchStream({
			id: this.idService.gen(),
			userId,
			// OME セッションは Twitch 由来の識別子を持たない (entity 側で nullable)。
			twitchUserId: null,
			twitchStreamId: null,
			twitchLogin: null,
			source: 'ome',
			isLive: true,
			isPreview: false,
			title: (title ?? '').slice(0, 512),
			startedAt: new Date(),
		});
		await this.twitchStreamsRepository.insertOne(newStream);
		this.logger.info(`ome stream online: user=${userId} "${(title ?? '').slice(0, 40)}"`);
		this.notifyFollowers(userId, newStream).catch(err => {
			this.logger.error(`notifyFollowers failed: ${err instanceof Error ? err.message : err}`);
		});
		this.postAutoStartNote(userId, title).catch(err => {
			this.logger.error(`postAutoStartNote failed: ${err instanceof Error ? err.message : err}`);
		});
	}

	/**
	 * 配信開始検知時の自動ノート投稿 (WI-6, bsky-fork 独自)。live_channel.autoPostNoteEnabled が
	 * ON のユーザーのみ対象。配信開始検知 (markOmeStreamLive) をブロックしないよう
	 * fire-and-forget で呼ばれる想定 (呼び出し側で .catch 済み)。
	 */
	@bindThis
	private async postAutoStartNote(userId: MiUser['id'], title: string | null): Promise<void> {
		const liveChannel = await this.liveChannelsRepository.findOneBy({ userId });
		if (liveChannel == null || !liveChannel.autoPostNoteEnabled) return;

		if (liveChannel.channelId == null) {
			this.logger.warn(`postAutoStartNote: user=${userId} has autoPostNoteEnabled but no linked channel, skipping`);
			return;
		}
		const channel = await this.channelsRepository.findOneBy({ id: liveChannel.channelId });
		if (channel == null) {
			this.logger.warn(`postAutoStartNote: user=${userId} linked channel ${liveChannel.channelId} not found, skipping`);
			return;
		}

		const user = await this.usersRepository.findOneBy({ id: userId });
		if (user == null) return;

		const url = `${this.config.url}/live/${user.username}`;
		const template = liveChannel.autoPostNoteTemplate ?? (
			title != null && title !== ''
				? DEFAULT_AUTO_POST_TEMPLATE_WITH_TITLE
				: DEFAULT_AUTO_POST_TEMPLATE_WITHOUT_TITLE
		);
		const text = template
			.replaceAll('{title}', title ?? '')
			.replaceAll('{url}', url)
			.replaceAll('{channelName}', liveChannel.name ?? channel.name ?? '');

		await this.noteCreateService.create(user, {
			text,
			channel,
		});
		this.logger.info(`auto-posted stream-start note: user=${userId} channel=${channel.id}`);
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
	 * OME 配信の終了を反映する (markOmeStreamLive と対称、bsky-fork 独自)。
	 * cutStream (ビットレート超過切断) / detectEndedStreams (10s poll / 2min reconcile) /
	 * OmeAdmissionService.handleClosing (AdmissionWebhook closing) / decideOpening
	 * (再接続時の前セッション閉鎖) の全経路がこれを呼ぶ単一の出口。update + publish は
	 * 既存3(4)箇所と同一挙動のまま、末尾で録画パイプラインを fire-and-forget 起動する。
	 */
	@bindThis
	public async markOmeStreamEnded(streamId: MiTwitchStream['id']): Promise<void> {
		await this.twitchStreamsRepository.update(streamId, { isLive: false, endedAt: new Date() });
		this.globalEventService.publishTwitchLiveStream(streamId, 'streamEnded', {});

		const stream = await this.twitchStreamsRepository.findOneBy({ id: streamId });
		if (stream != null) {
			this.liveRecordingService.triggerRecording(stream);
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

		// DB 上 isLive のまま Helix 側で配信していないものを offline に倒す (Twitch 由来のみ)
		const staleLive = await this.twitchStreamsRepository.findBy({ isLive: true, source: 'twitch' });
		for (const s of staleLive) {
			if (s.twitchUserId != null && !liveTwitchIds.has(s.twitchUserId)) {
				await this.markOffline(s.twitchUserId);
			}
		}
	}

	//#region クエリ (API エンドポイント / pack から使う)

	@bindThis
	public async getLiveStreamByUserId(userId: MiUser['id']): Promise<MiTwitchStream | null> {
		return await this.twitchStreamsRepository.findOneBy({ userId, isLive: true });
	}

	/**
	 * 指定ユーザーの全ライブセッションを source に関わらず取得する (WI-2.8)。
	 */
	@bindThis
	public async getAllLiveStreamsByUserId(userId: MiUser['id']): Promise<MiTwitchStream[]> {
		return await this.twitchStreamsRepository.findBy({ userId, isLive: true });
	}

	@bindThis
	public async getAllLiveStreams(): Promise<MiTwitchStream[]> {
		return await this.twitchStreamsRepository.find({
			where: { isLive: true },
			order: { viewerCount: 'DESC' },
		});
	}

	/**
	 * 配信アーカイブ (Google Drive) 表示用の過去 OME セッション取得 (BE-2, bsky-fork 独自)。
	 * recordingStatus='none' (録画対象外/未処理) は一覧上ノイズになるため常に除外する。
	 * 'failed' を一般視聴者に見せるかどうかは呼び出し側 (show.ts、オーナー判定後) の責務とする。
	 */
	@bindThis
	public async getRecentEndedOmeStreamsByUserId(userId: MiUser['id'], limit = 20): Promise<MiTwitchStream[]> {
		return await this.twitchStreamsRepository.find({
			where: {
				userId,
				source: 'ome',
				isLive: false,
				endedAt: Not(IsNull()),
				recordingStatus: Not('none'),
			},
			order: { endedAt: 'DESC' },
			take: limit,
		});
	}

	/**
	 * 配信者が配信開始前にチャット動作確認を行うためのプレビュー行を find-or-create する
	 * (bsky-fork 独自)。isLive は常に false のままにする (isLive 基準の live 判定クエリ
	 * (getLiveStreamByUserId / getAllLiveStreams 等) から自動的に除外されるため)。
	 * 配信者 1 人につき最大 1 行 (migration の partial unique index で担保)。
	 * TwitchAccount の存在確認 (notLinked エラー) は呼び出し側 (endpoint) の責務とする。
	 */
	@bindThis
	public async findOrCreatePreviewStream(account: MiTwitchAccount): Promise<MiTwitchStream> {
		const existing = await this.twitchStreamsRepository.findOneBy({ userId: account.userId!, isPreview: true });
		if (existing != null) return existing;

		const newStream = new MiTwitchStream({
			id: this.idService.gen(),
			userId: account.userId!,
			twitchUserId: account.twitchUserId,
			// twitchStreamId は unique index があるため、実際の Twitch セッション ID と衝突しない値にする
			twitchStreamId: `preview-${account.userId}`,
			twitchLogin: account.twitchLogin,
			isLive: false,
			isPreview: true,
			title: '(Preview)',
			startedAt: new Date(),
		});
		await this.twitchStreamsRepository.insertOne(newStream);
		return newStream;
	}

	//#endregion
}
