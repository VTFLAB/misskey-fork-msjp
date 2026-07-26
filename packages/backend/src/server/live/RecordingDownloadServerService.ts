/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import { DI } from '@/di-symbols.js';
import type { TwitchStreamsRepository } from '@/models/_.js';
import type { Config } from '@/config.js';
import { bindThis } from '@/decorators.js';
import { AuthenticateService, AuthenticationError } from '@/server/api/AuthenticateService.js';
import type Logger from '@/logger.js';
import { LiveLoggerService } from '@/core/live/LiveLoggerService.js';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

// retention 期間中のローカル録画 mp4 を配信者本人にダウンロードさせるルート (bsky-fork 独自、
// YouTube 12時間アーカイブ上限対策)。大容量 (数十GB) になるため ReadStream をそのまま reply に渡し、
// バッファリングしない。認証は /api と同じく query の `token` (Misskey access token) で行う
// (ブラウザの <a download> / video タグからはカスタムヘッダを付与できないため、query トークン方式が必須)。
//
// route: GET {url}/recording-download/:streamId?token=<Misskey access token>
@Injectable()
export class RecordingDownloadServerService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.twitchStreamsRepository)
		private twitchStreamsRepository: TwitchStreamsRepository,

		private authenticateService: AuthenticateService,
		private liveLoggerService: LiveLoggerService,
	) {
		this.logger = this.liveLoggerService.child('download-server');
	}

	@bindThis
	public createServer(fastify: FastifyInstance, options: FastifyPluginOptions, done: (err?: Error) => void) {
		fastify.get<{
			Params: { streamId: string };
			Querystring: { token?: string };
		}>('/:streamId', async (request, reply) => {
			const token = request.query.token;
			if (token == null) {
				reply.code(401);
				return;
			}

			let user;
			try {
				const [u] = await this.authenticateService.authenticate(token);
				user = u;
			} catch (err) {
				if (err instanceof AuthenticationError) {
					reply.code(401);
					return;
				}
				this.logger.error(`download auth failed unexpectedly: ${err instanceof Error ? err.message : err}`);
				reply.code(401);
				return;
			}
			if (user == null) {
				reply.code(401);
				return;
			}

			const stream = await this.twitchStreamsRepository.findOneBy({ id: request.params.streamId });
			if (stream == null) {
				reply.code(404).send('not found');
				return;
			}
			if (stream.userId !== user.id) {
				reply.code(403).send('forbidden');
				return;
			}
			if (stream.recordingFilePath == null || stream.recordingRetentionExpiresAt == null) {
				reply.code(404).send('not available');
				return;
			}

			let stat: fs.Stats;
			try {
				stat = await fs.promises.stat(stream.recordingFilePath);
			} catch {
				reply.code(410).send('file purged');
				return;
			}
			if (!stat.isFile()) {
				reply.code(410).send('file purged');
				return;
			}

			// Content-Disposition: ASCII fallback filename と RFC5987 UTF-8 filename* を併記。
			// stream.title はユーザー入力なのでパス区切り等をサニタイズし、ASCII 外は ASCII fallback から除外。
			const label = stream.title.trim().length > 0 ? stream.title.trim() : 'Live';
			const sanitized = label.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100);
			const asciiFallback = 'archive.mp4';
			const utf8Encoded = encodeURIComponent(sanitized.endsWith('.mp4') ? sanitized : `${sanitized}.mp4`);
			reply.header('Content-Disposition', `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`);

			reply.code(200);
			reply.header('Content-Type', 'video/mp4');
			reply.header('Content-Length', stat.size);
			// Range リクエスト対応は省略 (fastify のデフォルトで send(stream) 時は自前で処理しないため)。
			// 必要になれば @fastify/http-proxy 等の range plugin を導入するか、手動で stream をスライスする。
			return reply.send(fs.createReadStream(stream.recordingFilePath));
		});

		done();
	}
}
