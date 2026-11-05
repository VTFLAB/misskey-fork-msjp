/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as Path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { PLAMO_MODEL } from '@/core/plamo/PlamoModelService.js';
import { PlamoModelServerService } from '@/server/plamo/PlamoModelServerService.js';
import { AuthenticationError } from '@/server/api/AuthenticateService.js';
import type { PlamoModelService } from '@/core/plamo/PlamoModelService.js';
import type { AuthenticateService } from '@/server/api/AuthenticateService.js';
import type { FastifyInstance } from 'fastify';

describe('PlamoModelServerService', () => {
	let dir: string;
	let ready = false;
	let fastify: FastifyInstance;
	const url = `/plamo-model/${PLAMO_MODEL.revision}/${PLAMO_MODEL.file}`;
	const auth = { authorization: 'Bearer valid-token' };

	beforeAll(async () => {
		dir = fs.mkdtempSync(Path.join(os.tmpdir(), 'plamo-model-test-'));
		fs.writeFileSync(Path.join(dir, PLAMO_MODEL.file), 'GGUF-test-body');
		const fakeModelService = {
			isReady: () => ready,
			getModelDir: () => dir,
		} as unknown as PlamoModelService;
		const fakeAuthenticateService = {
			authenticate: async (token: string) => {
				if (token === 'valid-token') return [{ id: 'user' }, null];
				throw new AuthenticationError('invalid token');
			},
		} as unknown as AuthenticateService;
		fastify = Fastify();
		await fastify.register(fastifyStatic, { root: dir, serve: false });
		await fastify.register(new PlamoModelServerService(fakeModelService, fakeAuthenticateService).createServer, { prefix: '/plamo-model' });
		await fastify.ready();
	});

	afterAll(async () => {
		await fastify.close();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('returns 404 for anything but the pinned model', async () => {
		ready = true;
		const res = await fastify.inject({ method: 'GET', url: `/plamo-model/${PLAMO_MODEL.revision}/other.gguf` });
		expect(res.statusCode).toBe(404);
		const res2 = await fastify.inject({ method: 'GET', url: `/plamo-model/main/${PLAMO_MODEL.file}` });
		expect(res2.statusCode).toBe(404);
	});

	test('requires a signed-in user', async () => {
		ready = true;
		expect((await fastify.inject({ method: 'GET', url })).statusCode).toBe(401);
		expect((await fastify.inject({ method: 'GET', url, headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(401);
		expect((await fastify.inject({ method: 'HEAD', url })).statusCode).toBe(401);
	});

	test('returns 503 until the server has the model', async () => {
		ready = false;
		const res = await fastify.inject({ method: 'GET', url, headers: auth });
		expect(res.statusCode).toBe(503);
		expect(res.headers['retry-after']).toBe('600');
		const head = await fastify.inject({ method: 'HEAD', url, headers: auth });
		expect(head.statusCode).toBe(503);
	});

	test('serves the model with long-lived private caching and ranges', async () => {
		ready = true;
		const res = await fastify.inject({ method: 'GET', url, headers: auth });
		expect(res.statusCode).toBe(200);
		expect(res.body).toBe('GGUF-test-body');
		expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
		const head = await fastify.inject({ method: 'HEAD', url, headers: auth });
		expect(head.statusCode).toBe(200);
		const range = await fastify.inject({ method: 'GET', url, headers: { ...auth, range: 'bytes=0-3' } });
		expect(range.statusCode).toBe(206);
		expect(range.body).toBe('GGUF');
	});
});
