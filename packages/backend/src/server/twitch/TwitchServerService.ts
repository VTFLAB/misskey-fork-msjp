/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import secureJson from 'secure-json-parse';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { TwitchLoggerService } from '@/core/twitch/TwitchLoggerService.js';
import { TwitchOAuthService, TwitchOAuthCallbackError } from '@/core/twitch/TwitchOAuthService.js';
import { TwitchApiService } from '@/core/twitch/TwitchApiService.js';
import { TwitchEventSubService } from '@/core/twitch/TwitchEventSubService.js';
import type { EventSubNotificationBody } from '@/core/twitch/TwitchEventSubService.js';
import type { FastifyBodyParser, FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';

// Twitch 連携のブラウザ/サーバー間受け口:
// - GET  {url}/twitch/oauth/callback — OAuth redirect URI
// - POST {url}/twitch/eventsub       — EventSub webhook transport callback
// (/api 配下は Misskey API 規約前提のため、外部サービスからの callback はここに置く)
@Injectable()
export class TwitchServerService {
	private logger: Logger;

	constructor(
		private twitchApiService: TwitchApiService,
		private twitchOAuthService: TwitchOAuthService,
		private twitchEventSubService: TwitchEventSubService,
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

		// fastify-raw-body (ServerService で { global: false, runFirst: true } 登録) と Fastify 標準の
		// application/json パーサーが競合し、rawBody:true のルートで request.body の解決が永久に止まる。
		// OmeServerService と同じパターンで、この plugin scope 内だけ専用の json パーサーを明示登録して解消する
		const almostDefaultJsonParser: FastifyBodyParser<Buffer> = function (request, rawBody, doneParse) {
			if (rawBody.length === 0) {
				const err = new Error('Body cannot be empty!') as any;
				err.statusCode = 400;
				return doneParse(err);
			}

			try {
				const json = secureJson.parse(rawBody.toString('utf8'), null, {
					protoAction: 'ignore',
					constructorAction: 'ignore',
				});
				doneParse(null, json);
			} catch (err: any) {
				err.statusCode = 400;
				return doneParse(err);
			}
		};
		fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, almostDefaultJsonParser);

		// EventSub webhook transport の受け口。HMAC 署名検証 → 重複排除 → メッセージ種別ごとの処理。
		// Twitch は応答が遅い callback を失敗扱いにするため、notification は 204 を即返してから
		// 非同期で処理する (challenge 検証だけは本文応答が必要なため同期で返す)
		fastify.post<{ Body: EventSubNotificationBody }>(
			'/eventsub',
			{ config: { rawBody: true }, bodyLimit: 1024 * 64 },
			async (request: FastifyRequest<{ Body: EventSubNotificationBody }>, reply) => {
				if (!this.twitchApiService.isEnabled) {
					reply.code(404);
					return;
				}

				const messageId = request.headers['twitch-eventsub-message-id'];
				const timestamp = request.headers['twitch-eventsub-message-timestamp'];
				const signature = request.headers['twitch-eventsub-message-signature'];
				const messageType = request.headers['twitch-eventsub-message-type'];
				if (
					typeof messageId !== 'string' || typeof timestamp !== 'string' ||
					typeof signature !== 'string' || typeof messageType !== 'string' ||
					request.rawBody == null
				) {
					reply.code(403);
					return;
				}

				if (!this.twitchEventSubService.verifySignature(messageId, timestamp, request.rawBody, signature)) {
					this.logger.warn(`eventsub signature mismatch (type=${messageType})`);
					reply.code(403);
					return;
				}

				if (this.twitchEventSubService.isTimestampStale(timestamp)) {
					this.logger.warn(`eventsub message timestamp too old (id=${messageId})`);
					reply.code(403);
					return;
				}

				switch (messageType) {
					case 'webhook_callback_verification': {
						const challenge = request.body.challenge;
						if (challenge == null) {
							reply.code(400);
							return;
						}
						this.logger.info(`eventsub callback verified: type=${request.body.subscription.type} condition=${JSON.stringify(request.body.subscription.condition)}`);
						reply.header('Content-Type', 'text/plain').code(200);
						return challenge;
					}
					case 'notification': {
						// 重複排除は署名検証後に行う (偽造リクエストで正規通知の message_id を先取りさせない)
						if (!await this.twitchEventSubService.markMessageSeen(messageId)) {
							reply.code(204);
							return;
						}
						reply.code(204).send();
						this.twitchEventSubService.handleNotification(request.body).catch(err => {
							this.logger.error(`eventsub notification handling failed: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
						});
						return;
					}
					case 'revocation': {
						reply.code(204).send();
						this.twitchEventSubService.handleRevocation(request.body);
						return;
					}
					default: {
						this.logger.warn(`unknown eventsub message type: ${messageType}`);
						reply.code(204);
						return;
					}
				}
			},
		);

		done();
	}
}
