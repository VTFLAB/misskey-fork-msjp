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
// 購読には bot アカウントの user access token が必要 (未連携ならポーリングのみで動作)。
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

@Injectable()
export class TwitchEventSubService implements OnModuleInit, OnApplicationShutdown {
	private logger: Logger;
	private ws: WebSocket | null = null;
	private sessionId: string | null = null;
	private stopped = false;
	private connecting = false;
	private suppressNextReconnect = false;
	private reconnectAttempt = 0;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private connectTimer: NodeJS.Timeout | null = null;
	private accountRefreshTimer: NodeJS.Timeout | null = null;
	private heartbeatTimer: NodeJS.Timeout | null = null;
	private lastMessageAt: number | null = null;
	private subscribedTwitchUserIds: string[] = [];
	private seenMessageIds = new Set<string>();

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
		this.heartbeatTimer = setInterval(() => this.heartbeatCheck(), HEARTBEAT_CHECK_INTERVAL_MS);
		this.connect().catch(e => this.logger.error(`initial connect failed: ${e instanceof Error ? e.message : e}`));
	}

	@bindThis
	public stop(): void {
		this.stopped = true;
		if (this.reconnectTimer != null) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.accountRefreshTimer != null) {
			clearInterval(this.accountRefreshTimer);
			this.accountRefreshTimer = null;
		}
		if (this.heartbeatTimer != null) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
		this.clearConnectTimer();
		this.closeWs('shutdown');
	}

	/**
	 * 連携アカウント一覧を再取得し、対象 broadcaster が変化していれば再接続して張り直す。
	 * bot 未連携で切断状態のまま新たに bot が連携された場合の蘇生もここで行う。
	 */
	@bindThis
	public async refreshSubscription(): Promise<void> {
		const targets = await this.listTargetTwitchUserIds();
		const changed = targets.join(',') !== this.subscribedTwitchUserIds.join(',');
		const disconnected = this.ws == null && !this.connecting && this.reconnectTimer == null;

		if (changed && this.ws != null) {
			this.logger.info(`subscription targets changed (${targets.length} broadcasters), reconnecting`);
			this.suppressNextReconnect = true;
			this.closeWs('targets-changed');
			this.reconnectAttempt = 0;
			await this.connect();
		} else if (disconnected) {
			this.reconnectAttempt = 0;
			await this.connect();
		}
	}

	@bindThis
	private async listTargetTwitchUserIds(): Promise<string[]> {
		const accounts = await this.twitchAccountsRepository.find();
		return accounts.filter(a => !a.isBot && a.userId != null).map(a => a.twitchUserId).sort();
	}

	@bindThis
	private heartbeatCheck(): void {
		if (this.ws == null) return;
		if (this.ws.readyState !== WebSocket.OPEN) return;
		if (this.lastMessageAt == null) return;
		const idleMs = Date.now() - this.lastMessageAt;
		if (idleMs > HEARTBEAT_TIMEOUT_MS) {
			this.logger.warn(`heartbeat watchdog: no EventSub messages for ${Math.round(idleMs / 1000)}s; forcing reconnect`);
			this.closeWs('heartbeat-timeout');
			this.scheduleReconnect();
		}
	}

	@bindThis
	private async connect(url?: string): Promise<void> {
		if (this.stopped) return;
		if (this.connecting) return;

		const bot = await this.twitchOAuthService.getBotAccount();
		if (bot == null) {
			this.logger.debug('bot account not linked, EventSub idle (polling only; will retry on next refresh tick)');
			return;
		}

		const targets = await this.listTargetTwitchUserIds();
		if (targets.length === 0) {
			this.logger.debug('no linked broadcasters, EventSub idle (will retry on next refresh tick)');
			return;
		}

		this.connecting = true;
		const wsUrl = url ?? `${EVENTSUB_URL}?keepalive_timeout_seconds=${KEEPALIVE_TIMEOUT_SEC}`;
		this.logger.info(`connecting to EventSub (${targets.length} broadcasters)`);

		let ws: WebSocket;
		try {
			ws = new WebSocket(wsUrl);
		} catch (e) {
			this.connecting = false;
			this.logger.error(`WebSocket construction failed: ${e instanceof Error ? e.message : e}`);
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
				this.logger.error(`message handling failed: ${e instanceof Error ? (e.stack ?? e.message) : e}`);
			});
		});
		ws.addEventListener('error', (event) => {
			const msg = (event as Event & { message?: string }).message ?? '(no message)';
			this.logger.warn(`EventSub WS error: ${msg}${this.ws === ws ? '' : ' (stale)'}`);
		});
		ws.addEventListener('close', (event) => {
			const stale = this.ws !== ws;
			this.logger.warn(`EventSub WS closed (code=${event.code}, reason="${event.reason}"${stale ? ', stale' : ''})`);
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
			this.logger.warn(`connect watchdog: WS stuck (readyState=${ws.readyState}); forcing reconnect`);
			this.closeWs('connect-timeout');
			this.scheduleReconnect();
		}, CONNECT_TIMEOUT_MS);
	}

	@bindThis
	private async handleMessage(data: unknown): Promise<void> {
		if (typeof data !== 'string') return;
		this.lastMessageAt = Date.now();

		let msg: EventSubMessage;
		try {
			msg = JSON.parse(data) as EventSubMessage;
		} catch (e) {
			this.logger.warn(`malformed EventSub message: ${e instanceof Error ? e.message : e}`);
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
				this.logger.info(`EventSub session established (session=${this.sessionId})`);
				await this.createSubscriptions();
				// 再接続時に EventSub が取り逃した配信開始を即座に自己修復する。
				// pollAll は Helix Get Streams を叩いて DB と同期するため、切断中に
				// 開始された配信が最大2分のポーリング間隔を待たずに検知される。
				this.twitchStreamService.pollAll().catch(e => {
					this.logger.error(`post-reconnect pollAll failed: ${e instanceof Error ? e.message : e}`);
				});
				break;
			}
			case 'session_keepalive': {
				break;
			}
			case 'session_reconnect': {
				const url = msg.payload.session?.reconnect_url;
				this.logger.info('EventSub requested session reconnect');
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
				this.logger.warn(`subscription revoked: type=${sub?.type} status=${sub?.status} condition=${JSON.stringify(sub?.condition)}`);
				break;
			}
			case 'notification': {
				await this.handleNotification(msg);
				break;
			}
		}
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

	/**
	 * 現セッションに対して全対象 broadcaster の subscription を作成する。
	 * WebSocket transport の subscription 作成には bot の user access token が必要。
	 */
	@bindThis
	private async createSubscriptions(): Promise<void> {
		if (this.sessionId == null) return;

		const bot = await this.twitchOAuthService.getBotAccount();
		if (bot == null) {
			this.logger.warn('bot account disappeared, closing EventSub');
			this.closeWs('no-bot');
			return;
		}
		const token = await this.twitchOAuthService.getValidAccessToken(bot);
		if (token == null) {
			this.logger.warn('bot token is invalid (unlinked?), closing EventSub');
			this.closeWs('bot-token-invalid');
			return;
		}

		const targets = await this.listTargetTwitchUserIds();
		let created = 0;
		for (const twitchUserId of targets) {
			// channel.chat.message は「bot として読む」ため user_id (chatter) に bot を指定する。
			// websocket transport + bot user token (user:read:chat) で全 broadcaster のチャットを購読できる
			const subscriptions = [
				{ type: 'stream.online', version: '1', condition: { broadcaster_user_id: twitchUserId } },
				{ type: 'stream.offline', version: '1', condition: { broadcaster_user_id: twitchUserId } },
				{ type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: twitchUserId, user_id: bot.twitchUserId } },
			];
			for (const sub of subscriptions) {
				try {
					await this.twitchApiService.helixPost('/helix/eventsub/subscriptions', {
						...sub,
						transport: { method: 'websocket', session_id: this.sessionId },
					}, token);
					created += 1;
				} catch (e) {
					this.logger.warn(`subscription create failed (${sub.type}, broadcaster=${twitchUserId}): ${e instanceof Error ? e.message : e}`);
				}
			}
		}
		this.subscribedTwitchUserIds = targets;
		this.logger.info(`subscriptions created: ${created} (${targets.length} broadcasters)`);
	}

	@bindThis
	private clearConnectTimer(): void {
		if (this.connectTimer != null) {
			clearTimeout(this.connectTimer);
			this.connectTimer = null;
		}
	}

	@bindThis
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

	@bindThis
	private scheduleReconnect(): void {
		if (this.stopped) return;
		if (this.reconnectTimer != null) return;
		const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** this.reconnectAttempt);
		this.reconnectAttempt += 1;
		this.logger.info(`reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connect().catch(e => this.logger.error(`reconnect failed: ${e instanceof Error ? e.message : e}`));
		}, delay);
	}
}
