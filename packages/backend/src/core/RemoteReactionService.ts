/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { MiNote } from '@/models/Note.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { CustomEmojiService } from '@/core/CustomEmojiService.js';
import { ReactionService } from '@/core/ReactionService.js';
import { UtilityService } from '@/core/UtilityService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { bindThis } from '@/decorators.js';
import { pickReactionEntries } from '@/misc/remote-reactions.js';
import type Logger from '@/logger.js';
import type { RemoteReactionsSnapshot, RemoteReactionsDiff } from '@/misc/remote-reactions.js';

export type { RemoteReactionsSnapshot, RemoteReactionsDiff } from '@/misc/remote-reactions.js';

// bsky-fork 独自: リモートノートのリアクションを元サーバーから取得する。
//
// ActivityPub の Like はリアクションした人のフォロワーがいるサーバーにしか届かないため、
// 自サーバーが知らないユーザーのリアクションは元のノートに付いていても見えない。
// 元サーバーの公開 API (Misskey 系は notes/show、Mastodon 系は statuses/:id) からリアクション数を
// 取得して Redis に置き、自サーバーの集計と合わせて (種類ごとに大きい方を採用して) 表示する。
// リアクションしたユーザーの一覧までは取得しないので、一覧には自サーバーが知っている分だけが出る。
//
// 取得は閲覧をきっかけに行う (notes/remote-reactions endpoint)。元サーバーへの負荷と、元サーバーの
// 応答 (信用できない) による自サーバーへの影響を抑えるため、次の制限を持つ。
// - ノートごとの鮮度 (FRESH_MS) と、取得中ロック (プロセス間、所有者だけが解放できる)
// - 同時取得数の上限 (全体と、相手ホストごと) と、取得待ちの総数の上限
// - 非対応サーバーのホスト単位の失敗記憶、連合を許可していないホストの除外
// - 応答から取り込むリアクションの種類数・キー長・絵文字取得数の上限と、キーの検証

type RemoteOrigin = {
	kind: 'misskey' | 'mastodon';
	host: string;
	apiBase: string;
	remoteId: string;
};

const FRESH_MS = 1000 * 60 * 10;
/** 定期取得 (fetchDiffs) に合流させる取得済みデータの最長期間。これより古いものは取り直されるまで使わない */
const CACHED_MAX_AGE_MS = 1000 * 60 * 60;
const SNAPSHOT_TTL_SEC = 60 * 60 * 24 * 7;
const HOST_FAIL_TTL_SEC = 60 * 60;
const EMOJI_TTL_SEC = 60 * 60 * 24 * 7;
const EMOJI_MISS_TTL_SEC = 60 * 60;
const LOCK_TTL_SEC = 20;
const LOCK_WAIT_POLL_MS = 300;
const FETCH_TIMEOUT_MS = 5000;
const MAX_CONCURRENT_FETCHES = 8;
const MAX_CONCURRENT_FETCHES_PER_HOST = 2;
const MAX_INFLIGHT = 256;
const MAX_REACTION_KINDS = 100;
const MAX_REACTION_KEY_LENGTH = 128;
const MAX_ORIGIN_EMOJI_FETCHES = 32;
const EMOJI_FETCH_CONCURRENCY = 4;
const FALLBACK_REACTION = '❤';

const MISSKEY_NOTE_PATH = /^\/notes\/([a-z0-9]+)$/;
const MASTODON_STATUS_PATH = /^\/users\/[^/]+\/statuses\/([0-9]+)$/;
const CUSTOM_EMOJI_REACTION = /^:([-\w]+)@([\w.-]+):$/;
const EMOJI_NAME = /^[-\w]+$/;

const RELEASE_LOCK_SCRIPT = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

class Semaphore {
	private running = 0;
	private waiters: (() => void)[] = [];

	constructor(private readonly limit: number) {}

	public get idle(): boolean {
		return this.running === 0 && this.waiters.length === 0;
	}

