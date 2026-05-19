/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

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

@Injectable()
export class AtpJetstreamService implements OnModuleInit, OnApplicationShutdown {
	private logger: Logger;
	private readonly jetstreamUrl: string;
	private ws: WebSocket | null = null;
	private reconnectAttempt = 0;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private didRefreshTimer: NodeJS.Timeout | null = null;
	private cursorFlushTimer: NodeJS.Timeout | null = null;
	private currentCursor: number | null = null;
	private flushedCursor: number | null = null;
	private wantedDids: string[] = [];
	private stopped = false;
	private connecting = false;

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
		// node が CLI スクリプトとして起動された場合は process.env.NODE_ENV !== 'production' の
		// 通常 dev/test では起動。disable したい場合は env で AT_PROTO_DISABLE_JETSTREAM=1。
		if (process.env.AT_PROTO_DISABLE_JETSTREAM === '1') {
			this.logger.info('disabled via AT_PROTO_DISABLE_JETSTREAM env');
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
		await this.refreshWantedDids();
		this.scheduleDidRefresh();
		this.scheduleCursorFlush();
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
		if (this.wantedDids.join(',') !== before) {
			this.logger.info(`wantedDids changed (${this.wantedDids.length} DIDs), reconnecting`);
			this.closeWs('did-list-changed');
			this.reconnectAttempt = 0;
			this.connect();
		}
	}

	@bindThis
	private async refreshWantedDids(): Promise<void> {
		try {
			const dids = await this.atpPersonService.listAllDids();
			this.wantedDids = dids.slice(0, MAX_WANTED_DIDS);
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

		ws.addEventListener('open', () => {
			this.connecting = false;
			this.reconnectAttempt = 0;
			this.logger.info('Jetstream connected');
		});
		ws.addEventListener('message', (event: MessageEvent) => {
			this.handleMessage(event.data);
		});
		ws.addEventListener('error', (event) => {
			const msg = (event as Event & { message?: string }).message ?? '(no message)';
			this.logger.warn(`Jetstream WS error: ${msg}`);
		});
		ws.addEventListener('close', (event) => {
			this.connecting = false;
			this.logger.warn(`Jetstream WS closed (code=${event.code}, reason="${event.reason}")`);
			this.ws = null;
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

		let evt: JetstreamEvent;
		try {
			evt = JSON.parse(data) as JetstreamEvent;
		} catch (e) {
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
				if (commit.record == null) return;
				this.atpNoteService.ingestPost(evt.did, commit.rkey, commit.record).catch(e => {
					this.logger.error(`ingestPost failed for ${evt.did}/${commit.rkey}: ${e instanceof Error ? e.message : String(e)}`);
				});
			} else if (commit.operation === 'delete') {
				this.atpNoteService.deletePost(evt.did, commit.rkey).catch(e => {
					this.logger.error(`deletePost failed for ${evt.did}/${commit.rkey}: ${e instanceof Error ? e.message : String(e)}`);
				});
			}
		} else if (commit.collection === 'app.bsky.feed.repost') {
			if (commit.operation === 'create' || commit.operation === 'update') {
				if (commit.record == null) return;
				this.atpNoteService.ingestRepost(evt.did, commit.rkey, commit.record).catch(e => {
					this.logger.error(`ingestRepost failed for ${evt.did}/${commit.rkey}: ${e instanceof Error ? e.message : String(e)}`);
				});
			} else if (commit.operation === 'delete') {
				this.atpNoteService.deleteRepost(evt.did, commit.rkey).catch(e => {
					this.logger.error(`deleteRepost failed for ${evt.did}/${commit.rkey}: ${e instanceof Error ? e.message : String(e)}`);
				});
			}
		}
	}
}
