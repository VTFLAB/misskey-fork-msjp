/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import cluster from 'node:cluster';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Inject, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { TwitchAccountsRepository } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { TwitchApiService } from './TwitchApiService.js';
import type { TwitchEventSubSubscription } from './TwitchApiService.js';
import { TwitchChatRelayService } from './TwitchChatRelayService.js';
import { TwitchLoggerService } from './TwitchLoggerService.js';
import { TwitchStreamService } from './TwitchStreamService.js';

// Twitch EventSub (webhook transport)。
//
// ## WebSocket → webhook 移行 (2026-08-01)
//
// 従来は「bot セッション + 連携配信者ごとの WebSocket セッション」を常駐させていたが、
// 次の構造的な弱点があった:
//
// - WebSocket subscription はセッションと運命を共にするため、Twitch 起点の
//   session_reconnect・切断・プロセス再起動のたびに購読の張り直し窓が生じ、
//   その間の stream.online/offline を取り逃す (2 分ポーリングまで検知が遅延する)
// - stream.online/offline の購読が配信者本人のユーザートークンに依存し、
//   トークン失効中はその配信者の検知がポーリング頼みに縮退する
// - 接続数・購読作成回数が連携人数に比例して増える (N 人 = N+1 本の常駐 WS)
//
// webhook transport はこれらをまとめて解消する:
//
// - subscription は Twitch 側に永続化され、再起動・再接続の概念自体が無い
// - 全 subscription を app access token で作成するため、ユーザートークンの
//   健全性と無関係に stream.online/offline が届く (連携配信者は client に
//   認可済みのためコスト 0。上限も webhook は max_total_cost=10,000)
// - サーバー側の受け口は POST {url}/twitch/eventsub の 1 エンドポイントのみで、
//   連携人数が増えても常駐リソースが増えない
//
// channel.chat.message は「bot として読む」購読 (condition.user_id = bot)。webhook +
// app access token では bot が user:read:chat + user:bot を、配信者が channel:bot を
// client に認可している必要がある (いずれも既存の連携フローで付与済みのため再連携不要)。
//
// 取り逃しの最終防衛線として TwitchStreamService.pollAll (2 分間隔) は従来どおり残す。
const RECONCILE_INTERVAL_MS = 60_000;
// Twitch は通知を最大 10 分リトライするため、重複排除キーはそれより長く保持する
const SEEN_MESSAGE_TTL_SEC = 15 * 60;
// リプレイ攻撃対策: メッセージタイムスタンプがこの秒数より古い通知は拒否する (公式推奨は 10 分)
const MESSAGE_MAX_AGE_MS = 10 * 60 * 1000;
const SEEN_MESSAGE_REDIS_PREFIX = 'twitch:eventsub:seen:';
// subscription 復旧直後の pollAll 自己修復のデバウンス (復旧が複数件同時に起きても 1 回に畳む)
const POLL_SELF_HEAL_DEBOUNCE_MS = 30_000;

// 保持してよい subscription status。それ以外 (webhook_callback_verification_failed /
// notification_failures_exceeded / authorization_revoked 等) は削除して作り直す
const HEALTHY_STATUSES = new Set(['enabled', 'webhook_callback_verification_pending']);

type DesiredSubscription = {
	type: string;
	version: string;
	condition: Record<string, string>;
};

export type EventSubNotificationBody = {
	subscription: {
		id: string;
		type: string;
		status?: string;
		condition?: Record<string, string>;
	};
	event?: Record<string, unknown>;
	challenge?: string;
};

