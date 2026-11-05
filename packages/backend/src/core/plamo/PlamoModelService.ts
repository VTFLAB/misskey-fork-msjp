/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as Path from 'node:path';
import cluster from 'node:cluster';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { LoggerService } from '@/core/LoggerService.js';

// 端末内翻訳 (PLaMo 3 Translate) のモデルをこのサーバーが持つ (bsky-fork 独自)。
// 利用者のブラウザを Hugging Face へ接続させないため、サーバーが起動時に一度だけ取得し、
// files ボリューム (<rootDir>/files/plamo/<revision>/) に置く。配信は server/plamo/PlamoModelServerService。
// - 取得は cluster の primary だけが行う (worker と重複して書かない)
// - 取得したファイルは大きさと sha256 を確かめてから、名前を変えて置く (途中のファイルは配信しない)

export const PLAMO_MODEL = {
	repo: 'pfnet/plamo-3-translate-0.8b-GGUF',
	revision: '03891e907db8a43c97d3a7c75add125cc6d1f96a',
	file: 'plamo-3-translate-0.8b-Q4_K_M.gguf',
	size: 573116288,
	// Hugging Face の X-Linked-Etag (LFS の sha256)
	sha256: '3dbb09295bfd3350231ba0dba92bc72cb14111ef1b034e37dad39d581bd86b9c',
} as const;

const DOWNLOAD_TIMEOUT_MS = 60 * 60 * 1000;
// 一時的な失敗 (回線、Hugging Face 側の障害) なら、時間を置いて取り直す
const RETRY_DELAY_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 5;

@Injectable()
export class PlamoModelService implements OnApplicationBootstrap {
	private logger: Logger;
	private downloading: Promise<void> | null = null;

	constructor(
		@Inject(DI.config)
		private config: Config,
		private httpRequestService: HttpRequestService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('plamo-model');
	}

	@bindThis
	public getModelDir(): string {
		return Path.resolve(this.config.rootDir, 'files', 'plamo', PLAMO_MODEL.revision);
	}

	@bindThis
	public getModelPath(): string {
		return Path.join(this.getModelDir(), PLAMO_MODEL.file);
	}

	/**
	 * モデルが取得済みで、配信できるか。
	 */
	@bindThis
	public isReady(): boolean {
		try {
			return fs.statSync(this.getModelPath()).size === PLAMO_MODEL.size;
		} catch {
			return false;
		}
	}

	public async onApplicationBootstrap(): Promise<void> {
		if (process.env.NODE_ENV === 'test' || process.env.PLAMO_MODEL_DISABLE_DOWNLOAD === '1') return;
		if (!cluster.isPrimary) return;
		// 起動を待たせないよう、裏で取得する
		this.downloadWithRetry(1);
	}

	private downloadWithRetry(attempt: number): void {
		this.ensureDownloaded().catch(err => {
			const message = err instanceof Error ? err.message : String(err);
			if (attempt >= MAX_ATTEMPTS) {
				this.logger.error(`failed to download the PLaMo model (attempt ${attempt}, giving up until the next restart): ${message}`);
				return;
			}
			this.logger.warn(`failed to download the PLaMo model (attempt ${attempt}, retrying in ${RETRY_DELAY_MS / 60000} minutes): ${message}`);
			setTimeout(() => this.downloadWithRetry(attempt + 1), RETRY_DELAY_MS).unref();
		});
	}

	@bindThis
	public ensureDownloaded(): Promise<void> {
		if (this.isReady()) return Promise.resolve();
		this.downloading ??= this.download().finally(() => { this.downloading = null; });
		return this.downloading;
	}

	private async download(): Promise<void> {
		const dir = this.getModelDir();
		const dest = this.getModelPath();
		const part = `${dest}.part`;
		await fs.promises.mkdir(dir, { recursive: true });

		const url = `https://huggingface.co/${PLAMO_MODEL.repo}/resolve/${PLAMO_MODEL.revision}/${PLAMO_MODEL.file}`;
		this.logger.info(`downloading ${url}`);
		const res = await this.httpRequestService.send(url, {
			timeout: DOWNLOAD_TIMEOUT_MS,
			size: PLAMO_MODEL.size,
		});
		if (res.body == null) throw new Error('empty response body');

		const hash = crypto.createHash('sha256');
		let bytes = 0;
		const meter = new Transform({
			transform(chunk: Buffer, _encoding, callback) {
				hash.update(chunk);
				bytes += chunk.length;
				callback(null, chunk);
			},
		});
		try {
			await pipeline(res.body, meter, fs.createWriteStream(part));
			const digest = hash.digest('hex');
			if (bytes !== PLAMO_MODEL.size || digest !== PLAMO_MODEL.sha256) {
				throw new Error(`downloaded file does not match (size ${bytes}, sha256 ${digest})`);
			}
			await fs.promises.rename(part, dest);
		} catch (err) {
			await fs.promises.rm(part, { force: true });
			throw err;
		}
		this.logger.succ(`the PLaMo model is ready (${bytes} bytes)`);
	}
}
