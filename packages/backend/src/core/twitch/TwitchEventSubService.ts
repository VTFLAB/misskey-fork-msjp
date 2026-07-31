/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import cluster from 'node:cluster';
import { Injectable, Inject, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { TwitchAccountsRepository } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { TwitchApiService } from './TwitchApiService.js';
import { TwitchChatRelayService } from './TwitchChatRelayService.js';
import { TwitchLoggerService } from './TwitchLoggerService.js';
import { TwitchOAuthService } from './TwitchOAuthService.js';
import { TwitchStreamService } from './TwitchStreamService.js';

// Twitch EventSub (WebSocket transport)。AtpJetstreamService と同じ常駐パターン:
// primary process のみで起動し、watchdog + 指数バックオフ再接続で自己回復する。
// subscription は WebSocket セッションと共に消えるため、welcome の度に張り直す。
//
// ## マルチセッション構成 (2026-07-31)
//
// EventSub WebSocket の上限 (max_total_cost=10) は「client ID + user ID (トークン所有者)
// のタプルごと」に適用される (公式 docs "The following limits apply per user token")。
// 従来の「bot トークン 1 セッションで全 broadcaster の online/offline/chat を購読」方式は
// stream.online/offline がコスト 1×2×人数 で消費され、連携配信者 6 人以上で 429
// (total cost exceeded) になっていた。これを次の構成に分離する:
//
// - bot セッション (bot トークン): 全 broadcaster の channel.chat.message のみ。
//   condition の user_id (chatter 視点) = bot = トークン所有者なのでコスト 0。
// - 配信者セッション (本人トークン、連携配信者ごとに 1 本): 自分の stream.online/offline。
//   broadcaster = トークン所有者なのでコスト 0。scope 不要のため既存の連携 (channel:bot)
//   トークンのままで動く (再連携不要)。
//
// これで全 subscription がコスト 0 になり、連携人数に上限が生じない
// (WebSocket 接続数上限 3 も「トークン所有者ごと」なので各 1 本の本構成は問題にならない)。
// 配信者トークンが失効している場合はそのセッションだけが落ち、既存の 2 分ポーリングが
// フォールバックとして配信検知を続ける (従来と同じ縮退挙動)。
const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';
const KEEPALIVE_TIMEOUT_SEC = 30;
const ACCOUNT_REFRESH_INTERVAL_MS = 60_000;
const HEARTBEAT_CHECK_INTERVAL_MS = 15_000;
// keepalive が 30 秒間隔なので、その 3 倍無音なら silent-death と判定
const HEARTBEAT_TIMEOUT_MS = KEEPALIVE_TIMEOUT_SEC * 3 * 1000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const CONNECT_TIMEOUT_MS = 20_000;
const SEEN_MESSAGE_IDS_MAX = 1000;
// welcome 直後の pollAll 自己修復のデバウンス (起動時に全セッションが一斉に welcome を
// 受けるため、セッション数ぶん pollAll が連打されるのを防ぐ)
const POLL_SELF_HEAL_DEBOUNCE_MS = 30_000;

type EventSubMessage = {
	metadata: {
		message_id: string;
		message_type: 'session_welcome' | 'session_keepalive' | 'session_reconnect' | 'notification' | 'revocation';
		subscription_type?: string;
	};
	payload: {
		session?: {
			id: string;
			keepalive_timeout_seconds?: number;
			reconnect_url?: string;
		};
		subscription?: {
			id: string;
			type: string;
			status?: string;
			condition?: Record<string, string>;
		};
		event?: Record<string, unknown>;
	};
};

type SubscriptionRequest = {
	type: string;
	version: string;
	condition: Record<string, string>;
};

type SessionDelegate = {
	/** セッションの subscription 作成に使う user access token (失効時 null → セッション停止) */
	getToken(): Promise<string | null>;
	/** このセッションで張る subscription 一覧 (対象消滅時 null → セッション停止) */
	buildSubscriptions(): Promise<SubscriptionRequest[] | null>;
	onNotification(msg: EventSubMessage): Promise<void>;
	/** welcome 受信時の自己修復フック (デバウンスは呼び出し側で行う) */
	onWelcome(): void;
	helixPost: TwitchApiService['helixPost'];
};

/**
 * EventSub WebSocket 1 本ぶんの状態機械。接続・welcome 後の subscription 作成・
 * keepalive watchdog・指数バックオフ再接続を自己完結で持つ。
 * どのトークンで何を購読するかは delegate (TwitchEventSubService 側) が決める。
 */
class EventSubSession {
	private ws: WebSocket | null = null;
	private sessionId: string | null = null;
	private stopped = false;
	private connecting = false;
	private suppressNextReconnect = false;
	private reconnectAttempt = 0;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private connectTimer: NodeJS.Timeout | null = null;
	private lastMessageAt: number | null = null;
	private seenMessageIds = new Set<string>();

	constructor(
		public readonly key: string,
		private logger: Logger,
		private delegate: SessionDelegate,
	) {}

	public get isDisconnected(): boolean {
		return this.ws == null && !this.connecting && this.reconnectTimer == null;
	}

	public start(): void {
		this.stopped = false;
		this.connect().catch(e => this.logger.error(`[${this.key}] initial connect failed: ${e instanceof Error ? e.message : e}`));
	}

	public stop(): void {
		this.stopped = true;
		if (this.reconnectTimer != null) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.clearConnectTimer();
		this.closeWs('shutdown');
	}

	/** 購読対象が変化した際に呼ぶ。切断して張り直す (subscription はセッションと共に消えるため)。 */
	public restart(): void {
		if (this.ws != null) {
			this.suppressNextReconnect = true;
			this.closeWs('targets-changed');
		}
		this.reconnectAttempt = 0;
		this.connect().catch(e => this.logger.error(`[${this.key}] restart connect failed: ${e instanceof Error ? e.message : e}`));
	}

	public reviveIfDisconnected(): void {
		if (!this.isDisconnected) return;
		this.reconnectAttempt = 0;
		this.connect().catch(e => this.logger.error(`[${this.key}] revive connect failed: ${e instanceof Error ? e.message : e}`));
	}

	public heartbeatCheck(): void {
		if (this.ws == null) return;
		if (this.ws.readyState !== WebSocket.OPEN) return;
		if (this.lastMessageAt == null) return;
		const idleMs = Date.now() - this.lastMessageAt;
		if (idleMs > HEARTBEAT_TIMEOUT_MS) {
			this.logger.warn(`[${this.key}] heartbeat watchdog: no EventSub messages for ${Math.round(idleMs / 1000)}s; forcing reconnect`);
			this.closeWs('heartbeat-timeout');
			this.scheduleReconnect();
		}
	}

	private async connect(url?: string): Promise<void> {
		if (this.stopped) return;
		if (this.connecting) return;

		this.connecting = true;
		const wsUrl = url ?? `${EVENTSUB_URL}?keepalive_timeout_seconds=${KEEPALIVE_TIMEOUT_SEC}`;
		this.logger.info(`[${this.key}] connecting to EventSub`);

		let ws: WebSocket;
		try {
			ws = new WebSocket(wsUrl);
		} catch (e) {
			this.connecting = false;
			this.logger.error(`[${this.key}] WebSocket construction failed: ${e instanceof Error ? e.message : e}`);
			this.scheduleReconnect();
			return;
		}

		ws.addEventListener('open', () => {
			if (this.ws !== ws) return;
			this.connecting = false;
			this.clearConnectTimer();
			this.reconnectAttempt = 0;
			this.lastMessageAt = Date.now();
			// subscription 作成は session_welcome 受信後 (session_id が必要)
		});
		ws.addEventListener('message', (event: MessageEvent) => {
			if (this.ws !== ws) return;
			this.handleMessage(event.data).catch(e => {
				this.logger.error(`[${this.key}] message handling failed: ${e instanceof Error ? (e.stack ?? e.message) : e}`);
			});
		});
		ws.addEventListener('error', (event) => {
			const msg = (event as Event & { message?: string }).message ?? '(no message)';
			this.logger.warn(`[${this.key}] EventSub WS error: ${msg}${this.ws === ws ? '' : ' (stale)'}`);
		});
		ws.addEventListener('close', (event) => {
			const stale = this.ws !== ws;
			this.logger.warn(`[${this.key}] EventSub WS closed (code=${event.code}, reason="${event.reason}"${stale ? ', stale' : ''})`);
			if (stale) return;
			this.connecting = false;
			this.ws = null;
			this.sessionId = null;
			this.clearConnectTimer();
			if (this.suppressNextReconnect) {
				this.suppressNextReconnect = false;
				return;
			}
			this.scheduleReconnect();
		});

		this.ws = ws;

		this.clearConnectTimer();
		this.connectTimer = setTimeout(() => {
			this.connectTimer = null;
			if (this.ws !== ws) return;
			if (ws.readyState === WebSocket.OPEN) return;
			this.logger.warn(`[${this.key}] connect watchdog: WS stuck (readyState=${ws.readyState}); forcing reconnect`);
			this.closeWs('connect-timeout');
			this.scheduleReconnect();
		}, CONNECT_TIMEOUT_MS);
	}

	private async handleMessage(data: unknown): Promise<void> {
		if (typeof data !== 'string') return;
		this.lastMessageAt = Date.now();

		let msg: EventSubMessage;
		try {
			msg = JSON.parse(data) as EventSubMessage;
		} catch (e) {
			this.logger.warn(`[${this.key}] malformed EventSub message: ${e instanceof Error ? e.message : e}`);
			return;
		}

		// Twitch は at-least-once 配送なので message_id で重複排除する
		const messageId = msg.metadata.message_id;
		if (this.seenMessageIds.has(messageId)) return;
		this.seenMessageIds.add(messageId);
		if (this.seenMessageIds.size > SEEN_MESSAGE_IDS_MAX) {
			const first = this.seenMessageIds.values().next().value;
			if (first != null) this.seenMessageIds.delete(first);
		}

		switch (msg.metadata.message_type) {
			case 'session_welcome': {
				this.sessionId = msg.payload.session?.id ?? null;
				this.logger.info(`[${this.key}] EventSub session established (session=${this.sessionId})`);
				await this.createSubscriptions();
				this.delegate.onWelcome();
				break;
			}
			case 'session_keepalive': {
				break;
			}
			case 'session_reconnect': {
				const url = msg.payload.session?.reconnect_url;
				this.logger.info(`[${this.key}] EventSub requested session reconnect`);
				if (url != null) {
					// 旧セッションは Twitch 側から close される。自動 reconnect は抑止して
					// 指定された URL へ即座に張り直す (subscription は引き継がれる)。
					this.suppressNextReconnect = true;
					this.closeWs('session-reconnect');
					await this.connect(url);
				}
				break;
			}
			case 'revocation': {
				const sub = msg.payload.subscription;
				this.logger.warn(`[${this.key}] subscription revoked: type=${sub?.type} status=${sub?.status} condition=${JSON.stringify(sub?.condition)}`);
				break;
			}
			case 'notification': {
				await this.delegate.onNotification(msg);
				break;
			}
		}
	}

	/**
	 * 現セッションに対して delegate が指定する subscription を作成する。
	 * 1 件も作成できなかった場合、Twitch は 10 秒で接続を切ってくるため自発的に閉じて
	 * バックオフ再接続に乗せる (トークン失効・対象消滅時は再接続せず停止)。
	 */
	private async createSubscriptions(): Promise<void> {
		if (this.sessionId == null) return;

		const token = await this.delegate.getToken();
		if (token == null) {
			this.logger.warn(`[${this.key}] token is invalid (unlinked?), closing EventSub session`);
			this.suppressNextReconnect = true;
			this.closeWs('token-invalid');
			return;
		}

		const subscriptions = await this.delegate.buildSubscriptions();
		if (subscriptions == null || subscriptions.length === 0) {
			this.logger.info(`[${this.key}] no subscription targets, closing EventSub session`);
			this.suppressNextReconnect = true;
			this.closeWs('no-targets');
			return;
		}

		let created = 0;
		for (const sub of subscriptions) {
			try {
				await this.delegate.helixPost('/helix/eventsub/subscriptions', {
					...sub,
					transport: { method: 'websocket', session_id: this.sessionId },
				}, token);
				created += 1;
			} catch (e) {
				this.logger.warn(`[${this.key}] subscription create failed (${sub.type}, condition=${JSON.stringify(sub.condition)}): ${e instanceof Error ? e.message : e}`);
			}
		}
		this.logger.info(`[${this.key}] subscriptions created: ${created}/${subscriptions.length}`);

		if (created === 0) {
			// subscription ゼロのセッションは Twitch 側から切断される。watchdog 頼みにせず閉じる
			this.closeWs('no-subscriptions-created');
			this.scheduleReconnect();
		}
	}

	private clearConnectTimer(): void {
		if (this.connectTimer != null) {
			clearTimeout(this.connectTimer);
			this.connectTimer = null;
		}
	}

	private closeWs(reason: string): void {
		this.clearConnectTimer();
		if (this.ws == null) return;
		try {
			this.ws.close(1000, reason);
		} catch {
			// ignore close errors
		}
		this.ws = null;
		this.sessionId = null;
		this.connecting = false;
	}

	private scheduleReconnect(): void {
		if (this.stopped) return;
		if (this.reconnectTimer != null) return;
		const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** this.reconnectAttempt);
		this.reconnectAttempt += 1;
		this.logger.info(`[${this.key}] reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connect().catch(e => this.logger.error(`[${this.key}] reconnect failed: ${e instanceof Error ? e.message : e}`));
		}, delay);
	}
}

@Injectable()
export class TwitchEventSubService implements OnModuleInit, OnApplicationShutdown {
	private logger: Logger;
	private stopped = false;
	private accountRefreshTimer: NodeJS.Timeout | null = null;
	private heartbeatTimer: NodeJS.Timeout | null = null;
	// key: 'bot' (チャット購読) または 'streamer:<twitchUserId>' (online/offline 購読)
	private sessions = new Map<string, EventSubSession>();
	// bot セッションのチャット購読対象 (変化検知して張り直すため)
	private botChatTargets: string[] = [];
	private lastSelfHealPollAt = 0;

	constructor(
		@Inject(DI.twitchAccountsRepository)
		private twitchAccountsRepository: TwitchAccountsRepository,

		private twitchApiService: TwitchApiService,
		private twitchOAuthService: TwitchOAuthService,
		private twitchStreamService: TwitchStreamService,
		private twitchChatRelayService: TwitchChatRelayService,
		private twitchLoggerService: TwitchLoggerService,
	) {
		this.logger = this.twitchLoggerService.child('eventsub');
	}

	async onModuleInit(): Promise<void> {
		if (process.env.TWITCH_DISABLE_EVENTSUB === '1') {
			this.logger.info('disabled via TWITCH_DISABLE_EVENTSUB env');
			return;
		}
		if (!this.twitchApiService.isEnabled) return;
		if (!cluster.isPrimary) return;
		this.start();
	}

	async onApplicationShutdown(): Promise<void> {
		this.stop();
	}

	@bindThis
	public start(): void {
		this.stopped = false;
		this.accountRefreshTimer = setInterval(() => {
			this.refreshSubscription().catch(e => this.logger.error(`account refresh tick failed: ${e instanceof Error ? e.message : e}`));
		}, ACCOUNT_REFRESH_INTERVAL_MS);
		this.heartbeatTimer = setInterval(() => {
			for (const session of this.sessions.values()) session.heartbeatCheck();
		}, HEARTBEAT_CHECK_INTERVAL_MS);
		this.refreshSubscription().catch(e => this.logger.error(`initial refresh failed: ${e instanceof Error ? e.message : e}`));
	}

	@bindThis
	public stop(): void {
		this.stopped = true;
		if (this.accountRefreshTimer != null) {
			clearInterval(this.accountRefreshTimer);
			this.accountRefreshTimer = null;
		}
		if (this.heartbeatTimer != null) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
		for (const session of this.sessions.values()) session.stop();
		this.sessions.clear();
	}

	/**
	 * 連携アカウント一覧と現行セッション集合を突合し、追加/削除/対象変化を反映する。
	 * 60 秒間隔の定期 tick で呼ばれる (連携/解除の反映と、落ちたままのセッションの蘇生)。
	 */
	@bindThis
	public async refreshSubscription(): Promise<void> {
		if (this.stopped) return;

		const accounts = await this.twitchAccountsRepository.find();
		const streamers = accounts.filter(a => !a.isBot && a.userId != null);
		const streamerIds = streamers.map(a => a.twitchUserId).sort();
		const bot = accounts.find(a => a.isBot) ?? null;

		const desiredKeys = new Set<string>();
		if (bot != null && streamerIds.length > 0) desiredKeys.add('bot');
		for (const id of streamerIds) desiredKeys.add(`streamer:${id}`);

		// 消えたセッションを破棄
		for (const [key, session] of this.sessions) {
			if (!desiredKeys.has(key)) {
				this.logger.info(`session ${key} no longer needed, stopping`);
				session.stop();
				this.sessions.delete(key);
			}
		}

		// bot セッション: チャット購読対象の変化で張り直し
		if (desiredKeys.has('bot')) {
			const existing = this.sessions.get('bot');
			if (existing == null) {
				const session = this.createBotSession();
				this.sessions.set('bot', session);
				this.botChatTargets = streamerIds;
				session.start();
			} else if (this.botChatTargets.join(',') !== streamerIds.join(',')) {
				this.logger.info(`bot chat targets changed (${streamerIds.length} broadcasters), restarting bot session`);
				this.botChatTargets = streamerIds;
				existing.restart();
			} else {
				existing.reviveIfDisconnected();
			}
		}

		// 配信者セッション: 存在の有無のみ (購読対象は常に自分自身で不変)
		for (const id of streamerIds) {
			const key = `streamer:${id}`;
			const existing = this.sessions.get(key);
			if (existing == null) {
				const session = this.createStreamerSession(id);
				this.sessions.set(key, session);
				session.start();
			} else {
				existing.reviveIfDisconnected();
			}
		}
	}

	@bindThis
	private createBotSession(): EventSubSession {
		return new EventSubSession('bot', this.logger, {
			getToken: async () => {
				const bot = await this.twitchOAuthService.getBotAccount();
				if (bot == null) return null;
				return await this.twitchOAuthService.getValidAccessToken(bot);
			},
			buildSubscriptions: async () => {
				const bot = await this.twitchOAuthService.getBotAccount();
				if (bot == null) return null;
				const accounts = await this.twitchAccountsRepository.find();
				const targets = accounts.filter(a => !a.isBot && a.userId != null).map(a => a.twitchUserId).sort();
				// channel.chat.message は「bot として読む」ため user_id (chatter) に bot を指定する。
				// user_id = トークン所有者なのでコスト 0 (broadcaster 数に上限が生じない)
				return targets.map(twitchUserId => ({
					type: 'channel.chat.message',
					version: '1',
					condition: { broadcaster_user_id: twitchUserId, user_id: bot.twitchUserId },
				}));
			},
			onNotification: this.handleNotification,
			onWelcome: this.selfHealPoll,
			helixPost: this.twitchApiService.helixPost,
		});
	}

	@bindThis
	private createStreamerSession(twitchUserId: string): EventSubSession {
		return new EventSubSession(`streamer:${twitchUserId}`, this.logger, {
			getToken: async () => {
				const account = await this.twitchAccountsRepository.findOneBy({ twitchUserId });
				if (account == null || account.isBot || account.userId == null) return null;
				return await this.twitchOAuthService.getValidAccessToken(account);
			},
			buildSubscriptions: async () => {
				// 自分のチャンネルの配信開始/終了のみ。broadcaster = トークン所有者なのでコスト 0、
				// scope 不要のため既存連携トークンで購読できる
				return [
					{ type: 'stream.online', version: '1', condition: { broadcaster_user_id: twitchUserId } },
					{ type: 'stream.offline', version: '1', condition: { broadcaster_user_id: twitchUserId } },
				];
			},
			onNotification: this.handleNotification,
			onWelcome: this.selfHealPoll,
			helixPost: this.twitchApiService.helixPost,
		});
	}

	/**
	 * 再接続時に EventSub が取り逃した配信開始を即座に自己修復する。
	 * pollAll は Helix Get Streams を叩いて DB と同期するため、切断中に開始された配信が
	 * 最大 2 分のポーリング間隔を待たずに検知される。起動時は全セッションが一斉に welcome を
	 * 受けるためデバウンスする。
	 */
	@bindThis
	private selfHealPoll(): void {
		const now = Date.now();
		if (now - this.lastSelfHealPollAt < POLL_SELF_HEAL_DEBOUNCE_MS) return;
		this.lastSelfHealPollAt = now;
		this.twitchStreamService.pollAll().catch(e => {
			this.logger.error(`post-reconnect pollAll failed: ${e instanceof Error ? e.message : e}`);
		});
	}

	@bindThis
	private async handleNotification(msg: EventSubMessage): Promise<void> {
		const type = msg.payload.subscription?.type;
		const event = msg.payload.event;
		if (type == null || event == null) return;

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
}
