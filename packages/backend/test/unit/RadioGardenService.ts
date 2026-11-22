/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { describe, expect, test } from 'vitest';
import { RadioGardenService, isRelayableContentType, toRadioGardenLocale } from '@/core/radio/RadioGardenService.js';
import type { Config } from '@/config.js';
import type { HttpRequestService } from '@/core/HttpRequestService.js';
import type { LoggerService } from '@/core/LoggerService.js';
import type Redis from 'ioredis';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, succ: () => {} };

function createService(responses: Record<string, unknown>) {
	const calls: string[] = [];
	const httpRequestService = {
		send: async (url: string) => {
			calls.push(url);
			const path = url.replace('https://radio.garden/api', '');
			if (!(path in responses)) throw new Error(`unexpected request ${url}`);
			return { json: async () => responses[path] };
		},
	} as unknown as HttpRequestService;
	const store = new Map<string, string>();
	const redis = {
		set: async (key: string, value: string) => {
			store.set(key, value);
			return 'OK';
		},
		get: async (key: string) => store.get(key) ?? null,
	} as unknown as Redis.Redis;
	const loggerService = { getLogger: () => noopLogger } as unknown as LoggerService;
	const config = { userAgent: 'Misskey/test' } as Config;
	return { service: new RadioGardenService(config, redis, httpRequestService, loggerService), calls, store };
}

