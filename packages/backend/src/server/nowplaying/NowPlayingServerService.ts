/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { NowPlayingLoggerService } from '@/core/nowplaying/NowPlayingLoggerService.js';
import { NowPlayingService, NowPlayingCallbackError } from '@/core/nowplaying/NowPlayingService.js';
import { LastfmApiService } from '@/core/nowplaying/LastfmApiService.js';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

// NowPlaying (fork 独自) の Last.fm Web Auth callback:
// - GET {url}/nowplaying/lastfm/callback — Last.fm 側からの redirect 先
@Injectable()
export class NowPlayingServerService {
	private logger: Logger;

	constructor(
		private lastfmApiService: LastfmApiService,
		private nowPlayingService: NowPlayingService,
		private nowPlayingLoggerService: NowPlayingLoggerService,
	) {
		this.logger = this.nowPlayingLoggerService.child('server');
	}

	@bindThis
	public createServer(fastify: FastifyInstance, options: FastifyPluginOptions, done: (err?: Error) => void) {
		fastify.get<{
			Querystring: { token?: string; state?: string };
		}>('/lastfm/callback', async (request, reply) => {
			const settingsUrl = '/settings/nowplaying';

			if (!this.lastfmApiService.isEnabled) {
				reply.code(404);
				return;
			}

			const { token, state } = request.query;
			if (token == null || state == null) {
				return await reply.redirect(`${settingsUrl}?lastfmResult=error`);
			}

			try {
				await this.nowPlayingService.handleLastfmCallback(token, state);
				return await reply.redirect(`${settingsUrl}?lastfmResult=ok`);
			} catch (err) {
				if (err instanceof NowPlayingCallbackError) {
					this.logger.warn(`lastfm callback rejected: ${err.message}`);
				} else {
					this.logger.error(`lastfm callback failed: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
				}
				return await reply.redirect(`${settingsUrl}?lastfmResult=error`);
			}
		});

		done();
	}
}
