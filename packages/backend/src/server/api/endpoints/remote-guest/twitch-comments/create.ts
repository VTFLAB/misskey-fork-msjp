/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { createHash } from 'node:crypto';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import type { TwitchStreamsRepository } from '@/models/_.js';
import { TwitchCommentService, MAX_COMMENT_LENGTH } from '@/core/twitch/TwitchCommentService.js';
import { TwitchChatRelayService } from '@/core/twitch/TwitchChatRelayService.js';
import { RemoteGuestSessionService } from '@/core/remote-guest/RemoteGuestSessionService.js';
import { TwitchStreamBlockService } from '@/core/twitch/TwitchStreamBlockService.js';

export const meta = {
	tags: ['remote-guest', 'twitch'],

	requireCredential: false,

	description: 'リモートゲストログイン用のコメント投稿 (twitch/streams/comments/create の視聴専用版)。添付ファイルは使えない。',

	limit: {
		key: 'remoteGuestTwitchCommentsCreate',
		duration: 60 * 1000,
		max: 30,
	},

	errors: {
		guestSessionInvalid: {
			message: 'Invalid or expired guest session.',
			code: 'GUEST_SESSION_INVALID',
			id: '0cf2ce1b-0213-4274-80b0-41c8b6b25d89',
			httpStatusCode: 401,
		},
		noSuchStream: {
			message: 'No such stream.',
			code: 'NO_SUCH_STREAM',
			id: 'a7de9bab-357d-412e-b1dc-0a6549b46e76',
		},
		streamEnded: {
			message: 'The stream has already ended.',
			code: 'STREAM_ENDED',
			id: '293b9dfe-34c2-4152-8e98-a74417b5e1ac',
		},
		invalidText: {
			message: 'Comment text is empty.',
			code: 'INVALID_TEXT',
			id: '79c68560-e3e1-44cc-94bf-23ac130f8139',
		},
		blocked: {
			message: 'You are blocked by the broadcaster.',
			code: 'BLOCKED_BY_BROADCASTER',
			id: 'c4aa92f3-ecd8-473b-84fd-239a3f7005be',
			httpStatusCode: 403,
		},
		duplicate: {
			message: 'Duplicate submission.',
			code: 'DUPLICATE_SUBMISSION',
			id: '0c7e7389-4c18-48c8-9162-eb3bbf326bc4',
			httpStatusCode: 409,
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			id: { type: 'string', format: 'misskey:id', optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		guestToken: { type: 'string', minLength: 1, maxLength: 128 },
		streamId: { type: 'string', format: 'misskey:id' },
		text: { type: 'string', minLength: 1, maxLength: 500 },
	},
	required: ['guestToken', 'streamId', 'text'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.twitchStreamsRepository)
		private twitchStreamsRepository: TwitchStreamsRepository,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		private twitchCommentService: TwitchCommentService,
		private twitchChatRelayService: TwitchChatRelayService,
		private remoteGuestSessionService: RemoteGuestSessionService,
		private twitchStreamBlockService: TwitchStreamBlockService,
	) {
		super(meta, paramDef, async (ps) => {
			const guest = await this.remoteGuestSessionService.validate(ps.guestToken);
			if (guest == null) throw new ApiError(meta.errors.guestSessionInvalid);

			let stream = await this.twitchStreamsRepository.findOneBy({ id: ps.streamId });
			if (stream == null) throw new ApiError(meta.errors.noSuchStream);
			if (!stream.isLive) throw new ApiError(meta.errors.streamEnded);

			// Twitch 同時転送中に Twitch 中継セッション宛てで投稿された場合は本体 (OME) セッションへ
			// 付け替える (twitch/streams/comments/create と同じ扱い)
			stream = await this.twitchChatRelayService.resolveCanonicalChatStream(stream);

			if (await this.twitchStreamBlockService.isBlockedRemoteGuest(stream.userId, guest.username, guest.host)) {
				throw new ApiError(meta.errors.blocked);
			}

			const text = ps.text.trim().slice(0, MAX_COMMENT_LENGTH);
			if (text.length === 0) throw new ApiError(meta.errors.invalidText);

			// Idempotent dedup via Redis: catches double-Enter / key auto-repeat (sub-second)
			// and fast error-retries, while rarely blocking intentional same-text chat
			// spam (e.g. "ww" bursts). Intentional reposts after 3s still work.
			// Content hash = sha256(trimmed text). Remote-guest has no fileIds.
			// Redis failure is non-fatal: availability of posting takes priority over dedup.
			const authorId = `${guest.username}@${guest.host}`;
			const contentHash = createHash('sha256').update(text).digest('hex');
			const dedupKey = `twitch-comment-dedupe:${stream.id}:${authorId}:${contentHash}`;

			let skipCreate = false;
			let existingCommentId: string | null = null;
			try {
				const acquired = await this.redisClient.set(dedupKey, 'pending', 'PX', 3000, 'NX');
				if (acquired === null) {
					// A same-content request is in flight or recently completed.
					// Poll for up to 2s waiting for it to resolve to a comment id.
					const deadline = Date.now() + 2000;
					let value = await this.redisClient.get(dedupKey);
					while (value === 'pending' && Date.now() < deadline) {
						await new Promise(resolve => setTimeout(resolve, 100));
						value = await this.redisClient.get(dedupKey);
					}
					if (typeof value === 'string' && value !== 'pending' && value !== '') {
						// Duplicate submission of an already-created comment → idempotent success.
						skipCreate = true;
						existingCommentId = value;
					} else {
						// Original request still in flight (concurrent race) and never resolved.
						throw new ApiError(meta.errors.duplicate);
					}
				}
			} catch (e: unknown) {
				if (e instanceof ApiError) throw e;
				// Redis failure: proceed without dedup (availability priority).
				// eslint-disable-next-line no-console
				console.warn(`[remote-guest/twitch-comments/create] Redis dedup failed: ${e}`);
			}

			if (skipCreate && existingCommentId != null) {
				// Idempotent response: same shape as the normal success path.
				// Skip Twitch relay (the original request handles it).
				return { id: existingCommentId };
			}

			const comment = await this.twitchCommentService.createRemoteGuestComment(stream, guest, text);

			// Extend the dedup window so a slow original request is still covered.
			try {
				await this.redisClient.set(dedupKey, comment.id, 'PX', 3000);
			} catch (e: unknown) {
				// eslint-disable-next-line no-console
				console.warn(`[remote-guest/twitch-comments/create] Redis dedup extend failed: ${e}`);
			}

			// Twitch への中継は fire-and-forget。username@host で表示し、ローカルユーザーとの混同を避ける
			this.twitchChatRelayService.relayToTwitch(stream, { username: `${guest.username}@${guest.host}` }, text);

			return { id: comment.id };
		});
	}
}
