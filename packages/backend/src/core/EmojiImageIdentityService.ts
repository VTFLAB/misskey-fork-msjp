/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { DriveFilesRepository } from '@/models/_.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { CustomEmojiService } from '@/core/CustomEmojiService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { bindThis } from '@/decorators.js';
import { Semaphore } from '@/misc/semaphore.js';
import { groupReactionsByIdentity } from '@/misc/reaction-grouping.js';
import type Logger from '@/logger.js';
import type { GroupedReactions } from '@/misc/reaction-grouping.js';

// bsky-fork 独自: カスタム絵文字の「画像としての同一性」を決め、ホストが違うだけの同じ絵文字の
// リアクションを 1 つにまとめる。
//
// Misskey では同じ絵文字が多くのサーバーに取り込まれていて、同じ画像のリアクションが
// `:name@host1:` `:name@host2:` ... と別々に表示される。画像のファイル内容 (MD5) が同じものを
// 同一とみなしてまとめる。名前が同じでも画像が違えば別のまま。
//
// 同一性の求め方:
// - 自サーバーの絵文字: ドライブのファイルの md5 (DB にある)。ただし web 公開用に変換した画像を配っている絵文字は、
//   他サーバーが取り込むのはその変換後の画像なので、自分も公開 URL から取得して md5 を求める
// - 他サーバーの絵文字: 画像 URL から取得した内容の md5 (Redis に長期間保持。1 URL につき 1 回)
// 取得に失敗し続けるホストは 1 時間休む
// 取得は裏で行い、表示 (pack) では取得済みの分だけを使う。notes/remote-reactions では少し待つ。

const IDENTITY_TTL_SEC = 60 * 60 * 24 * 30;
const IDENTITY_MISS_TTL_SEC = 60 * 60;
const FETCH_TIMEOUT_MS = 5000;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_CONCURRENT_FETCHES = 4;
const MAX_INFLIGHT = 256;
const DEFAULT_WAIT_MS = 4000;
const HOST_FAIL_LIMIT = 10;
const HOST_FAIL_TTL_SEC = 60 * 60;

const CUSTOM_EMOJI_REACTION = /^:([-\w]+)@([\w.-]+):$/;

type IdentitySource = {
	key: string;
	kind: 'local' | 'remote';
	url: string;
};