@Injectable()
export class TwitchEventSubService implements OnModuleInit, OnApplicationShutdown {
	private logger: Logger;
	private stopped = false;
	private reconcileTimer: NodeJS.Timeout | null = null;
	private reconciling = false;
	private lastSelfHealPollAt = 0;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.twitchAccountsRepository)
		private twitchAccountsRepository: TwitchAccountsRepository,

		private twitchApiService: TwitchApiService,
		private twitchStreamService: TwitchStreamService,
		private twitchChatRelayService: TwitchChatRelayService,
		private twitchLoggerService: TwitchLoggerService,
	) {
		this.logger = this.twitchLoggerService.child('eventsub');
	}

	/** webhook callback URL。TwitchServerService の POST /twitch/eventsub と一致させる。 */
	public get callbackUrl(): string {
		return `${this.config.url}/twitch/eventsub`;
	}

	/**
	 * webhook transport の HMAC secret。専用の設定キーを増やさず clientSecret から導出する
	 * (clientSecret 自体を transport に渡さないための一段の間接化。clientSecret を
	 * ローテーションした場合は reconcile が旧 secret の subscription を検知できないため、
	 * 署名不一致 → notification_failures_exceeded → 自動作り直しの経路で収束する)。
	 */
	private get webhookSecret(): string {
		if (this.config.twitch == null) throw new Error('Twitch integration is not configured.');
		return createHmac('sha256', this.config.twitch.clientSecret)
			.update('eventsub-webhook-transport')
			.digest('hex');
	}

	async onModuleInit(): Promise<void> {
		if (process.env.TWITCH_DISABLE_EVENTSUB === '1') {
			this.logger.info('disabled via TWITCH_DISABLE_EVENTSUB env');
			return;
		}
		if (!this.twitchApiService.isEnabled) return;
		// reconcile は全プロセスで走らせる必要がない (webhook の受信自体は全プロセスで行う)
		if (!cluster.isPrimary) return;
		this.start();
	}

	async onApplicationShutdown(): Promise<void> {
		this.stop();
	}

	@bindThis
	public start(): void {
		this.stopped = false;
		this.reconcileTimer = setInterval(() => {
			this.reconcile().catch(e => this.logger.error(`reconcile tick failed: ${e instanceof Error ? e.message : e}`));
		}, RECONCILE_INTERVAL_MS);
		this.reconcile().catch(e => this.logger.error(`initial reconcile failed: ${e instanceof Error ? e.message : e}`));
	}

	@bindThis
	public stop(): void {
		this.stopped = true;
		if (this.reconcileTimer != null) {
			clearInterval(this.reconcileTimer);
			this.reconcileTimer = null;
		}
	}

	/**
	 * あるべき subscription 集合 (連携アカウント由来) と Twitch 側の現状を突合し、
	 * 不足分の作成・不要/不健全分の削除を行う。60 秒間隔の定期 tick で呼ばれる
	 * (連携/解除の反映、および失敗した subscription の自動復旧)。
	 *
	 * client ID を共有する別環境 (開発環境など) の subscription を壊さないよう、
	 * 削除対象は「callback がこのサーバーの URL と一致する webhook subscription」に限定する。
	 */
	@bindThis
	public async reconcile(): Promise<void> {
		if (this.stopped) return;
		if (this.reconciling) return; // Helix 側が遅い場合に tick が重ならないようにする
		this.reconciling = true;
		try {
			const desired = await this.buildDesiredSubscriptions();
			const desiredByKey = new Map(desired.map(d => [this.subscriptionKey(d.type, d.condition), d]));

			const existing = (await this.twitchApiService.listEventSubSubscriptions())
				.filter(s => s.transport.method === 'webhook' && s.transport.callback === this.callbackUrl);

			const present = new Set<string>();
			for (const sub of existing) {
				const key = this.subscriptionKey(sub.type, sub.condition);
				const wanted = desiredByKey.has(key);
				if (wanted && HEALTHY_STATUSES.has(sub.status) && !present.has(key)) {
					present.add(key);
					continue;
				}
				// 不要 (連携解除済み)・不健全 (検証失敗/配送失敗/取り消し)・重複はすべて削除。
				// 不健全だった分は下の作成ループで即座に作り直される
				await this.deleteSubscription(sub);
			}

			let createdOnlineOffline = 0;
			for (const [key, d] of desiredByKey) {
				if (present.has(key)) continue;
				const ok = await this.createSubscription(d);
				if (ok && (d.type === 'stream.online' || d.type === 'stream.offline')) {
					createdOnlineOffline += 1;
				}
			}

			// stream.online/offline の subscription が欠けていた期間の状態変化を取りこぼしている
			// 可能性があるため、購読が (再) 作成されたら Helix Get Streams で即時に自己修復する
			if (createdOnlineOffline > 0) {
				this.selfHealPoll();
			}
		} finally {
			this.reconciling = false;
		}
	}

	@bindThis
	private async buildDesiredSubscriptions(): Promise<DesiredSubscription[]> {
		const accounts = await this.twitchAccountsRepository.find();
		const streamers = accounts.filter(a => !a.isBot && a.userId != null);
		const bot = accounts.find(a => a.isBot) ?? null;

		const desired: DesiredSubscription[] = [];
		for (const streamer of streamers) {
			desired.push(
				{ type: 'stream.online', version: '1', condition: { broadcaster_user_id: streamer.twitchUserId } },
				{ type: 'stream.offline', version: '1', condition: { broadcaster_user_id: streamer.twitchUserId } },
			);
			if (bot != null) {
				desired.push({
					type: 'channel.chat.message',
					version: '1',
					condition: { broadcaster_user_id: streamer.twitchUserId, user_id: bot.twitchUserId },
				});
			}
		}
		return desired;
	}

	// condition は order 不定の可能性があるためキーをソートして正規化する
	@bindThis
	private subscriptionKey(type: string, condition: Record<string, string> | undefined): string {
		const cond = condition ?? {};
		const norm = Object.keys(cond).sort().map(k => `${k}=${cond[k]}`).join('&');
		return `${type}|${norm}`;
	}

	@bindThis
	private async createSubscription(d: DesiredSubscription): Promise<boolean> {
		try {
			await this.twitchApiService.helixPost('/helix/eventsub/subscriptions', {
				type: d.type,
				version: d.version,
				condition: d.condition,
				transport: {
					method: 'webhook',
					callback: this.callbackUrl,
					secret: this.webhookSecret,
				},
			});
			this.logger.info(`subscription created: ${d.type} condition=${JSON.stringify(d.condition)}`);
			return true;
		} catch (e) {
			// 409 (既に存在) は並行作成の競合で起こりうる正常系
			this.logger.warn(`subscription create failed (${d.type}, condition=${JSON.stringify(d.condition)}): ${e instanceof Error ? e.message : e}`);
			return false;
		}
	}

	@bindThis
	private async deleteSubscription(sub: TwitchEventSubSubscription): Promise<void> {
		try {
			await this.twitchApiService.helixDelete('/helix/eventsub/subscriptions', { id: sub.id });
			this.logger.info(`subscription deleted: ${sub.type} status=${sub.status} condition=${JSON.stringify(sub.condition)}`);
		} catch (e) {
			this.logger.warn(`subscription delete failed (id=${sub.id}): ${e instanceof Error ? e.message : e}`);
		}
	}

	/**
	 * subscription 復旧時に EventSub が取り逃した配信開始/終了を即座に自己修復する。
	 * pollAll は Helix Get Streams を叩いて DB と同期するため、購読が欠けていた間の
	 * 状態変化が 2 分のポーリング間隔を待たずに反映される。
	 */
	@bindThis
	private selfHealPoll(): void {
		const now = Date.now();
		if (now - this.lastSelfHealPollAt < POLL_SELF_HEAL_DEBOUNCE_MS) return;
		this.lastSelfHealPollAt = now;
		this.twitchStreamService.pollAll().catch(e => {
			this.logger.error(`post-recovery pollAll failed: ${e instanceof Error ? e.message : e}`);
		});
	}

	//#region webhook 受信処理 (TwitchServerService から呼ばれる。全プロセスで動作する)

	/**
	 * Twitch-Eventsub-Message-Signature (sha256=<hex>) の検証。
	 * HMAC の入力は messageId + timestamp + rawBody の連結 (公式仕様)。
	 */
	@bindThis
	public verifySignature(messageId: string, timestamp: string, rawBody: string | Buffer, signatureHeader: string): boolean {
		const hmac = createHmac('sha256', this.webhookSecret)
			.update(messageId)
			.update(timestamp)
			.update(rawBody)
			.digest('hex');
		const expected = Buffer.from(`sha256=${hmac}`, 'utf8');
		const actual = Buffer.from(signatureHeader, 'utf8');
		if (expected.length !== actual.length) return false;
		return timingSafeEqual(expected, actual);
	}

	/** リプレイ攻撃対策: 古すぎるタイムスタンプの通知を拒否する。 */
	@bindThis
	public isTimestampStale(timestamp: string): boolean {
		const t = Date.parse(timestamp);
		if (Number.isNaN(t)) return true;
		return Math.abs(Date.now() - t) > MESSAGE_MAX_AGE_MS;
	}

	/**
	 * Twitch は at-least-once 配送 (リトライあり) なので message_id で重複排除する。
	 * webhook は任意のワーカープロセスに届くため、プロセスローカルではなく Redis で共有する。
	 * @returns true なら初見 (処理してよい)、false なら処理済み
	 */
	@bindThis
	public async markMessageSeen(messageId: string): Promise<boolean> {
		const res = await this.redisClient.set(
			`${SEEN_MESSAGE_REDIS_PREFIX}${messageId}`, '1', 'EX', SEEN_MESSAGE_TTL_SEC, 'NX',
		);
		return res === 'OK';
	}

	@bindThis
	public async handleNotification(body: EventSubNotificationBody): Promise<void> {
		const type = body.subscription.type;
		const event = body.event;
		if (event == null) return;

		switch (type) {
			case 'stream.online': {
				if (event['type'] !== 'live') break; // rerun 等は対象外
				const twitchUserId = String(event['broadcaster_user_id']);
				await this.twitchStreamService.handleStreamOnline(twitchUserId);
				break;
			}
			case 'stream.offline': {
				const twitchUserId = String(event['broadcaster_user_id']);
				await this.twitchStreamService.markOffline(twitchUserId);
				break;
			}
			case 'channel.chat.message': {
				await this.twitchChatRelayService.handleChatMessageEvent(event as Parameters<TwitchChatRelayService['handleChatMessageEvent']>[0]);
				break;
			}
			default:
				this.logger.debug(`unhandled notification type: ${type}`);
		}
	}

	/**
	 * revocation の反映。削除・作り直しは primary の定期 reconcile に任せ、ここではログのみ残す
	 * (revocation は任意のワーカープロセスに届くため)。
	 */
	@bindThis
	public handleRevocation(body: EventSubNotificationBody): void {
		this.logger.warn(`subscription revoked: type=${body.subscription.type} status=${body.subscription.status} condition=${JSON.stringify(body.subscription.condition)}`);
	}

	//#endregion
}
