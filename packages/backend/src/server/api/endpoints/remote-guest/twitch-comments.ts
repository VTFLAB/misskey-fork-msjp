/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import type { TwitchStreamCommentsRepository } from '@/models/_.js';
import { QueryService } from '@/core/QueryService.js';
import { TwitchCommentService } from '@/core/twitch/TwitchCommentService.js';
import { RemoteGuestSessionService } from '@/core/remote-guest/RemoteGuestSessionService.js';

export const meta = {
	tags: ['remote-guest', 'twitch'],

	requireCredential: false,

	description: 'リモートゲストログイン用のコメント履歴取得 (twitch/streams/comments の視聴専用版)。',

	errors: {
		guestSessionInvalid: {
			message: 'Invalid or expired guest session.',
			code: 'GUEST_SESSION_INVALID',
			id: '52fe49eb-6ea5-4d57-a655-5b15cf9cef38',
			httpStatusCode: 401,
		},
	},

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				id: { type: 'string', format: 'misskey:id', optional: false, nullable: false },
				createdAt: { type: 'string', format: 'date-time', optional: false, nullable: false },
				source: { type: 'string', enum: ['misskey', 'twitch', 'remote-guest'], optional: false, nullable: false },
				text: { type: 'string', optional: false, nullable: false },
				user: { type: 'object', ref: 'UserLite', optional: false, nullable: true },
				files: {
					type: 'array',
					optional: false, nullable: false,
					items: { type: 'object', ref: 'DriveFile', optional: false, nullable: false },
				},
				twitchUserName: { type: 'string', optional: false, nullable: true },
				twitchDisplayName: { type: 'string', optional: false, nullable: true },
				translatedText: { type: 'string', optional: false, nullable: true },
				translatedLang: { type: 'string', optional: false, nullable: true },
				fragments: {
					type: 'array',
					optional: false, nullable: true,
					items: {
						type: 'object',
						optional: false, nullable: false,
						properties: {
							type: { type: 'string', enum: ['text', 'emote'], optional: false, nullable: false },
							text: { type: 'string', optional: false, nullable: false },
							emoteId: { type: 'string', optional: true, nullable: false },
							animated: { type: 'boolean', optional: true, nullable: false },
						},
					},
				},
				remoteGuest: {
					type: 'object',
					optional: false, nullable: true,
					properties: {
						username: { type: 'string', optional: false, nullable: false },
						host: { type: 'string', optional: false, nullable: false },
						avatarUrl: { type: 'string', optional: false, nullable: true },
					},
				},
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		guestToken: { type: 'string', minLength: 1, maxLength: 128 },
		streamId: { type: 'string', format: 'misskey:id' },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
	},
	required: ['guestToken', 'streamId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.twitchStreamCommentsRepository)
		private twitchStreamCommentsRepository: TwitchStreamCommentsRepository,

		private queryService: QueryService,
		private twitchCommentService: TwitchCommentService,
		private remoteGuestSessionService: RemoteGuestSessionService,
	) {
		super(meta, paramDef, async (ps) => {
			const guest = await this.remoteGuestSessionService.validate(ps.guestToken);
			if (guest == null) throw new ApiError(meta.errors.guestSessionInvalid);

			const query = this.queryService.makePaginationQuery(
				this.twitchStreamCommentsRepository.createQueryBuilder('comment'),
				ps.sinceId,
				ps.untilId,
			).andWhere('comment.streamId = :streamId', { streamId: ps.streamId });

			const comments = await query.limit(ps.limit).getMany();

			return await this.twitchCommentService.packMany(comments);
		});
	}
}
