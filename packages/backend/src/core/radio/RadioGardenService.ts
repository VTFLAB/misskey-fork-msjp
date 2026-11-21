/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as crypto from 'node:crypto';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import fetch from 'node-fetch';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { MemoryKVCache, MemorySingleCache } from '@/misc/cache.js';

// ラジオウィジェットのための Radio Garden (https://radio.garden) の中継 (bsky-fork 独自)。
// Radio Garden の API は他のオリジンからの CORS を許可しないので、サーバーが代わりに取得してキャッシュする。
// API の仕様は非公式の https://jonasrmichel.github.io/radio-garden-openapi/ による。
// - 地点の一覧 (約 1.3 万件、1.9MB) は 1 日、地点ごとの局の一覧は 1 時間、検索結果は 10 分キャッシュする
// - 局の音声は、ブラウザが局のサーバーから直接受けるのが基本。CORS を許可しない局と http の局だけ、
//   ストリームの中継 (server/radio/RadioStreamServerService) を使う。中継の URL は resolve で発行する
//   一時トークン (Redis、10 分) で守り、局の URL は毎回サーバーが Radio Garden から引き直す
//   (利用者が任意の URL を中継させることはできない)

const API_BASE = 'https://radio.garden/api';
const ID_RE = /^[A-Za-z0-9_-]{4,32}$/;
// 書式制御文字 (ゼロ幅スペース、双方向の制御文字など) を局名から除く。絵文字の結合 (U+200D) は残す
const INVISIBLE_RE = /(?!\u200D)[\p{Cc}\p{Cf}]/gu;
const STREAM_TOKEN_TTL_SEC = 60 * 10;
const STREAM_CONNECT_TIMEOUT_MS = 10 * 1000;
const SEARCH_LIMIT = 30;

export type RadioGardenPlaces = {
	version: string;
	ids: string[];
	titles: string[];
	countries: string[];
	// 地点ごとの countries の添字
	countryIndex: number[];
	// [経度0, 緯度0, 経度1, 緯度1, ...] (小数 3 桁)
	geo: number[];
	// 地点ごとの局の数
	sizes: number[];
};

export type RadioGardenChannel = {
	id: string;
	title: string;
	placeId: string | null;
	placeTitle: string;
	country: string;
	secure: boolean;
};

export type RadioGardenPlaceChannels = {
	placeId: string;
	title: string;
	country: string;
	channels: RadioGardenChannel[];
};

export type RadioGardenSearchPlace = {
	id: string;
	title: string;
	country: string;
	count: number;
};

export type RadioGardenSearchResult = {
	places: RadioGardenSearchPlace[];
	channels: RadioGardenChannel[];
};

export type RadioStreamTokenEntry = {
	userId: string;
	channelId: string;
};

type RgPlace = {
	id?: unknown;
	title?: unknown;
	country?: unknown;
	geo?: unknown;
	size?: unknown;
};

type RgChannelPage = {
	url?: unknown;
	type?: unknown;
	title?: unknown;
	place?: { id?: unknown; title?: unknown } | null;
	country?: { id?: unknown; title?: unknown } | null;
	subtitle?: unknown;
	secure?: unknown;
	map?: unknown;
	count?: unknown;
};

type RgPage = {
	data?: {
		title?: unknown;
		subtitle?: unknown;
		content?: { items?: { page?: RgChannelPage | null }[] | null }[] | null;
	} | null;
};

type RgSearch = {
	hits?: {
		hits?: { _source?: { type?: unknown; page?: RgChannelPage | null } | null }[] | null;
	} | null;
};

export class RadioGardenError extends Error {}

function cleanText(value: unknown, max = 200): string {
	return typeof value === 'string' ? value.replace(INVISIBLE_RE, '').trim().slice(0, max) : '';
}

export function isRadioGardenId(value: unknown): value is string {
	return typeof value === 'string' && ID_RE.test(value);
}

// "/listen/afn-eagle-810-am-tokyo/OjFb4M9Q" -> "OjFb4M9Q"
function idFromUrl(url: unknown): string | null {
	if (typeof url !== 'string') return null;
	const id = url.split('/').filter(x => x !== '').pop();
	return isRadioGardenId(id) ? id : null;
}

function toChannel(page: RgChannelPage | null | undefined): RadioGardenChannel | null {
	if (page == null || page.type !== 'channel') return null;
	const id = idFromUrl(page.url);
	if (id == null) return null;
	const placeId = page.place?.id;
	return {
		id,
		title: cleanText(page.title) || id,
		placeId: isRadioGardenId(placeId) ? placeId : null,
		placeTitle: cleanText(page.place?.title),
		country: cleanText(page.country?.title),
		secure: page.secure === true,
	};
}

