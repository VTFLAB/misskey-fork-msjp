/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as Path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { PLAMO_MODEL, PlamoModelService } from '@/core/plamo/PlamoModelService.js';
import type { Config } from '@/config.js';
import type { HttpRequestService } from '@/core/HttpRequestService.js';
import type { LoggerService } from '@/core/LoggerService.js';

describe('PlamoModelService', () => {
	let rootDir: string;
	let requestedUrls: string[];

	const create = (body: Buffer) => {
		const http = {
			send: async (url: string) => {
				requestedUrls.push(url);
				return { body: Readable.from([body]) };
			},
		} as unknown as HttpRequestService;
		const logger = { info: () => {}, succ: () => {}, error: () => {}, warn: () => {} };
		const loggerService = { getLogger: () => logger } as unknown as LoggerService;
		return new PlamoModelService({ rootDir } as Config, http, loggerService);
	};

	beforeEach(() => {
		rootDir = fs.mkdtempSync(Path.join(os.tmpdir(), 'plamo-model-service-'));
		requestedUrls = [];
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	test('keeps the model under files/plamo/<revision>/', () => {
		const service = create(Buffer.from(''));
		expect(service.getModelPath()).toBe(Path.join(rootDir, 'files', 'plamo', PLAMO_MODEL.revision, PLAMO_MODEL.file));
		expect(service.isReady()).toBe(false);
	});

	test('downloads the pinned revision and rejects a file that does not match', async () => {
		const service = create(Buffer.from('not the model'));
		await expect(service.ensureDownloaded()).rejects.toThrow(/does not match/);
		expect(requestedUrls).toEqual([`https://huggingface.co/${PLAMO_MODEL.repo}/resolve/${PLAMO_MODEL.revision}/${PLAMO_MODEL.file}`]);
		expect(fs.existsSync(service.getModelPath())).toBe(false);
		expect(fs.existsSync(`${service.getModelPath()}.part`)).toBe(false);
		expect(service.isReady()).toBe(false);
	});

	test('does not download again once the model is in place', async () => {
		const service = create(Buffer.from(''));
		fs.mkdirSync(service.getModelDir(), { recursive: true });
		fs.closeSync(fs.openSync(service.getModelPath(), 'w'));
		fs.truncateSync(service.getModelPath(), PLAMO_MODEL.size);
		expect(service.isReady()).toBe(true);
		await service.ensureDownloaded();
		expect(requestedUrls).toEqual([]);
	});
});
