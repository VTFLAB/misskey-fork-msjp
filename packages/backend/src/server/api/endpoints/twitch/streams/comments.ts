/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { TwitchStreamCommentsRepository } from '@/models/_.js';
import { QueryService } from '@/core/QueryService.js';
import { TwitchCommentService } from '@/core/twitch/TwitchCommentService.js';

export const meta = {
	tags: ['twitch'],

	requireCredential: true,
	kind: 'read:account',

	description: '配信セッションのコメント履歴を返す (Misskey ユーザー投稿 + Twitch チャット由来)。',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				id: { type: 'string', format: 'misskey:id', optional: false, nullable: false },
				createdAt: { type: 'string', format: 'date-time', optional: false, nullable: false },
				source: { type: 'string', enum: ['misskey', 'twitch'], optional: false, nullable: false },
				text: { type: 'string', optional: false, nullable: false },
				user: { type: 'object', ref: 'UserLite', optional: false, nullable: true },
				twitchUserName: { type: 'string', optional: false, nullable: true },
				twitchDisplayName: { type: 'string', optional: false, nullable: true },
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		streamId: { type: 'string', format: 'misskey:id' },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
	},
	required: ['streamId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.twitchStreamCommentsRepository)
		private twitchStreamCommentsRepository: TwitchStreamCommentsRepository,

		private queryService: QueryService,
		private twitchCommentService: TwitchCommentService,
	) {
		super(meta, paramDef, async (ps, me) => {
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
