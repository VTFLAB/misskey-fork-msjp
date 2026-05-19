/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import cluster from 'node:cluster';
import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { AtpLoggerService } from './AtpLoggerService.js';
import { AtpPersonService } from './AtpPersonService.js';
import { AtpNoteService } from './AtpNoteService.js';

// Jetstream の commit event 型 (必要な field だけ宣言)。
// 詳細: https://docs.bsky.app/blog/jetstream
export type JetstreamCommitEvent = {
	did: string;
	time_us: number;
	kind: 'commit';
	commit: {
		rev: string;
		operation: 'create' | 'update' | 'delete';
		collection: string;
		rkey: string;
		cid?: string;
		record?: Record<string, unknown>;
	};
};

type JetstreamEvent = JetstreamCommitEvent | { kind: 'identity' | 'account'; did: string; time_us: number };

const DEFAULT_JETSTREAM_URL = 'wss://jetstream2.us-east.bsky.network/subscribe';
const WANTED_COLLECTIONS = ['app.bsky.feed.post', 'app.bsky.feed.repost'];
const CURSOR_REDIS_KEY = 'atproto:jetstream:cursor';
const CURSOR_FLUSH_INTERVAL_MS = 5_000;
const DID_REFRESH_INTERVAL_MS = 60_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
// Jetstream の URL クエリは最大長制限がある。Bluesky 側は wantedDids 上限を
// 10000 件としているが、長すぎる URL は Cloudflare 等で 414 になるので保守的に絞る。
const MAX_WANTED_DIDS = 5000;

const STATS_INTERVAL_MS = 60_000;
// Jetstream watermark: handleMessage が呼ばれる度に lastEventAt を更新し、
// HEARTBEAT_TIMEOUT_MS 以上無音だったら WS が死んでいるとみなして強制再接続する。
// 接続自体は WS の close event が来ない silent-death の保険。Bsky の流量は public
// network 全体で常に活発なので、wantedDids が空でない限り 5 分以上完全無音は dead 判定。
const HEARTBEAT_CHECK_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 5 * 60_000;

type EventStats = {
	received: number;
	postCreate: number;
	postDelete: number;
	repostCreate: number;
	repostDelete: number;
	ingestErrors: number;
	skippedNoSubject: number;
	parseErrors: number;
};

const ZERO_STATS = (): EventStats => ({
	received: 0,
	postCreate: 0,
	postDelete: 0,
	repostCreate: 0,
	repostDelete: 0,
	ingestErrors: 0,
	skippedNoSubject: 0,
	parseErrors: 0,
});