	public async run<T>(fn: () => Promise<T>): Promise<T> {
		if (this.running >= this.limit) {
			// 解放側がスロットを譲ってくれる (running は減らさない) ので、ここでは増やさない
			await new Promise<void>(resolve => this.waiters.push(resolve));
		} else {
			this.running++;
		}
		try {
			return await fn();
		} finally {
			const next = this.waiters.shift();
			if (next) {
				next();
			} else {
				this.running--;
			}
		}
	}
}

@Injectable()
export class RemoteReactionService {
	private logger: Logger;
	private inflight = new Map<string, Promise<RemoteReactionsSnapshot | null>>();
	private semaphore = new Semaphore(MAX_CONCURRENT_FETCHES);
	private hostSemaphores = new Map<string, Semaphore>();

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		private httpRequestService: HttpRequestService,
		private customEmojiService: CustomEmojiService,
		private reactionService: ReactionService,
		private utilityService: UtilityService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('remote-reactions');
	}

	/**
	 * 元サーバーから取得できる種類のノートかどうかを URI から判定する。
	 * URI のホストがノートの userHost と一致しないものや、連合を許可していないホストのものは扱わない。
	 */
	@bindThis
	public resolveOrigin(note: Pick<MiNote, 'uri' | 'userHost'>): RemoteOrigin | null {
		if (note.userHost == null || note.uri == null) return null;
		let url: URL;
		try {
			url = new URL(note.uri);
		} catch {
			return null;
		}
		if (url.protocol !== 'https:') return null;
		const host = this.utilityService.toPuny(url.host);
		if (host !== this.utilityService.toPuny(note.userHost)) return null;
		if (this.utilityService.isSelfHost(host)) return null;
		if (!this.utilityService.isFederationAllowedHost(host)) return null;

		const misskey = url.pathname.match(MISSKEY_NOTE_PATH);
		if (misskey) {
			return { kind: 'misskey', host, apiBase: `${url.origin}/api`, remoteId: misskey[1] };
		}
		const mastodon = url.pathname.match(MASTODON_STATUS_PATH);
		if (mastodon) {
			return { kind: 'mastodon', host, apiBase: `${url.origin}/api/v1`, remoteId: mastodon[1] };
		}
		return null;
	}

	/**
	 * Redis に置いてあるものだけを返す (元サーバーへは問い合わせない)。古すぎるものは返さない。
	 */
	@bindThis
	public async getCachedMany(noteIds: MiNote['id'][]): Promise<Map<MiNote['id'], RemoteReactionsSnapshot>> {
		const result = new Map<MiNote['id'], RemoteReactionsSnapshot>();
		if (noteIds.length === 0) return result;
		const values = await this.redisClient.mget(noteIds.map(id => this.snapshotKey(id)));
		const now = Date.now();
		for (let i = 0; i < noteIds.length; i++) {
			const snapshot = this.parseSnapshot(values[i]);
			if (snapshot && now - snapshot.fetchedAt <= CACHED_MAX_AGE_MS) result.set(noteIds[i], snapshot);
		}
		return result;
	}

	/**
	 * 鮮度の切れたものは元サーバーから取り直して返す。
	 * 未取得のノートは waitMs まで待ち、間に合わなかったものは結果に含めない (取得自体は続く)。
	 * 鮮度切れだが取得済みのものは古い値を返しつつ裏で取り直す。
	 */
	@bindThis
	public async getMany(notes: Pick<MiNote, 'id' | 'uri' | 'userHost'>[], waitMs = 6000): Promise<Map<MiNote['id'], RemoteReactionsSnapshot>> {
		const targets = notes
			.map(note => ({ note, origin: this.resolveOrigin(note) }))
			.filter((x): x is { note: Pick<MiNote, 'id' | 'uri' | 'userHost'>; origin: RemoteOrigin } => x.origin != null);
		const result = new Map<MiNote['id'], RemoteReactionsSnapshot>();
		if (targets.length === 0) return result;

		const ids = targets.map(x => x.note.id);
		const values = await this.redisClient.mget(ids.map(id => this.snapshotKey(id)));
		const now = Date.now();
		const deadline = now + waitMs;
		const waits: Promise<void>[] = [];

		for (let i = 0; i < targets.length; i++) {
			const { note, origin } = targets[i];
			const snapshot = this.parseSnapshot(values[i]);
			if (snapshot && now - snapshot.fetchedAt < FRESH_MS) {
				result.set(note.id, snapshot);
				continue;
			}
			const refresh = this.refresh(note.id, origin);
			if (snapshot) {
				result.set(note.id, snapshot);
				refresh.catch(() => {});
				continue;
			}
			waits.push(this.withDeadline(refresh, deadline).then(fresh => {
				if (fresh) result.set(note.id, fresh);
			}));
		}

		await Promise.all(waits);
		return result;
	}

	private snapshotKey(noteId: string): string {
		return `${this.config.redis.prefix}:remoteReactions:note:${noteId}`;
	}

	private lockKey(noteId: string): string {
		return `${this.config.redis.prefix}:remoteReactions:lock:${noteId}`;
	}

	private hostFailKey(host: string): string {
		return `${this.config.redis.prefix}:remoteReactions:hostFail:${host}`;
	}

	private emojiKey(host: string, name: string): string {
		return `${this.config.redis.prefix}:remoteReactions:emoji:${host}:${name}`;
	}

	private parseSnapshot(raw: string | null): RemoteReactionsSnapshot | null {
		if (raw == null) return null;
		try {
			const parsed = JSON.parse(raw) as Partial<Record<keyof RemoteReactionsSnapshot, unknown>>;
			if (typeof parsed.fetchedAt !== 'number' || typeof parsed.reactions !== 'object' || parsed.reactions == null) return null;
			return {
				fetchedAt: parsed.fetchedAt,
				reactions: parsed.reactions as Record<string, number>,
				reactionEmojis: (typeof parsed.reactionEmojis === 'object' && parsed.reactionEmojis != null ? parsed.reactionEmojis : {}) as Record<string, string>,
			};
		} catch {
			return null;
		}
	}

	private async withDeadline<T>(promise: Promise<T>, deadline: number): Promise<T | null> {
		const remaining = deadline - Date.now();
		if (remaining <= 0) return null;
		let timer: NodeJS.Timeout | undefined;
		const timeout = new Promise<null>(resolve => {
			timer = setTimeout(() => resolve(null), remaining);
		});
		try {
			return await Promise.race([promise, timeout]);
		} catch {
			return null;
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	private hostSemaphore(host: string): Semaphore {
		let semaphore = this.hostSemaphores.get(host);
		if (semaphore == null) {
			semaphore = new Semaphore(MAX_CONCURRENT_FETCHES_PER_HOST);
			this.hostSemaphores.set(host, semaphore);
		}
		return semaphore;
	}

	/**
	 * 同じノートの取得をプロセス内 (inflight) とプロセス間 (Redis ロック) で 1 本にまとめる。
	 * ロックは取得スロットを得てから取る (待ち行列の間に期限が切れないように)。
	 * ロックを取れなかった側は、取った側が書く結果を待つ。取得待ちが多すぎるときは積まない。
	 */
	@bindThis
	private refresh(noteId: string, origin: RemoteOrigin): Promise<RemoteReactionsSnapshot | null> {
		const existing = this.inflight.get(noteId);
		if (existing) return existing;
		if (this.inflight.size >= MAX_INFLIGHT) return Promise.resolve(null);

		const task = (async () => {
			if (await this.redisClient.exists(this.hostFailKey(origin.host))) return null;

			// ホストごとのスロットを先に取る (遅いホストの待ちが全体のスロットを占有しないように)
			const hostSemaphore = this.hostSemaphore(origin.host);
			try {
				return await hostSemaphore.run(() => this.semaphore.run(async () => {
					const token = randomUUID();
					const locked = await this.redisClient.set(this.lockKey(noteId), token, 'EX', LOCK_TTL_SEC, 'NX');
					if (locked !== 'OK') {
						return await this.waitForSnapshot(noteId, Date.now() + LOCK_TTL_SEC * 1000);
					}
					try {
						return await this.fetchAndStore(noteId, origin);
					} finally {
						await this.redisClient.eval(RELEASE_LOCK_SCRIPT, 1, this.lockKey(noteId), token).catch(() => {});
					}
				}));
			} finally {
				if (hostSemaphore.idle) this.hostSemaphores.delete(origin.host);
			}
		})();

		this.inflight.set(noteId, task);
		task.finally(() => {
			this.inflight.delete(noteId);
		}).catch(() => {});
		return task;
	}

	private async waitForSnapshot(noteId: string, deadline: number): Promise<RemoteReactionsSnapshot | null> {
		while (Date.now() < deadline) {
			await new Promise(resolve => setTimeout(resolve, LOCK_WAIT_POLL_MS));
			const raw = await this.redisClient.get(this.snapshotKey(noteId));
			const snapshot = this.parseSnapshot(raw);
			if (snapshot && Date.now() - snapshot.fetchedAt < FRESH_MS) return snapshot;
			if (!(await this.redisClient.exists(this.lockKey(noteId)))) return snapshot;
		}
		return null;
	}

	private async fetchAndStore(noteId: string, origin: RemoteOrigin): Promise<RemoteReactionsSnapshot | null> {
		let snapshot: RemoteReactionsSnapshot;
		try {
			const diff = origin.kind === 'misskey'
				? await this.fetchFromMisskey(origin)
				: await this.fetchFromMastodon(origin);
			snapshot = { fetchedAt: Date.now(), ...diff };
		} catch (err) {
			if (err instanceof UnsupportedOriginError) {
				this.logger.info(`${origin.host} does not answer ${origin.kind} API; skipping for a while: ${err.message}`);
				await this.redisClient.set(this.hostFailKey(origin.host), '1', 'EX', HOST_FAIL_TTL_SEC);
			} else {
				this.logger.warn(`failed to fetch reactions of ${noteId} from ${origin.host}: ${err instanceof Error ? err.message : String(err)}`);
			}
			// 失敗も鮮度の間は記憶して、閲覧のたびに元サーバーへ問い合わせないようにする
			snapshot = { fetchedAt: Date.now(), reactions: {}, reactionEmojis: {} };
		}

		await this.redisClient.set(this.snapshotKey(noteId), JSON.stringify(snapshot), 'EX', SNAPSHOT_TTL_SEC);
		return snapshot;
	}

	private async requestJson(url: string, init: { method: 'GET' | 'POST'; body?: string }): Promise<unknown> {
		const res = await this.httpRequestService.send(url, {
			method: init.method,
			body: init.body,
			headers: {
				Accept: 'application/json',
				...(init.body != null ? { 'Content-Type': 'application/json' } : {}),
			},
			timeout: FETCH_TIMEOUT_MS,
			size: 1024 * 1024,
		}, { throwErrorWhenResponseNotOk: false });

		const contentType = res.headers.get('content-type') ?? '';
		if (!contentType.includes('json')) {
			// 5xx の HTML (メンテナンス画面や中継サーバーのエラー) は一時的なものなので、ホスト単位では記憶しない
			if (res.status >= 500) throw new Error(`${res.status} ${contentType || 'no content-type'}`);
			throw new UnsupportedOriginError(`${res.status} ${contentType || 'no content-type'}`);
		}
		let body: unknown;
		try {
			body = await res.json();
		} catch {
			if (res.status >= 500) throw new Error(`${res.status} invalid JSON`);
			throw new UnsupportedOriginError(`${res.status} invalid JSON`);
		}
		if (!res.ok) {
			// 対応サーバーが返す業務エラー (NO_SUCH_NOTE、要認証など) はそのノートだけの失敗として扱う
			throw new Error(`${res.status} ${JSON.stringify(body).slice(0, 200)}`);
		}
		return body;
	}

	/**
	 * Unicode 絵文字 (と旧形式の名前) のキーだけを通す。絵文字でない文字列は捨てる。
	 */
	private normalizeUnicodeReaction(rawKey: string): string | null {
		// 旧形式の名前 (like, love など) は先に絵文字へ変えてから検証する
		const legacyConverted = this.reactionService.convertLegacyReaction(rawKey);
		const normalized = this.reactionService.normalize(legacyConverted);
		if (normalized === FALLBACK_REACTION && legacyConverted !== FALLBACK_REACTION && legacyConverted !== '❤️') return null;
		return normalized;
	}

	private async fetchFromMisskey(origin: RemoteOrigin): Promise<RemoteReactionsDiff> {
		const body = await this.requestJson(`${origin.apiBase}/notes/show`, {
			method: 'POST',
			body: JSON.stringify({ noteId: origin.remoteId }),
		}) as { reactions?: unknown; reactionEmojis?: unknown } | null;
		if (body == null || typeof body.reactions !== 'object' || body.reactions == null) {
			throw new UnsupportedOriginError('notes/show response has no reactions');
		}

		const selfHost = this.utilityService.toPuny(this.config.host);
		const originEmojiUrls = (typeof body.reactionEmojis === 'object' && body.reactionEmojis != null)
			? body.reactionEmojis as Record<string, unknown>
			: {};
		const localEmojis = await this.customEmojiService.localEmojisCache.fetch();
		const reactions: Record<string, number> = {};
		const reactionEmojis: Record<string, string> = {};
		const originLocalNames: string[] = [];
		const otherHostNames: string[] = [];

		for (const [rawKey, count] of pickReactionEntries(body.reactions, MAX_REACTION_KINDS, MAX_REACTION_KEY_LENGTH)) {
			const custom = rawKey.match(CUSTOM_EMOJI_REACTION);
			if (custom == null) {
				const key = this.normalizeUnicodeReaction(rawKey);
				if (key != null) reactions[key] = Math.max(reactions[key] ?? 0, count);
				continue;
			}
			const [, name, host] = custom;
			if (host === '.') {
				// 元サーバー自身の絵文字
				reactions[`:${name}@${origin.host}:`] = count;
				originLocalNames.push(name);
			} else if (this.utilityService.toPuny(host) === selfHost) {
				// 自サーバーの絵文字。自サーバーに実在するものだけを採用する (元サーバーの申告でなりすまされないように)
				const local = localEmojis.get(name);
				if (local == null || local.isSensitive) continue;
				reactions[`:${name}@.:`] = count;
			} else {
				// 自サーバーの集計キー (emoji.host) に合わせて puny 表記にそろえる
				const punyHost = this.utilityService.toPuny(host);
				reactions[`:${name}@${punyHost}:`] = count;
				otherHostNames.push(`${name}@${punyHost}`);
			}
		}

		// 第三者サーバーの絵文字は自サーバーの emoji テーブルを優先し、無ければ元サーバーの申告する URL を使う
		const knownOtherHost: Record<string, string | undefined> = await this.customEmojiService.populateEmojis(otherHostNames, null);
		for (const nameWithHost of otherHostNames) {
			const known = knownOtherHost[nameWithHost];
			const reported = originEmojiUrls[nameWithHost];
			if (known != null) {
				reactionEmojis[nameWithHost] = known;
			} else if (typeof reported === 'string' && this.isHttpsUrl(reported)) {
				reactionEmojis[nameWithHost] = reported;
			}
		}

		const resolved = await this.resolveOriginEmojis(origin, originLocalNames);
		for (const [name, url] of resolved) {
			reactionEmojis[`${name}@${origin.host}`] = url;
		}

		return { reactions, reactionEmojis };
	}

	private async fetchFromMastodon(origin: RemoteOrigin): Promise<RemoteReactionsDiff> {
		const body = await this.requestJson(`${origin.apiBase}/statuses/${origin.remoteId}`, { method: 'GET' }) as {
			favourites_count?: unknown;
			pleroma?: { emoji_reactions?: unknown };
		} | null;
		if (body == null || typeof body.favourites_count !== 'number') {
			throw new UnsupportedOriginError('statuses response has no favourites_count');
		}

		const reactions: Record<string, number> = {};
		const reactionEmojis: Record<string, string> = {};
		if (Number.isSafeInteger(body.favourites_count) && body.favourites_count > 0) {
			reactions[FALLBACK_REACTION] = body.favourites_count;
		}

		// Pleroma / Akkoma の絵文字リアクション
		const emojiReactions = body.pleroma?.emoji_reactions;
		if (Array.isArray(emojiReactions)) {
			const source: Record<string, number> = {};
			const urls = new Map<string, string>();
			for (const item of emojiReactions.slice(0, MAX_REACTION_KINDS * 2) as { name?: unknown; count?: unknown; url?: unknown }[]) {
				if (typeof item.name !== 'string' || typeof item.count !== 'number') continue;
				if (typeof item.url === 'string') {
					if (!this.isHttpsUrl(item.url) || !EMOJI_NAME.test(item.name)) continue;
					source[`:${item.name}@${origin.host}:`] = item.count;
					urls.set(`${item.name}@${origin.host}`, item.url);
				} else if (item.url == null) {
					source[item.name] = item.count;
				}
			}
			for (const [rawKey, count] of pickReactionEntries(source, MAX_REACTION_KINDS, MAX_REACTION_KEY_LENGTH)) {
				const custom = rawKey.match(CUSTOM_EMOJI_REACTION);
				if (custom) {
					reactions[rawKey] = count;
					const url = urls.get(`${custom[1]}@${custom[2]}`);
					if (url != null) reactionEmojis[`${custom[1]}@${custom[2]}`] = url;
				} else {
					const key = this.normalizeUnicodeReaction(rawKey);
					if (key != null) reactions[key] = Math.max(reactions[key] ?? 0, count);
				}
			}
		}

		return { reactions, reactionEmojis };
	}

	/**
	 * 元サーバー自身の絵文字の画像 URL を解決する。自サーバーの emoji テーブル → Redis → 元サーバーの emoji API の順。
	 * 元サーバーへ問い合わせる数は上限 (数の多い順) までに抑え、少しずつ並列で取る。
	 */
	private async resolveOriginEmojis(origin: RemoteOrigin, names: string[]): Promise<Map<string, string>> {
		const result = new Map<string, string>();
		if (names.length === 0) return result;

		const known: Record<string, string | undefined> = await this.customEmojiService.populateEmojis(names, origin.host);
		const missing: string[] = [];
		for (const name of names) {
			const url = known[name];
			if (url != null) {
				result.set(name, url);
			} else {
				missing.push(name);
			}
		}
		if (missing.length === 0) return result;

		const cachedValues = await this.redisClient.mget(missing.map(name => this.emojiKey(origin.host, name)));
		const toFetch: string[] = [];
		for (let i = 0; i < missing.length; i++) {
			const cached = cachedValues[i];
			if (cached == null) {
				toFetch.push(missing[i]);
			} else if (cached !== '') {
				result.set(missing[i], cached);
			}
		}

		// names は数の多い順に並んでいるので、先頭から上限までを取りに行く
		const queue = toFetch.slice(0, MAX_ORIGIN_EMOJI_FETCHES);
		const worker = async () => {
			for (let name = queue.shift(); name != null; name = queue.shift()) {
				let url = '';
				try {
					const body = await this.requestJson(`${origin.apiBase}/emoji`, {
						method: 'POST',
						body: JSON.stringify({ name }),
					}) as { url?: unknown } | null;
					if (body != null && typeof body.url === 'string' && this.isHttpsUrl(body.url)) url = body.url;
				} catch (err) {
					this.logger.debug(`emoji ${name}@${origin.host} not resolved: ${err instanceof Error ? err.message : String(err)}`);
				}
				await this.redisClient.set(this.emojiKey(origin.host, name), url, 'EX', url === '' ? EMOJI_MISS_TTL_SEC : EMOJI_TTL_SEC);
				if (url !== '') result.set(name, url);
			}
		};
		await Promise.all(Array.from({ length: Math.min(EMOJI_FETCH_CONCURRENCY, queue.length) }, () => worker()));

		return result;
	}

	private isHttpsUrl(value: string): boolean {
		try {
			return new URL(value).protocol === 'https:';
		} catch {
			return false;
		}
	}
}

class UnsupportedOriginError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UnsupportedOriginError';
	}
}
