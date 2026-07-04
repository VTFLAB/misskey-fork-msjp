/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { RemoteGuestLoggerService } from '@/core/remote-guest/RemoteGuestLoggerService.js';
import { RemoteGuestMiAuthClientService } from '@/core/remote-guest/RemoteGuestMiAuthClientService.js';
import { RateLimiterService } from '@/server/api/RateLimiterService.js';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

const CALLBACK_RATE_LIMIT = { key: 'remoteGuestCallback', duration: 1000 * 60 * 10, max: 20 } as const;

// リモート MiAuth コールバック受信: GET {url}/remote-guest/callback?session=...
// (ブラウザリダイレクトを受けるルートなので /api 配下の POST API サーバーとは別に置く。TwitchServerService と同様)
@Injectable()
export class RemoteGuestServerService {
	private logger: Logger;

	constructor(
		private remoteGuestMiAuthClientService: RemoteGuestMiAuthClientService,
		private remoteGuestLoggerService: RemoteGuestLoggerService,
		private rateLimiterService: RateLimiterService,
	) {
		this.logger = this.remoteGuestLoggerService.child('server');
	}

	@bindThis
	public createServer(fastify: FastifyInstance, options: FastifyPluginOptions, done: (err?: Error) => void) {
		fastify.get<{
			Querystring: { session?: string };
		}>('/callback', async (request, reply) => {
			const rateLimited = await this.rateLimiterService.limit(CALLBACK_RATE_LIMIT, request.ip);
			if (rateLimited != null) {
				reply.code(429);
				return;
			}

			const { session } = request.query;
			if (session == null) {
				return await reply.redirect('/?remoteGuestResult=expired');
			}

			try {
				const result = await this.remoteGuestMiAuthClientService.handleCallback(session);
				if (result.result === 'linked') {
					const url = new URL(result.returnTo, 'https://placeholder.invalid');
					url.searchParams.set('remoteGuestResult', 'linked');
					url.searchParams.set('remoteGuestToken', result.token);
					url.searchParams.set('remoteGuestExpiresAt', result.expiresAt.toISOString());
					url.searchParams.set('remoteGuestAcct', result.acct);
					return await reply.redirect(url.pathname + url.search);
				}
				const url = new URL(result.returnTo, 'https://placeholder.invalid');
				url.searchParams.set('remoteGuestResult', result.result);
				return await reply.redirect(url.pathname + url.search);
			} catch (err) {
				this.logger.error(`callback failed: ${err instanceof Error ? err.message : err}`);
				return await reply.redirect('/?remoteGuestResult=expired');
			}
		});

		done();
	}
}