describe('RadioGardenService', () => {
	test('地点の一覧を列ごとの配列にし、不正な地点を落とし、書式制御文字を除く', async () => {
		const { service, calls } = createService({
			'/ara/content/places': {
				version: 'v1',
				data: {
					version: 'abc',
					list: [
						{ id: 'eR8K4rBb', title: 'Tokyo\u200B', country: 'Japan', geo: [139.6917123, 35.6895456], size: 11 },
						{ id: 'KXcDeFyY', title: 'Lyon', country: 'France', geo: [4.835659, 45.76404], size: 143 },
						{ id: 'bad id!', title: 'Broken', country: 'Nowhere', geo: [0, 0], size: 1 },
						{ id: 'NoGeo123', title: 'No geo', country: 'Japan', size: 1 },
						{ id: 'Osaka123', title: '\u202EOsaka', country: 'Japan', geo: [135.5, 34.69], size: 0 },
					],
				},
			},
		});
		const [a, b] = await Promise.all([service.getPlaces(), service.getPlaces()]);
		// 同時に来た要求でも 1 回しか取りに行かない
		expect(calls.length).toBe(1);
		expect(a).toBe(b);
		expect(a.version).toBe('abc');
		expect(a.ids).toEqual(['eR8K4rBb', 'KXcDeFyY', 'Osaka123']);
		expect(a.titles).toEqual(['Tokyo', 'Lyon', 'Osaka']);
		expect(a.countries).toEqual(['Japan', 'France']);
		expect(a.countryIndex).toEqual([0, 1, 0]);
		expect(a.geo).toEqual([139.692, 35.69, 4.836, 45.764, 135.5, 34.69]);
		expect(a.sizes).toEqual([11, 143, 1]);
		// 2 回目はキャッシュから返す
		await service.getPlaces();
		expect(calls.length).toBe(1);
	});

	test('地点の局の一覧から局だけを重複なしで取り出す', async () => {
		const page = (url: string, title: string, secure: boolean) => ({
			page: { url, type: 'channel', title, secure, place: { id: 'eR8K4rBb', title: 'Tokyo' }, country: { id: 'g4h2RP28', title: 'Japan' } },
		});
		const { service } = createService({
			'/ara/content/page/eR8K4rBb/channels': {
				data: {
					title: 'Tokyo',
					content: [
						{ items: [page('/listen/afn-eagle/OjFb4M9Q', 'AFN Eagle', true), page('/listen/pinoy/j5dZMbrn', 'Pinoy', false)] },
						{ items: [page('/listen/afn-eagle/OjFb4M9Q', 'AFN Eagle', true), { page: { url: '/visit/tokyo/eR8K4rBb', type: 'page', title: 'Tokyo' } }] },
					],
				},
			},
		});
		const res = await service.getPlaceChannels('eR8K4rBb');
		expect(res.title).toBe('Tokyo');
		expect(res.country).toBe('Japan');
		expect(res.channels).toEqual([
			{ id: 'OjFb4M9Q', title: 'AFN Eagle', placeId: 'eR8K4rBb', placeTitle: 'Tokyo', country: 'Japan', secure: true },
			{ id: 'j5dZMbrn', title: 'Pinoy', placeId: 'eR8K4rBb', placeTitle: 'Tokyo', country: 'Japan', secure: false },
		]);
	});

	test('検索結果を地点と局に分ける', async () => {
		const { service } = createService({
			'/search?q=Tokyo': {
				hits: {
					hits: [
						{ _source: { type: 'place', page: { map: 'eR8K4rBb', url: '/visit/tokyo/eR8K4rBb', title: 'Tokyo', subtitle: 'Japan', count: 11 } } },
						{ _source: { type: 'channel', page: { url: '/listen/listen-moe/XehO7lZ3', type: 'channel', title: 'Listen.moe', secure: true, place: { id: 'eR8K4rBb', title: 'Tokyo' }, country: { title: 'Japan' } } } },
						{ _source: { type: 'country', page: { url: '/visit/japan/g4h2RP28', title: 'Japan' } } },
					],
				},
			},
		});
		const res = await service.search(' Tokyo ');
		expect(res.places).toEqual([{ id: 'eR8K4rBb', title: 'Tokyo', country: 'Japan', count: 11 }]);
		expect(res.channels).toEqual([{ id: 'XehO7lZ3', title: 'Listen.moe', placeId: 'eR8K4rBb', placeTitle: 'Tokyo', country: 'Japan', secure: true }]);
	});

	test('Misskey の表示言語を Radio Garden の言語に対応させる', () => {
		expect(toRadioGardenLocale('ja-JP')).toBe('ja');
		expect(toRadioGardenLocale('ja-KS')).toBe('ja');
		expect(toRadioGardenLocale('ko-GS')).toBe('ko');
		expect(toRadioGardenLocale('zh-CN')).toBe('zh-Hans');
		expect(toRadioGardenLocale('zh-TW')).toBe('zh-Hant');
		expect(toRadioGardenLocale('pt-PT')).toBe('pt');
		expect(toRadioGardenLocale('pt-BR')).toBe('pt-BR');
		expect(toRadioGardenLocale('no-NO')).toBe('no');
		expect(toRadioGardenLocale('de-DE')).toBe('de');
		// 英語は hl を付けない。Radio Garden が訳していない言語も英語になる
		expect(toRadioGardenLocale('en-US')).toBeNull();
		expect(toRadioGardenLocale('ru-RU')).toBeNull();
		expect(toRadioGardenLocale('jbo-EN')).toBeNull();
		expect(toRadioGardenLocale('')).toBeNull();
		expect(toRadioGardenLocale(undefined)).toBeNull();
		expect(toRadioGardenLocale('ja&hl=en')).toBeNull();
	});

	test('表示言語を hl で渡し、キャッシュを言語ごとに分ける', async () => {
		const place = (title: string, country: string) => ({ data: { list: [{ id: 'vqzAr1BQ', title, country, geo: [-79.38, 43.65], size: 97 }] } });
		const channels = (placeTitle: string, country: string) => ({
			data: {
				title: placeTitle,
				content: [{ items: [{ page: { url: '/listen/680news/B3DfRJRH', type: 'channel', title: '680 News', secure: true, place: { id: 'vqzAr1BQ', title: placeTitle }, country: { title: country } } }] }],
			},
		});
		const { service, calls } = createService({
			'/ara/content/places': place('Toronto', 'Canada'),
			'/ara/content/places?hl=ja': place('トロント', 'カナダ'),
			'/ara/content/page/vqzAr1BQ/channels': channels('Toronto', 'Canada'),
			'/ara/content/page/vqzAr1BQ/channels?hl=ja': channels('トロント', 'カナダ'),
		});
		const [en, ja] = await Promise.all([service.getPlaces('en-US'), service.getPlaces('ja-JP')]);
		expect(en.titles).toEqual(['Toronto']);
		expect(ja.titles).toEqual(['トロント']);
		expect(ja.countries).toEqual(['カナダ']);
		expect((await service.getPlaceChannels('vqzAr1BQ')).channels[0].placeTitle).toBe('Toronto');
		const jaChannels = await service.getPlaceChannels('vqzAr1BQ', 'ja-JP');
		expect(jaChannels.title).toBe('トロント');
		expect(jaChannels.channels[0]).toMatchObject({ placeTitle: 'トロント', country: 'カナダ' });
		// 同じ言語の 2 回目はキャッシュから返す
		await service.getPlaces('ja-JP');
		await service.getPlaceChannels('vqzAr1BQ', 'ja-JP');
		expect(calls.length).toBe(4);
	});

	test('同じ言語の地点一覧の同時要求は 1 回の取得にまとめ、失敗したら次の要求で取り直す', async () => {
		const responses: Record<string, unknown> = {};
		const { service, calls } = createService(responses);
		const failed = await Promise.allSettled([service.getPlaces('ja-JP'), service.getPlaces('ja-JP')]);
		expect(failed.map(r => r.status)).toEqual(['rejected', 'rejected']);
		expect(calls.length).toBe(1);
		responses['/ara/content/places?hl=ja'] = { data: { list: [{ id: 'eR8K4rBb', title: '東京', country: '日本', geo: [139.69, 35.69], size: 11 }] } };
		// ja-JP と ja-KS はどちらも Radio Garden の ja なので、同じ一覧を共有する
		const [a, b] = await Promise.all([service.getPlaces('ja-JP'), service.getPlaces('ja-KS')]);
		expect(a).toBe(b);
		expect(a.titles).toEqual(['東京']);
		expect(calls.length).toBe(2);
	});

	test('検索は表示言語の地名で引け、半角カナをそろえてから送る', async () => {
		const result = (title: string, country: string) => ({
			hits: { hits: [{ _source: { type: 'place', page: { map: 'vqzAr1BQ', url: '/visit/toronto/vqzAr1BQ', title, subtitle: country, count: 97 } } }] },
		});
		const { service, calls } = createService({
			'/search?q=%E3%82%AB%E3%83%8A%E3%83%80&hl=ja': result('トロント', 'カナダ'),
			'/search?q=canada': result('Toronto', 'Canada'),
		});
		// 「ｶﾅﾀﾞ」(半角) は「カナダ」として送る
		const ja = await service.search('ｶﾅﾀﾞ', 'ja-JP');
		expect(ja.places).toEqual([{ id: 'vqzAr1BQ', title: 'トロント', country: 'カナダ', count: 97 }]);
		await service.search('カナダ', 'ja-JP');
		expect(calls.length).toBe(1);
		// 言語が違えば別に取りに行く
		const en = await service.search('canada', 'en-US');
		expect(en.places[0].title).toBe('Toronto');
		expect(calls.length).toBe(2);
	});

	test('中継のトークンは発行した局とユーザーにだけ結び付く', async () => {
		const { service, store } = createService({});
		const token = await service.issueStreamToken('user1', 'OjFb4M9Q');
		expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
		expect(await service.readStreamToken(token)).toEqual({ userId: 'user1', channelId: 'OjFb4M9Q' });
		expect(await service.readStreamToken('unknown-token-unknown-token')).toBeNull();
		store.set('radioGardenStream:broken', '{"userId":"u","channelId":"../../etc"}');
		expect(await service.readStreamToken('broken')).toBeNull();
	});

	test('音声として中継してよい Content-Type', () => {
		expect(isRelayableContentType('audio/mpeg')).toBe(true);
		expect(isRelayableContentType('audio/aacp; charset=UTF-8')).toBe(true);
		expect(isRelayableContentType('application/ogg')).toBe(true);
		expect(isRelayableContentType('application/octet-stream')).toBe(true);
		expect(isRelayableContentType('audio/x-mpegurl')).toBe(false);
		expect(isRelayableContentType('audio/x-scpls')).toBe(false);
		expect(isRelayableContentType('text/html')).toBe(false);
		expect(isRelayableContentType('')).toBe(false);
	});
});