// 音声として中継してよい Content-Type。プレイリスト (m3u / pls) や HTML は中継しない
export function isRelayableContentType(contentType: string): boolean {
	const type = contentType.split(';')[0].trim().toLowerCase();
	if (type === 'application/ogg' || type === 'application/octet-stream') return true;
	if (!type.startsWith('audio/')) return false;
	return !/(mpegurl|scpls|x-ms-asx)/.test(type);
}

@Injectable()
export class RadioGardenService {
	private logger: Logger;
	private placesCache = new MemorySingleCache<RadioGardenPlaces>(1000 * 60 * 60 * 24);
	private placesInflight: Promise<RadioGardenPlaces> | null = null;
	private channelsCache = new MemoryKVCache<RadioGardenPlaceChannels>(1000 * 60 * 60, 2000);
	private searchCache = new MemoryKVCache<RadioGardenSearchResult>(1000 * 60 * 10, 500);

	constructor(
		@Inject(DI.config)
		private config: Config,
		@Inject(DI.redis)
		private redisClient: Redis.Redis,
		private httpRequestService: HttpRequestService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('radio-garden');
	}

	private async getJson<T>(path: string): Promise<T> {
		try {
			const res = await this.httpRequestService.send(`${API_BASE}${path}`, {
				method: 'GET',
				headers: { Accept: 'application/json' },
				timeout: 15 * 1000,
				size: 8 * 1024 * 1024,
			});
			const json = await res.json() as unknown;
			if (json == null || typeof json !== 'object') throw new Error('not a JSON object');
			return json as T;
		} catch (err) {
			this.logger.warn(`failed to fetch ${path}: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
			throw new RadioGardenError('Radio Garden is unavailable');
		}
	}

	@bindThis
	public async getPlaces(): Promise<RadioGardenPlaces> {
		const cached = this.placesCache.get();
		if (cached != null) return cached;
		// 同時に来た要求で 1.9MB を何度も取らない
		this.placesInflight ??= this.fetchPlaces().finally(() => {
			this.placesInflight = null;
		});
		return await this.placesInflight;
	}

	private async fetchPlaces(): Promise<RadioGardenPlaces> {
		const json = await this.getJson<{ version?: unknown; data?: { list?: RgPlace[] | null; version?: unknown } | null }>('/ara/content/places');
		const list = json.data?.list;
		if (!Array.isArray(list)) throw new RadioGardenError('Unexpected places response');

		const places: RadioGardenPlaces = {
			version: cleanText(json.data?.version ?? json.version, 64),
			ids: [],
			titles: [],
			countries: [],
			countryIndex: [],
			geo: [],
			sizes: [],
		};
		const countryIndexOf = new Map<string, number>();
		for (const place of list) {
			if (!isRadioGardenId(place.id)) continue;
			if (!Array.isArray(place.geo) || place.geo.length < 2) continue;
			const [lon, lat] = place.geo;
			if (typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
			const country = cleanText(place.country, 100);
			let ci = countryIndexOf.get(country);
			if (ci == null) {
				ci = places.countries.length;
				places.countries.push(country);
				countryIndexOf.set(country, ci);
			}
			places.ids.push(place.id);
			places.titles.push(cleanText(place.title, 100) || place.id);
			places.countryIndex.push(ci);
			places.geo.push(Math.round(lon * 1000) / 1000, Math.round(lat * 1000) / 1000);
			places.sizes.push(typeof place.size === 'number' && place.size > 0 ? Math.round(place.size) : 1);
		}
		if (places.ids.length === 0) throw new RadioGardenError('Empty places response');
		this.placesCache.set(places);
		this.logger.info(`loaded ${places.ids.length} places`);
		return places;
	}

	@bindThis
	public async getPlaceChannels(placeId: string): Promise<RadioGardenPlaceChannels> {
		const cached = this.channelsCache.get(placeId);
		if (cached != null) return cached;

		const json = await this.getJson<RgPage>(`/ara/content/page/${encodeURIComponent(placeId)}/channels`);
		const channels: RadioGardenChannel[] = [];
		const seen = new Set<string>();
		for (const section of json.data?.content ?? []) {
			for (const item of section.items ?? []) {
				const channel = toChannel(item.page);
				if (channel == null || seen.has(channel.id)) continue;
				seen.add(channel.id);
				channels.push(channel);
			}
		}
		const result: RadioGardenPlaceChannels = {
			placeId,
			title: cleanText(json.data?.title, 100) || channels[0]?.placeTitle || placeId,
			country: channels[0]?.country ?? '',
			channels,
		};
		this.channelsCache.set(placeId, result);
		return result;
	}

	@bindThis
	public async search(query: string): Promise<RadioGardenSearchResult> {
		const key = query.trim().toLowerCase();
		const cached = this.searchCache.get(key);
		if (cached != null) return cached;

		const json = await this.getJson<RgSearch>(`/search?q=${encodeURIComponent(query.trim())}`);
		const result: RadioGardenSearchResult = { places: [], channels: [] };
		for (const hit of json.hits?.hits ?? []) {
			const source = hit._source;
			if (source == null) continue;
			if (source.type === 'channel' && result.channels.length < SEARCH_LIMIT) {
				const channel = toChannel(source.page);
				if (channel != null) result.channels.push(channel);
			} else if (source.type === 'place' && result.places.length < SEARCH_LIMIT) {
				const page = source.page;
				const id = page?.map ?? idFromUrl(page?.url);
				if (!isRadioGardenId(id)) continue;
				result.places.push({
					id,
					title: cleanText(page?.title, 100) || id,
					country: cleanText(page?.subtitle, 100),
					count: typeof page?.count === 'number' ? page.count : 0,
				});
			}
		}
		this.searchCache.set(key, result);
		return result;
	}

	// 局の音声の URL を Radio Garden のリダイレクトから得る。トークン付きの URL を返す局があるので、キャッシュしない
	@bindThis
	public async resolveStreamUrl(channelId: string): Promise<URL> {
		const listenUrl = `${API_BASE}/ara/content/listen/${encodeURIComponent(channelId)}/channel.mp3`;
		let location: string | null;
		let status: number;
		try {
			const res = await fetch(listenUrl, {
				method: 'GET',
				redirect: 'manual',
				headers: { 'User-Agent': this.config.userAgent },
				agent: (url) => this.httpRequestService.getAgentByUrl(url),
				signal: AbortSignal.timeout(STREAM_CONNECT_TIMEOUT_MS),
			});
			status = res.status;
			location = res.headers.get('location');
			res.body?.resume();
		} catch (err) {
			this.logger.warn(`failed to resolve channel ${channelId}: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
			throw new RadioGardenError('Radio Garden is unavailable');
		}
		if (status < 300 || status >= 400 || location == null) {
			throw new RadioGardenError(`No stream for channel (status ${status})`);
		}
		let url: URL;
		try {
			url = new URL(location, listenUrl);
		} catch {
			throw new RadioGardenError('Invalid stream URL');
		}
		if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new RadioGardenError('Invalid stream URL');
		return url;
	}

	@bindThis
	public async issueStreamToken(userId: string, channelId: string): Promise<string> {
		const token = crypto.randomBytes(24).toString('base64url');
		const entry: RadioStreamTokenEntry = { userId, channelId };
		await this.redisClient.set(`radioGardenStream:${token}`, JSON.stringify(entry), 'EX', STREAM_TOKEN_TTL_SEC);
		return token;
	}

	@bindThis
	public async readStreamToken(token: string): Promise<RadioStreamTokenEntry | null> {
		const raw = await this.redisClient.get(`radioGardenStream:${token}`);
		if (raw == null) return null;
		try {
			const entry = JSON.parse(raw) as Partial<RadioStreamTokenEntry>;
			if (typeof entry.userId !== 'string' || !isRadioGardenId(entry.channelId)) return null;
			return { userId: entry.userId, channelId: entry.channelId };
		} catch {
			return null;
		}
	}

	// 中継のために局の音声を開く。signal が中断されると上流の接続も閉じる
	@bindThis
	public async openStream(channelId: string, signal: AbortSignal): Promise<{ body: PassThrough; contentType: string }> {
		const url = await this.resolveStreamUrl(channelId);
		// 局の URL を引いている間に利用者が切っていたら、局にはつながない
		if (signal.aborted) throw new RadioGardenError('Aborted');

		// 応答のヘッダーが届くまでの待ち時間だけを区切る (本文は終わりのない生放送)
		const connect = new AbortController();
		const onAbort = () => connect.abort();
		signal.addEventListener('abort', onAbort, { once: true });
		const timer = setTimeout(() => connect.abort(), STREAM_CONNECT_TIMEOUT_MS);

		try {
			const res = await fetch(url.toString(), {
				method: 'GET',
				redirect: 'follow',
				follow: 5,
				size: 0,
				headers: {
					'User-Agent': this.config.userAgent,
					Accept: '*/*',
				},
				agent: (u) => this.httpRequestService.getAgentByUrl(u),
				signal: connect.signal,
			});
			clearTimeout(timer);
			const contentType = res.headers.get('content-type') ?? '';
			if (!res.ok || res.body == null || !isRelayableContentType(contentType)) {
				res.body?.resume();
				connect.abort();
				throw new RadioGardenError(`Unplayable stream (status ${res.status}, type ${contentType})`);
			}
			const body = new PassThrough();
			pipeline(res.body, body).catch(() => {
				// 利用者が閉じた・上限時間に達した・局が切れた。どれも中継を終えるだけでよい
			}).finally(() => {
				signal.removeEventListener('abort', onAbort);
			});
			return { body, contentType };
		} catch (err) {
			clearTimeout(timer);
			signal.removeEventListener('abort', onAbort);
			if (err instanceof RadioGardenError) throw err;
			throw new RadioGardenError(`Failed to open stream: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
}
