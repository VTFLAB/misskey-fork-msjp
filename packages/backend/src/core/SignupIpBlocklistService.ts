/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { bindThis } from '@/decorators.js';
import { IpRangeSet } from '@/misc/ip-range-set.js';
import { compileUserAgentPatterns, matchesUserAgent } from '@/misc/signup-user-agent.js';
import type Logger from '@/logger.js';
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';

// bsky-fork 独自: 新規登録 (POST /api/signup) の送信元 IP を、データセンター / VPN / プロキシの
// IP 範囲の一覧と照合し、該当すれば登録を拒否する。一般の回線 (家庭、携帯電話) からの登録だけを
// 受け付けるための仕組み。ログインや投稿など、登録以外の操作は判定しない。
//
// 背景: 2026-11 に LLM で自動化された宣伝目的の登録が、すべて CDN の出口 (Fastly) から来た。
// CAPTCHA とメール確認は自動で通過され、登録は数日に数件なので回数制限にもかからない。
// 正規ユーザーの登録元は全員が国内 ISP の帯だった。
//
// 一覧の取得と保持:
// - 既定では X4BNet/lists_vpn (MIT) の datacenter 一覧 (IPv4 と IPv6) を使う。config で差し替え・追加できる
// - 一覧は Redis に保持し (TTL なし)、起動時に Redis から読み込む。refreshIntervalHours より古ければ取り直す
// - 取り直しは Redis のロックで 1 プロセスだけが行い、他のプロセスは定期的に Redis を見て取り込む
// - 取得した一覧の件数が少なすぎるとき (空の応答、障害ページなど) は古い一覧を使い続ける
// - 一覧が一度も取れていない間は拒否しない (fail-open)。防御の穴にはなるが、取得失敗で登録を全部止めない
// - config の allowCidrs は一覧より優先して許可する。denyCidrs は一覧に無い範囲を追加で拒否する
// - config の denyUserAgents (正規表現) に User-Agent が当たる登録も拒否する (checkUserAgent)。既定は空
// - テスト (NODE_ENV=test) では外部へ取りに行かない

const FETCH_TIMEOUT_MS = 60 * 1000;
const FETCH_MAX_BYTES = 32 * 1024 * 1024;
const LOCK_TTL_SEC = 10 * 60;
const RELOAD_CHECK_MS = 10 * 60 * 1000;
const LOCK_FOLLOWER_RELOAD_MS = 60 * 1000;

export type SignupDenyReason = 'blocklist' | 'denyCidrs' | 'userAgent';

export type SignupIpCheckResult =
	| { allowed: true }
	| { allowed: false; reason: SignupDenyReason };

