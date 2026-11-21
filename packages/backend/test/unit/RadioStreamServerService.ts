/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { PassThrough } from 'node:stream';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import Fastify from 'fastify';
import { RadioStreamServerService } from '@/server/radio/RadioStreamServerService.js';
import { RadioGardenError } from '@/core/radio/RadioGardenService.js';
import type { RadioGardenService } from '@/core/radio/RadioGardenService.js';
import type { LoggerService } from '@/core/LoggerService.js';
import type { FastifyInstance } from 'fastify';

describe('RadioStreamServerService', () => {
	let fastify: FastifyInstance;
	const opened: { channelId: string; body: PassThrough; signal: AbortSignal }[] = [];

	beforeAll(async () => {
		const tokens: Record<string, { userId: string; channelId: string }> = {
			'aaaaaaaaaaaaaaaaaaaaaaaa': { userId: 'alice', channelId: 'OjFb4M9Q' },
			'bbbbbbbbbbbbbbbbbbbbbbbb': { userId: 'bob', channelId: 'deadDead' },
		};
		const fakeRadioGardenService = {
			readStreamToken: async (token: string) => tokens[token] ?? null,
			openStream: async (channelId: string, signal: AbortSignal) => {
				if (channelId === 'deadDead') throw new RadioGardenError('dead');
				const body = new PassThrough();
				// 応答のヘッダーは最初のデータと一緒に出る (実際の局は接続直後から音声を送ってくる)
				body.write(Buffer.from('ID3-audio'));
				opened.push({ channelId, body, signal });
				return { body, contentType: 'audio/mpeg' };
			},
		} as unknown as RadioGardenService;
		const loggerService = { getLogger: () => ({ info: () => {}, warn: () => {} }) } as unknown as LoggerService;
		fastify = Fastify();
		await fastify.register(new RadioStreamServerService(fakeRadioGardenService, loggerService).createServer, { prefix: '/radio-garden-stream' });
		await fastify.listen({ port: 0, host: '127.0.0.1' });
	});

	afterAll(async () => {
		for (const o of opened) o.body.end();
		await fastify.close();
	});

	function base(): string {
		const address = fastify.server.address();
		if (address == null || typeof address === 'string') throw new Error('no address');
		return `http://127.0.0.1:${address.port}/radio-garden-stream`;
	}

	test('トークンの形が違えば 404、知らないトークンなら 403', async () => {
		expect((await fetch(`${base()}/short`)).status).toBe(404);
		expect((await fetch(`${base()}/cccccccccccccccccccccccc`)).status).toBe(403);
	});

	test('局につなげなければ 502', async () => {
		const res = await fetch(`${base()}/bbbbbbbbbbbbbbbbbbbbbbbb`);
		expect(res.status).toBe(502);
		expect(res.headers.get('cache-control')).toBe('no-store');
	});

	test('音声を中継し、1 ユーザー 3 本を超えたら 429、利用者が切ったら上流も閉じる', async () => {
		const url = `${base()}/aaaaaaaaaaaaaaaaaaaaaaaa`;
		const c1 = new AbortController();
		const c2 = new AbortController();
		const r1 = await fetch(url, { signal: c1.signal });
		expect(r1.status).toBe(200);
		expect(r1.headers.get('content-type')).toBe('audio/mpeg');
		expect(r1.headers.get('cache-control')).toBe('no-store');
		const reader = r1.body!.getReader();
		const chunk = await reader.read();
		expect(Buffer.from(chunk.value!).toString()).toBe('ID3-audio');

		const r2 = await fetch(url, { signal: c2.signal });
		expect(r2.status).toBe(200);
		const c4 = new AbortController();
		const r4 = await fetch(url, { signal: c4.signal });
		expect(r4.status).toBe(200);
		expect((await fetch(url)).status).toBe(429);

		c1.abort();
		await reader.cancel().catch(() => {});
		// 切断が伝わるのを待つ
		for (let i = 0; i < 50 && !opened[0].signal.aborted; i++) await new Promise(resolve => setTimeout(resolve, 20));
		expect(opened[0].signal.aborted).toBe(true);

		// 1 本空いたので、もう 1 本つなげる
		const c3 = new AbortController();
		const r3 = await fetch(url, { signal: c3.signal });
		expect(r3.status).toBe(200);
		c2.abort();
		c3.abort();
		c4.abort();
	});
});