@Injectable()
export class EmojiImageIdentityService {
	private logger: Logger;
	private inflight = new Map<string, Promise<string | null>>();
	private semaphore = new Semaphore(MAX_CONCURRENT_FETCHES);

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		private httpRequestService: HttpRequestService,
		private customEmojiService: CustomEmojiService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('emoji-identity');
	}

	/**
	 * 同じ画像のカスタム絵文字リアクションを合算する。
	 * reactionEmojis を省略すると、他サーバーの絵文字の URL を自サーバーの emoji テーブルから引く。
	 * wait を付けると、まだ同一性が分かっていない絵文字の画像取得を waitMs まで待つ。
	 */
	@bindThis
	public async group(reactions: Record<string, number>, opts: {
		noteUserHost: string | null;
		reactionEmojis?: Record<string, string>;
		wait?: boolean;
		waitMs?: number;
	}): Promise<GroupedReactions> {
		const customKeys = Object.keys(reactions).filter(key => CUSTOM_EMOJI_REACTION.test(key));
		let reactionEmojis = opts.reactionEmojis;
		if (reactionEmojis == null) {
			const remoteNames = customKeys
				.map(key => key.match(CUSTOM_EMOJI_REACTION))
				.filter((m): m is RegExpMatchArray => m != null && m[2] !== '.')
				.map(m => `${m[1]}@${m[2]}`);
			reactionEmojis = await this.customEmojiService.populateEmojis(remoteNames, opts.noteUserHost);
		}
		if (customKeys.length < 2) {
			return { reactions, reactionEmojis, keyMap: new Map() };
		}

		// 同一性の取得に失敗しても (Redis や DB の一時的な不調)、ノートの表示自体は止めない
		try {
			const sources = await this.collectSources(customKeys, reactionEmojis);
			const identities = await this.resolveIdentities(sources, opts.wait ?? false, opts.waitMs ?? DEFAULT_WAIT_MS);
			return groupReactionsByIdentity(reactions, reactionEmojis, key => identities.get(key) ?? null, opts.noteUserHost);
		} catch (err) {
			this.logger.warn(`grouping skipped: ${err instanceof Error ? err.message : String(err)}`);
			return { reactions, reactionEmojis, keyMap: new Map() };
		}
	}

	private async collectSources(customKeys: string[], reactionEmojis: Record<string, string>): Promise<IdentitySource[]> {
		const sources: IdentitySource[] = [];
		let localEmojis: Map<string, { originalUrl: string; publicUrl: string }> | null = null;
		for (const key of customKeys) {
			const match = key.match(CUSTOM_EMOJI_REACTION);
			if (match == null) continue;
			const [, name, host] = match;
			if (host === '.') {
				localEmojis ??= await this.customEmojiService.localEmojisCache.fetch();
				const emoji = localEmojis.get(name);
				if (emoji == null) continue;
				if (emoji.publicUrl === emoji.originalUrl || emoji.publicUrl === '') {
					sources.push({ key, kind: 'local', url: emoji.originalUrl });
				} else if (this.isHttpsUrl(emoji.publicUrl)) {
					sources.push({ key, kind: 'remote', url: emoji.publicUrl });
				}
			} else {
				const url = reactionEmojis[`${name}@${host}`] as string | undefined;
				if (url != null && this.isHttpsUrl(url)) sources.push({ key, kind: 'remote', url });
			}
		}
		return sources;
	}

	private identityKey(url: string): string {
		return `${this.config.redis.prefix}:emojiIdentity:${createHash('sha256').update(url).digest('hex').slice(0, 32)}`;
	}

	private hostFailKey(host: string): string {
		return `${this.config.redis.prefix}:emojiIdentity:hostFail:${host}`;
	}

	private async resolveIdentities(sources: IdentitySource[], wait: boolean, waitMs: number): Promise<Map<string, string>> {
		const result = new Map<string, string>();
		if (sources.length === 0) return result;

		const cached = await this.redisClient.mget(sources.map(source => this.identityKey(source.url)));
		const pending: Promise<void>[] = [];
		const deadline = Date.now() + waitMs;

		for (let i = 0; i < sources.length; i++) {
			const source = sources[i];
			const value = cached[i];
			if (value != null) {
				if (value !== '') result.set(source.key, value);
				continue;
			}
			const computing = this.compute(source);
			if (wait) {
				pending.push(this.withDeadline(computing, deadline).then(identity => {
					if (identity != null) result.set(source.key, identity);
				}));
			} else {
				computing.catch(() => {});
			}
		}

		await Promise.all(pending);
		return result;
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

	/**
	 * 同じ URL の計算は 1 本にまとめる。結果 (失敗は '') を Redis に書く。
	 */
	private compute(source: IdentitySource): Promise<string | null> {
		const existing = this.inflight.get(source.url);
		if (existing) return existing;
		if (this.inflight.size >= MAX_INFLIGHT) return Promise.resolve(null);

		const task = this.semaphore.run(async () => {
			let identity: string | null = null;
			try {
				identity = source.kind === 'local'
					? await this.identityOfLocalFile(source.url)
					: await this.identityOfRemoteImage(source.url);
			} catch (err) {
				this.logger.debug(`identity of ${source.url} not resolved: ${err instanceof Error ? err.message : String(err)}`);
			}
			await this.redisClient.set(this.identityKey(source.url), identity ?? '', 'EX', identity == null ? IDENTITY_MISS_TTL_SEC : IDENTITY_TTL_SEC);
			return identity;
		});

		this.inflight.set(source.url, task);
		task.finally(() => {
			this.inflight.delete(source.url);
		}).catch(() => {});
		return task;
	}

	private async identityOfLocalFile(url: string): Promise<string | null> {
		const file = await this.driveFilesRepository.findOne({
			where: [{ url }, { webpublicUrl: url }],
			select: { id: true, md5: true },
		});
		return file?.md5 ?? null;
	}

	private async identityOfRemoteImage(url: string): Promise<string | null> {
		const host = new URL(url).host;
		const failKey = this.hostFailKey(host);
		const failures = Number(await this.redisClient.get(failKey) ?? '0');
		if (failures >= HOST_FAIL_LIMIT) return null;

		try {
			const res = await this.httpRequestService.send(url, {
				method: 'GET',
				headers: { Accept: 'image/*' },
				timeout: FETCH_TIMEOUT_MS,
				size: MAX_IMAGE_BYTES,
			});
			const contentType = res.headers.get('content-type') ?? '';
			if (!contentType.startsWith('image/')) throw new Error(`unexpected content-type ${contentType || '(none)'}`);
			const bytes = Buffer.from(await res.arrayBuffer());
			if (bytes.length === 0) throw new Error('empty body');
			return createHash('md5').update(bytes).digest('hex');
		} catch (err) {
			// 失敗が続くホストは暫く取りに行かない (クエリ文字列を変えて URL 単位の失敗記憶をすり抜けられないように)
			await this.redisClient.multi().incr(failKey).expire(failKey, HOST_FAIL_TTL_SEC).exec().catch(() => {});
			throw err;
		}
	}

	private isHttpsUrl(value: string): boolean {
		try {
			return new URL(value).protocol === 'https:';
		} catch {
			return false;
		}
	}
}
