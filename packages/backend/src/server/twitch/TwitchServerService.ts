/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { TwitchLoggerService } from '@/core/twitch/TwitchLoggerService.js';
import { TwitchOAuthService, TwitchOAuthCallbackError } from '@/core/twitch/TwitchOAuthService.js';
import { TwitchApiService } from '@/core/twitch/TwitchApiService.js';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

// Twitch OAuth の redirect URI: GET {url}/twitch/oauth/callback
// (/api 配下は POST 前提の API サーバーなので、ブラウザリダイレクトを受けるルートはここに置く)
@Injectable()
export class TwitchServerService {
	private logger: Logger;

	constructor(
		private twitchApiService: TwitchApiService,
		private twitchOAuthService: TwitchOAuthService,
		private twitchLoggerService: TwitchLoggerService,
	) {
		this.logger = this.twitchLoggerService.child('server');
	}

	@bindThis
	public createServer(fastify: FastifyInstance, options: FastifyPluginOptions, done: (err?: Error) => void) {
		fastify.get<{
			Querystring: { code?: string; state?: string; error?: string; error_description?: string };
		}>('/oauth/callback', async (request, reply) => {
			const settingsUrl = '/settings/twitch';

			if (!this.twitchApiService.isEnabled) {
				reply.code(404);
				return;
			}

			const { code, state, error } = request.query;

			if (error != null || code == null || state == null) {
				// ユーザーが認可画面で拒否した場合など
				this.logger.info(`oauth callback denied: ${error ?? 'missing params'}`);
				return await reply.redirect(`${settingsUrl}?twitchResult=denied`);
			}

			try {
				const { forBot } = await this.twitchOAuthService.handleCallback(code, state);
				return await reply.redirect(`${settingsUrl}?twitchResult=${forBot ? 'botLinked' : 'linked'}`);
			} catch (err) {
				if (err instanceof TwitchOAuthCallbackError) {
					this.logger.warn(`oauth callback rejected: ${err.message}`);
					return await reply.redirect(`${settingsUrl}?twitchResult=error&reason=${encodeURIComponent(err.message)}`);
				}
				this.logger.error(`oauth callback failed: ${err instanceof Error ? err.message : err}`);
				return await reply.redirect(`${settingsUrl}?twitchResult=error`);
			}
		});

		done();
	}
}
