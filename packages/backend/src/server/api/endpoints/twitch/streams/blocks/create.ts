/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import type { TwitchStreamsRepository, TwitchStreamCommentsRepository } from '@/models/_.js';
import { TwitchStreamBlockService } from '@/core/twitch/TwitchStreamBlockService.js';

export const meta = {
	tags: ['twitch'],

	requireCredential: true,
	kind: 'write:account',
	prohibitMoved: true,

	description: '自分の配信チャットからコメントの投稿者をブロックする (配信者専用)。対象はコメント行から導出され、以後この配信者の配信にコメントできなくなる。Twitch 由来コメントの場合は Misskey 側への取り込みが止まる。',

	limit: {
		duration: 60 * 1000,
		max: 30,
	},

	errors: {
		noSuchComment: {
			message: 'No such comment.',
			code: 'NO_SUCH_COMMENT',
			id: '86557141-8128-4399-a4f7-c56ac8e3a261',
		},
		notOwner: {
			message: 'You are not the broadcaster of this stream.',
			code: 'NOT_STREAM_OWNER',
			id: '9324826c-c011-4857-a0a8-919325bea93c',
		},
		cannotBlock: {
			message: 'This comment author cannot be blocked.',
			code: 'CANNOT_BLOCK',
			id: 'd9fb64a8-d13a-4323-bde9-83ea85aa3f0a',
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
		commentId: { type: 'string', format: 'misskey:id' },
	},
	required: ['commentId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.twitchStreamsRepository)
		private twitchStreamsRepository: TwitchStreamsRepository,

		@Inject(DI.twitchStreamCommentsRepository)
		private twitchStreamCommentsRepository: TwitchStreamCommentsRepository,

		private twitchStreamBlockService: TwitchStreamBlockService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const comment = await this.twitchStreamCommentsRepository.findOneBy({ id: ps.commentId });
			if (comment == null) throw new ApiError(meta.errors.noSuchComment);

			const stream = await this.twitchStreamsRepository.findOneBy({ id: comment.streamId });
			if (stream == null) throw new ApiError(meta.errors.noSuchComment);
			if (stream.userId !== me.id) throw new ApiError(meta.errors.notOwner);

			const block = await this.twitchStreamBlockService.blockFromComment(me.id, comment);
			// 自分自身のコメント・退会済みユーザーのコメント等、対象を導出できない場合
			if (block == null) throw new ApiError(meta.errors.cannotBlock);

			return { id: block.id };
		});
	}
}
