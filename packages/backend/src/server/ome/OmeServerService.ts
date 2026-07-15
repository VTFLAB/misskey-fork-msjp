/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Inject } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { LiveLoggerService } from '@/core/live/LiveLoggerService.js';
import { OmeAdmissionService, type OmeAdmissionRequest } from '@/core/live/OmeAdmissionService.js';
import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';

type OmeAdmissionRequestBody = {
	client: {
		address: string;
		port: number;
		real_ip?: string;
		user_agent?: string;
	};
	request: OmeAdmissionRequest & {
		new_url?: string;
		time: string;
	};
};

/**
 * OME AdmissionWebhooks の受け口 (`POST /ome/admission`)。
 * ビットレート超過で cut された streamKey の再接続を ingest 開始時点で拒否するために必要
 * (SignedPolicy だけでは静的な署名検証しかできず、動的なブラックリスト判定ができないため)。
 * 判定ロジック本体は OmeAdmissionService に委譲する。
 */
@Injectable()
export class OmeServerService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		private omeAdmissionService: OmeAdmissionService,
		private liveLoggerService: LiveLoggerService,
	) {
		this.logger = this.liveLoggerService.child('server');
	}

	// Base64URL エンコード比較 (OME の X-OME-Signature はパディング無し base64url)
	@bindThis
	private verifySignature(rawBody: string | Buffer, signatureHeader: string, secretKey: string): boolean {
		const expected = createHmac('sha1', secretKey).update(rawBody).digest('base64')
			.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

		const expectedBuf = Buffer.from(expected, 'utf8');
		const actualBuf = Buffer.from(signatureHeader, 'utf8');
		if (expectedBuf.length !== actualBuf.length) return false;
		return timingSafeEqual(expectedBuf, actualBuf);
	}

	@bindThis
	public createServer(fastify: FastifyInstance, options: FastifyPluginOptions, done: (err?: Error) => void) {
		fastify.post<{ Body: OmeAdmissionRequestBody }>(
			'/admission',
			{ config: { rawBody: true }, bodyLimit: 1024 * 16 },
			async (request: FastifyRequest<{ Body: OmeAdmissionRequestBody }>, reply) => {
				if (this.config.ome == null) {
					reply.code(404);
					return;
				}

				const signature = request.headers['x-ome-signature'];
				if (typeof signature !== 'string' || request.rawBody == null) {
					reply.code(403);
					return { allowed: false, reason: 'missing signature or body' };
				}

				if (this.config.ome.admissionSecret == null) {
					reply.code(503);
					return { allowed: false, reason: 'admission webhooks not configured' };
				}

				if (!this.verifySignature(request.rawBody, signature, this.config.ome.admissionSecret)) {
					this.logger.warn(`admission signature mismatch (url=${request.body?.request?.url})`);
					reply.code(403);
					return { allowed: false, reason: 'bad signature' };
				}

				const { request: req } = request.body;

				if (req.status === 'closing') {
					// closing は応答内容を待つ処理が無いため即座に空 JSON を返し、後処理は非同期実行する。
					reply.send({});
					this.omeAdmissionService.handleClosing(req).catch(err => {
						this.logger.error(`handleClosing failed: ${err instanceof Error ? err.message : err}`);
					});
					return;
				}

				// opening: Server.xml の Timeout (3000ms) 以内に応答する必要がある。
				// streamKey 突合・ブラックリスト確認までを同期的に行い allowed を確定させたら即応答し、
				// フォロワー通知・自動ノート投稿などの重い処理は応答後に非同期実行する。
				const decision = await this.omeAdmissionService.decideOpening(req);
				reply.send({ allowed: decision.allowed, reason: decision.reason });

				if (decision.allowed) {
					this.omeAdmissionService.afterOpeningAllowed(decision).catch(err => {
						this.logger.error(`afterOpeningAllowed failed: ${err instanceof Error ? err.message : err}`);
					});
				}
				return;
			},
		);

		done();
	}
}
