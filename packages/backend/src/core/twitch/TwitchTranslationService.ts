/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import { Injectable, Inject } from '@nestjs/common';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { RedisKVCache } from '@/misc/cache.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { TwitchLoggerService } from './TwitchLoggerService.js';

// LibreTranslate 互換 (LTEngine) サーバーとの通信に失敗した場合に投げる。
// 呼び出し側 (TwitchCommentService / エンドポイント) は必ずこれを catch し、
// 翻訳なしフォールバックで処理を継続すること (コメント配信・投稿をブロックしない)
export class TwitchTranslationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TwitchTranslationError';
	}
}

type LibreTranslateResponse = {
	translatedText: string;
};

const CACHE_LIFETIME = 1000 * 60 * 60 * 24; // 24h
const CACHE_MEMORY_LIFETIME = 1000 * 60 * 5; // 5min

@Injectable()
export class TwitchTranslationService {
	private logger: Logger;
	private cache: RedisKVCache<string> | null = null;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		private twitchLoggerService: TwitchLoggerService,
	) {
		this.logger = this.twitchLoggerService.child('translation');

		if (this.isEnabled) {
			// fetcher は使わない: RedisKVCache.fetch(key) は key (ハッシュ値) しか fetcher に渡せず
			// 元テキストを復元できないため、翻訳の実処理は translate() 内で get()/set() を直接呼ぶ形にする
			this.cache = new RedisKVCache<string>(this.redisClient, 'twitchCommentTranslation', {
				lifetime: CACHE_LIFETIME,
				memoryCacheLifetime: CACHE_MEMORY_LIFETIME,
				fetcher: () => { throw new TwitchTranslationError('unreachable: fetcher unused, translate() calls get()/set() directly.'); },
				toRedisConverter: (value) => value,
				fromRedisConverter: (value) => value,
			});
		}
	}

	public get isEnabled(): boolean {
		return this.config.twitchTranslation != null;
	}

	/**
	 * text を targetLang へ翻訳する。同一 (text, targetLang) の組は Redis に24時間キャッシュされる。
	 * 未設定・タイムアウト・サーバーエラー時は TwitchTranslationError を投げる。
	 * 呼び出し側は必ず catch して「翻訳なしで従来動作」にフォールバックすること。
	 *
	 * timeoutMs: CPU 推論のため長文は数十秒かかる (実測: 90語の英文で約23秒)。
	 * 非同期キュー経由は長め、投稿レスポンスを待たせる同期呼び出しは短めを
	 * 呼び出し側が指定する。省略時は config の timeout
	 */
	@bindThis
	public async translate(text: string, targetLang: 'ja' | 'en', timeoutMs?: number): Promise<string> {
		if (!this.isEnabled || this.cache == null) {
			throw new TwitchTranslationError('Twitch comment translation is not configured.');
		}

		const key = createHash('sha256').update(`${targetLang} ${text}`).digest('hex');

		const cached = await this.cache.get(key);
		if (cached !== undefined) return cached;

		const translated = await this.callLtEngine(text, targetLang, timeoutMs);
		await this.cache.set(key, translated);
		return translated;
	}

	@bindThis
	private async callLtEngine(text: string, targetLang: 'ja' | 'en', timeoutMs?: number): Promise<string> {
		const twitchTranslation = this.config.twitchTranslation;
		if (twitchTranslation == null) {
			throw new TwitchTranslationError('Twitch comment translation is not configured.');
		}

		const ac = new AbortController();
		const timer = setTimeout(() => ac.abort(), timeoutMs ?? twitchTranslation.timeout);
		try {
			const res = await fetch(new URL('/translate', twitchTranslation.url).toString(), {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Accept': 'application/json',
				},
				body: JSON.stringify({
					q: text,
					source: targetLang === 'ja' ? 'en' : 'ja',
					target: targetLang,
					format: 'text',
				}),
				signal: ac.signal,
			});

			if (!res.ok) {
				const body = await res.text().catch(() => '');
				throw new TwitchTranslationError(`LTEngine HTTP ${res.status}: ${body.slice(0, 200)}`);
			}

			const json = await res.json() as LibreTranslateResponse;
			if (typeof json.translatedText !== 'string') {
				throw new TwitchTranslationError('LTEngine returned an unexpected response shape.');
			}
			return json.translatedText;
		} catch (err) {
			if (err instanceof TwitchTranslationError) throw err;
			this.logger.warn(`translation request failed: ${err instanceof Error ? err.message : err}`);
			throw new TwitchTranslationError(err instanceof Error ? err.message : String(err));
		} finally {
			clearTimeout(timer);
		}
	}
}