@Injectable()
export class SignupIpBlocklistService implements OnModuleInit, OnApplicationShutdown {
	private logger: Logger;
	private blocklist: IpRangeSet = new IpRangeSet([]);
	private allowSet: IpRangeSet;
	private denySet: IpRangeSet;
	private denyUserAgents: RegExp[];
	private loadedFetchedAt: number | null = null;
	private reloadTimer: NodeJS.Timeout | null = null;
	private refreshing: Promise<void> | null = null;
	private warnedEmpty = false;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		private httpRequestService: HttpRequestService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('signup-ip-blocklist');
		this.allowSet = this.buildConfigSet('allowCidrs', this.config.signupIpBlocklist.allowCidrs);
		this.denySet = this.buildConfigSet('denyCidrs', this.config.signupIpBlocklist.denyCidrs);
		const { regexps, invalid } = compileUserAgentPatterns(this.config.signupIpBlocklist.denyUserAgents);
		if (invalid.length > 0) this.logger.warn(`denyUserAgents: ${invalid.length} patterns could not be compiled and were ignored`);
		if (regexps.length > 0) this.logger.info(`denyUserAgents: ${regexps.length} patterns`);
		this.denyUserAgents = regexps;
	}

	private get settings() {
		return this.config.signupIpBlocklist;
	}

	private get keyPrefix(): string {
		return `${this.config.redis.prefix}:signupIpBlocklist`;
	}

	@bindThis
	private buildConfigSet(name: string, cidrs: string[]): IpRangeSet {
		const { set, invalid } = IpRangeSet.fromCidrLines(cidrs);
		if (invalid > 0) this.logger.warn(`${name}: ${invalid} entries could not be parsed and were ignored`);
		return set;
	}

	@bindThis
	public async onModuleInit(): Promise<void> {
		if (!this.settings.enabled) {
			this.logger.info('disabled by config');
			return;
		}
		await this.loadFromRedis().catch(err => this.logger.error('failed to load list from redis', { err }));
		if (process.env.NODE_ENV === 'test') return;

		if (this.isStale()) {
			this.refresh()
				.then(() => {
					// ロックを取れなかったプロセスは、取得した側が Redis に書き終わるのを少し待って読み込む
					if (this.blocklist.size === 0) {
						setTimeout(() => {
							this.loadFromRedis().catch(err => this.logger.error('delayed load failed', { err }));
						}, LOCK_FOLLOWER_RELOAD_MS).unref();
					}
				})
				.catch(err => this.logger.error('initial refresh failed', { err }));
		}
		this.reloadTimer = setInterval(() => {
			this.loadFromRedis()
				.then(async () => {
					if (this.isStale()) await this.refresh();
				})
				.catch(err => this.logger.error('periodic reload failed', { err }));
		}, RELOAD_CHECK_MS);
		this.reloadTimer.unref();
	}

	@bindThis
	public onApplicationShutdown(): void {
		if (this.reloadTimer != null) {
			clearInterval(this.reloadTimer);
			this.reloadTimer = null;
		}
	}

	/**
	 * 登録を受け付けてよい送信元かを返す。
	 */
	@bindThis
	public check(ip: string | null | undefined): SignupIpCheckResult {
		if (!this.settings.enabled || ip == null) return { allowed: true };
		if (this.allowSet.has(ip)) return { allowed: true };
		if (this.denySet.has(ip)) return { allowed: false, reason: 'denyCidrs' };
		if (this.blocklist.size === 0) {
			if (!this.warnedEmpty) {
				this.warnedEmpty = true;
				this.logger.warn('blocklist is empty (not fetched yet or fetch failed); allowing signups until a list is available');
			}
			return { allowed: true };
		}
		if (this.blocklist.has(ip)) return { allowed: false, reason: 'blocklist' };
		return { allowed: true };
	}

	/**
	 * User-Agent が config の denyUserAgents に当たらないかを返す。
	 */
	@bindThis
	public checkUserAgent(userAgent: string | null | undefined): SignupIpCheckResult {
		if (!this.settings.enabled) return { allowed: true };
		if (matchesUserAgent(this.denyUserAgents, userAgent)) return { allowed: false, reason: 'userAgent' };
		return { allowed: true };
	}

	/** 拒否した登録をログに残す (運用で誤判定を追えるように) */
	@bindThis
	public logDenied(ip: string | null | undefined, reason: SignupDenyReason, username?: unknown, userAgent?: string | null): void {
		// username と UA は検証前の生の入力なので、改行などでログ行を偽装されないように JSON で書く
		const ua = reason === 'userAgent' && typeof userAgent === 'string' ? ` ua=${JSON.stringify(userAgent.slice(0, 200))}` : '';
		this.logger.info(`denied signup from ${ip ?? '(unknown)'} (${reason}) username=${typeof username === 'string' ? JSON.stringify(username.slice(0, 64)) : '(none)'}${ua}`);
	}

	/** 保持している一覧の状態 (ログや運用確認用) */
	@bindThis
	public status(): { enabled: boolean; ranges: number; fetchedAt: Date | null } {
		return {
			enabled: this.settings.enabled,
			ranges: this.blocklist.size,
			fetchedAt: this.loadedFetchedAt != null ? new Date(this.loadedFetchedAt) : null,
		};
	}

	@bindThis
	private isStale(): boolean {
		if (this.loadedFetchedAt == null) return true;
		return Date.now() - this.loadedFetchedAt > this.settings.refreshIntervalHours * 60 * 60 * 1000;
	}

	@bindThis
	private async loadFromRedis(): Promise<void> {
		const fetchedAtRaw = await this.redisClient.get(`${this.keyPrefix}:fetchedAt`);
		const fetchedAt = fetchedAtRaw != null ? Number(fetchedAtRaw) : null;
		if (fetchedAt == null || Number.isNaN(fetchedAt)) return;
		if (this.loadedFetchedAt === fetchedAt && this.blocklist.size > 0) return;

		const text = await this.redisClient.get(`${this.keyPrefix}:entries`);
		if (text == null) return;
		const { set, valid, invalid } = IpRangeSet.fromCidrLines(text.split('\n'));
		this.blocklist = set;
		this.loadedFetchedAt = fetchedAt;
		this.logger.info(`loaded ${valid} entries (${set.size} merged ranges, ${invalid} invalid) fetched at ${new Date(fetchedAt).toISOString()}`);
	}

	/**
	 * 一覧を取り直して Redis に保存する。複数プロセスのうち 1 つだけが実行する。
	 */
	@bindThis
	public async refresh(): Promise<void> {
		if (this.refreshing != null) return this.refreshing;
		this.refreshing = this.refreshInner().finally(() => {
			this.refreshing = null;
		});
		return this.refreshing;
	}

	@bindThis
	private async refreshInner(): Promise<void> {
		const lockKey = `${this.keyPrefix}:lock`;
		const locked = await this.redisClient.set(lockKey, String(process.pid), 'EX', LOCK_TTL_SEC, 'NX');
		if (locked !== 'OK') {
			this.logger.debug('another process is refreshing the list');
			return;
		}
		try {
			// どれか 1 つでも取れなければ今回は保存しない (IPv4 だけの一覧で IPv6 を素通りさせないため)
			const lines: string[] = [];
			for (const url of this.settings.sources) {
				try {
					const res = await this.httpRequestService.send(url, {
						method: 'GET',
						headers: { Accept: 'text/plain, */*' },
						timeout: FETCH_TIMEOUT_MS,
						size: FETCH_MAX_BYTES,
					});
					const text = await res.text();
					const count = lines.length;
					lines.push(...text.split('\n'));
					this.logger.info(`fetched ${lines.length - count} lines from ${url}`);
				} catch (err) {
					this.logger.error(`failed to fetch ${url}; keeping the previous list`, { err });
					return;
				}
			}

			const { set, valid, invalid } = IpRangeSet.fromCidrLines(lines);
			if (valid < this.settings.minEntries) {
				this.logger.warn(`fetched list has only ${valid} valid entries (${invalid} invalid, minEntries=${this.settings.minEntries}); keeping the previous list`);
				return;
			}

			const fetchedAt = Date.now();
			const normalized = lines.map(l => l.replace(/#.*$/, '').trim()).filter(l => l !== '').join('\n');
			await this.redisClient.multi()
				.set(`${this.keyPrefix}:entries`, normalized)
				.set(`${this.keyPrefix}:fetchedAt`, String(fetchedAt))
				.exec();
			this.blocklist = set;
			this.loadedFetchedAt = fetchedAt;
			this.logger.info(`updated: ${valid} entries (${set.size} merged ranges, ${invalid} invalid)`);
		} finally {
			await this.redisClient.del(lockKey).catch(() => undefined);
		}
	}
}