@Injectable()
export class AtpJetstreamService implements OnModuleInit, OnApplicationShutdown {
	private logger: Logger;
	private readonly jetstreamUrl: string;
	private ws: WebSocket | null = null;
	private reconnectAttempt = 0;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private didRefreshTimer: NodeJS.Timeout | null = null;
	private cursorFlushTimer: NodeJS.Timeout | null = null;
	private statsTimer: NodeJS.Timeout | null = null;
	private heartbeatTimer: NodeJS.Timeout | null = null;
	private currentCursor: number | null = null;
	private flushedCursor: number | null = null;
	private wantedDids: string[] = [];
	private stopped = false;
	private connecting = false;
	private suppressNextReconnect = false;
	private stats: EventStats = ZERO_STATS();
	private lastConnectAt: number | null = null;
	private lastEventAt: number | null = null;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		private atpLoggerService: AtpLoggerService,
		private atpPersonService: AtpPersonService,
		private atpNoteService: AtpNoteService,
	) {
		this.logger = this.atpLoggerService.child('jetstream');
		this.jetstreamUrl = (this.config as Config & { atprotoJetstreamUrl?: string }).atprotoJetstreamUrl ?? DEFAULT_JETSTREAM_URL;
	}

	async onModuleInit(): Promise<void> {
		// テスト / migration ランから誤起動しないようガード。
		// disable したい場合は env で AT_PROTO_DISABLE_JETSTREAM=1。
		if (process.env.AT_PROTO_DISABLE_JETSTREAM === '1') {
			this.logger.info('disabled via AT_PROTO_DISABLE_JETSTREAM env');
			return;
		}
		// Misskey は cluster で main + worker(s) を立てるが、Jetstream は単一 WS 購読の
		// 方が帯域・DB INSERT 重複の両面で好ましい。disableClustering=true (workerless) の場合は
		// main 自身が両役を兼ねるのでそのまま起動する。それ以外は primary process のみで起動。
		if (!cluster.isPrimary) {
			this.logger.info(`skip start: not cluster primary (worker.id=${cluster.worker?.id})`);
			return;
		}
		await this.start();
	}

	async onApplicationShutdown(): Promise<void> {
		await this.stop();
	}

	@bindThis
	public async start(): Promise<void> {
		this.stopped = false;
		this.currentCursor = await this.loadCursor();
		this.flushedCursor = this.currentCursor;
		this.logger.info(`starting (cursor from Redis = ${this.currentCursor ?? '(none)'}, AT_PROTO_DISABLE_JETSTREAM=${process.env.AT_PROTO_DISABLE_JETSTREAM ?? 'unset'})`);
		await this.refreshWantedDids();
		this.scheduleDidRefresh();
		this.scheduleCursorFlush();
		this.scheduleStatsLog();
		this.scheduleHeartbeatCheck();
		this.connect();
	}

	@bindThis
	public async stop(): Promise<void> {
		this.stopped = true;
		if (this.reconnectTimer != null) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.didRefreshTimer != null) {
			clearInterval(this.didRefreshTimer);
			this.didRefreshTimer = null;
		}
		if (this.cursorFlushTimer != null) {
			clearInterval(this.cursorFlushTimer);
			this.cursorFlushTimer = null;
		}
		if (this.statsTimer != null) {
			clearInterval(this.statsTimer);
			this.statsTimer = null;
		}
		if (this.heartbeatTimer != null) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
		this.logger.info('stopping, flushing cursor');
		this.closeWs('shutdown');
		await this.flushCursor(true);
	}

	/**
	 * pseudo-user が新規 follow された等で wantedDids を即時更新したい時に呼ぶ。
	 * 内部の DID list を再取得し、変化があれば接続を張り直す。
	 */
	@bindThis
	public async refreshSubscription(): Promise<void> {
		const before = this.wantedDids.join(',');
		await this.refreshWantedDids();
		const changed = this.wantedDids.join(',') !== before;
		const disconnected = this.ws == null && !this.connecting && this.reconnectTimer == null && this.wantedDids.length > 0;

		if (changed) {
			this.logger.info(`wantedDids changed (${this.wantedDids.length} DIDs), reconnecting`);
			// closeWs() の close event handler が scheduleReconnect() を呼ぶと、ここでの
			// 即時 connect() と重複した 2 つの WS が開く race condition があるので、
			// 「次の close は自動 reconnect を抑止する」フラグを立てる。
			this.suppressNextReconnect = true;
			this.closeWs('did-list-changed');
			this.reconnectAttempt = 0;
			this.connect();
		} else if (disconnected) {
			// did は変わらなかったが WS が落ちていて reconnect timer も無い (= stuck) 状態。
			// 60 秒ごとの定期 tick で蘇生させる。
			this.logger.info(`detected disconnected state, reconnecting (${this.wantedDids.length} DIDs)`);
			this.reconnectAttempt = 0;
			this.connect();
		}
	}

	@bindThis
	private async refreshWantedDids(): Promise<void> {
		try {
			const before = this.wantedDids.length;
			const dids = await this.atpPersonService.listAllDids();
			this.wantedDids = dids.slice(0, MAX_WANTED_DIDS);
			if (before !== this.wantedDids.length) {
				this.logger.info(`wantedDids updated: ${before} → ${this.wantedDids.length}`);
			}
			if (dids.length > MAX_WANTED_DIDS) {
				this.logger.warn(`pseudo-user DID count ${dids.length} exceeds MAX_WANTED_DIDS=${MAX_WANTED_DIDS}; later entries will not be subscribed`);
			}
		} catch (e) {
			this.logger.error(`failed to refresh wantedDids: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	@bindThis
	private scheduleDidRefresh(): void {
		this.didRefreshTimer = setInterval(() => {
			this.refreshSubscription().catch(e => this.logger.error(`did refresh tick failed: ${e instanceof Error ? e.message : String(e)}`));
		}, DID_REFRESH_INTERVAL_MS);
	}

	@bindThis
	private scheduleCursorFlush(): void {
		this.cursorFlushTimer = setInterval(() => {
			this.flushCursor(false).catch(e => this.logger.error(`cursor flush failed: ${e instanceof Error ? e.message : String(e)}`));
		}, CURSOR_FLUSH_INTERVAL_MS);
	}

	@bindThis
	private scheduleStatsLog(): void {
		this.statsTimer = setInterval(() => {
			const s = this.stats;
			if (s.received === 0 && s.ingestErrors === 0) {
				this.logger.debug(`stats(60s): no events. connected=${this.ws != null} dids=${this.wantedDids.length}`);
			} else {
				this.logger.info(
					`stats(60s): received=${s.received} post(+${s.postCreate}/-${s.postDelete}) repost(+${s.repostCreate}/-${s.repostDelete}) ingestErrors=${s.ingestErrors} skippedNoSubject=${s.skippedNoSubject} parseErrors=${s.parseErrors} cursor=${this.currentCursor ?? '(none)'} dids=${this.wantedDids.length}`,
				);
			}
			this.stats = ZERO_STATS();
		}, STATS_INTERVAL_MS);
	}

	@bindThis
	private scheduleHeartbeatCheck(): void {
		this.heartbeatTimer = setInterval(() => {
			// 接続中で、最後の event 受信から HEARTBEAT_TIMEOUT_MS 以上経過していたら
			// silent-death と判定して WS を強制 close → 通常の reconnect 経路に乗せる。
			if (this.ws == null) return;
			if (this.lastEventAt == null) return;
			const idleMs = Date.now() - this.lastEventAt;
			if (idleMs > HEARTBEAT_TIMEOUT_MS) {
				this.logger.warn(`heartbeat watchdog: no Jetstream events for ${Math.round(idleMs / 1000)}s; forcing reconnect`);
				// 通常 reconnect させる (suppressNextReconnect は立てない)
				this.closeWs('heartbeat-timeout');
				this.scheduleReconnect();
			}
		}, HEARTBEAT_CHECK_INTERVAL_MS);
	}

	@bindThis
	private async loadCursor(): Promise<number | null> {
		const raw = await this.redisClient.get(CURSOR_REDIS_KEY).catch(() => null);
		if (raw == null) return null;
		const n = Number(raw);
		return Number.isFinite(n) ? n : null;
	}

	@bindThis
	private async flushCursor(force: boolean): Promise<void> {
		if (this.currentCursor == null) return;
		if (!force && this.currentCursor === this.flushedCursor) return;
		await this.redisClient.set(CURSOR_REDIS_KEY, String(this.currentCursor)).catch(e => {
			this.logger.error(`cursor save failed: ${e instanceof Error ? e.message : String(e)}`);
		});
		this.flushedCursor = this.currentCursor;
	}

	@bindThis
	private buildUrl(): string {
		const url = new URL(this.jetstreamUrl);
		for (const c of WANTED_COLLECTIONS) {
			url.searchParams.append('wantedCollections', c);
		}
		for (const did of this.wantedDids) {
			url.searchParams.append('wantedDids', did);
		}
		if (this.currentCursor != null) {
			url.searchParams.set('cursor', String(this.currentCursor));
		}
		return url.toString();
	}

	@bindThis
	private connect(): void {
		if (this.stopped) return;
		if (this.connecting) return;
		if (this.wantedDids.length === 0) {
			this.logger.debug('no pseudo-users registered, idle (will retry on next did refresh)');
			return;
		}

		this.connecting = true;
		const url = this.buildUrl();
		this.logger.info(`connecting to Jetstream (${this.wantedDids.length} DIDs, cursor=${this.currentCursor ?? '(none)'})`);

		let ws: WebSocket;
		try {
			ws = new WebSocket(url);
		} catch (e) {
			this.connecting = false;
			this.logger.error(`WebSocket construction failed: ${e instanceof Error ? e.message : String(e)}`);
			this.scheduleReconnect();
			return;
		}

		// closure 内で「自分が現役 WS かどうか」を確認するため、
		// このインスタンス自身への参照をハンドラ内で this.ws と比較する。
		ws.addEventListener('open', () => {
			if (this.ws !== ws) return; // 古い WS の open はもう関係ない
			this.connecting = false;
			this.reconnectAttempt = 0;
			this.lastConnectAt = Date.now();
			// open 時点で lastEventAt を初期化。これがないと「接続直後 = 過去の eventAt がそのまま →
			// heartbeat watchdog が即時に reconnect する」死亡ループに陥る。
			this.lastEventAt = Date.now();
			this.logger.info(`Jetstream connected (dids=${this.wantedDids.length} cursor=${this.currentCursor ?? '(none)'})`);
		});
		ws.addEventListener('message', (event: MessageEvent) => {
			if (this.ws !== ws) return; // 古い WS からのメッセージは無視
			this.handleMessage(event.data);
		});
		ws.addEventListener('error', (event) => {
			const msg = (event as Event & { message?: string }).message ?? '(no message)';
			this.logger.warn(`Jetstream WS error: ${msg}${this.ws === ws ? '' : ' (stale)'}`);
		});
		ws.addEventListener('close', (event) => {
			const uptime = this.lastConnectAt != null ? Math.round((Date.now() - this.lastConnectAt) / 1000) : 0;
			const stale = this.ws !== ws;
			this.logger.warn(`Jetstream WS closed (code=${event.code}, reason="${event.reason}", uptime=${uptime}s${stale ? ', stale' : ''})`);
			if (stale) return; // 古い WS の close は無視 (this.ws / connecting / reconnect 制御に触らない)
			this.connecting = false;
			this.ws = null;
			if (this.suppressNextReconnect) {
				this.suppressNextReconnect = false;
				this.logger.debug('skipping auto-reconnect (manual close by refreshSubscription)');
				return;
			}
			this.scheduleReconnect();
		});

		this.ws = ws;
	}

	@bindThis
	private closeWs(reason: string): void {
		if (this.ws == null) return;
		try {
			this.ws.close(1000, reason);
		} catch {
			// ignore close errors
		}
		this.ws = null;
		// connecting state は close event で false に戻る予定だが、
		// 「CONNECTING 中に close()」では close event が来ないことがある
		// (Node 22 undici WS の挙動)。フラグは明示的に下ろす。
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
			this.connect();
		}, delay);
	}

	@bindThis
	private handleMessage(data: unknown): void {
		if (typeof data !== 'string') return;
		this.stats.received += 1;
		this.lastEventAt = Date.now();

		let evt: JetstreamEvent;
		try {
			evt = JSON.parse(data) as JetstreamEvent;
		} catch (e) {
			this.stats.parseErrors += 1;
			this.logger.warn(`malformed Jetstream message: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}

		if (typeof evt.time_us === 'number') {
			this.currentCursor = evt.time_us;
		}

		if (evt.kind !== 'commit') return;

		const commit = evt.commit;
		if (commit.collection === 'app.bsky.feed.post') {
			if (commit.operation === 'create' || commit.operation === 'update') {
				if (commit.record == null) {
					this.stats.skippedNoSubject += 1;
					return;
				}
				this.stats.postCreate += 1;
				this.atpNoteService.ingestPost(evt.did, commit.rkey, commit.record).catch(e => {
					this.stats.ingestErrors += 1;
					this.logger.error(`ingestPost failed for ${evt.did}/${commit.rkey}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
				});
			} else if (commit.operation === 'delete') {
				this.stats.postDelete += 1;
				this.atpNoteService.deletePost(evt.did, commit.rkey).catch(e => {
					this.stats.ingestErrors += 1;
					this.logger.error(`deletePost failed for ${evt.did}/${commit.rkey}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
				});
			}
		} else if (commit.collection === 'app.bsky.feed.repost') {
			if (commit.operation === 'create' || commit.operation === 'update') {
				if (commit.record == null) {
					this.stats.skippedNoSubject += 1;
					return;
				}
				this.stats.repostCreate += 1;
				this.atpNoteService.ingestRepost(evt.did, commit.rkey, commit.record).catch(e => {
					this.stats.ingestErrors += 1;
					this.logger.error(`ingestRepost failed for ${evt.did}/${commit.rkey}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
				});
			} else if (commit.operation === 'delete') {
				this.stats.repostDelete += 1;
				this.atpNoteService.deleteRepost(evt.did, commit.rkey).catch(e => {
					this.stats.ingestErrors += 1;
					this.logger.error(`deleteRepost failed for ${evt.did}/${commit.rkey}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
				});
			}
		}
	}
}
