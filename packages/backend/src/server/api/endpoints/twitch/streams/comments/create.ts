/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import type { TwitchStreamsRepository } from '@/models/_.js';
import { TwitchCommentService, MAX_COMMENT_LENGTH } from '@/core/twitch/TwitchCommentService.js';
import { TwitchChatRelayService } from '@/core/twitch/TwitchChatRelayService.js';

export const meta = {
	tags: ['twitch'],

	requireCredential: true,
	kind: 'write:account',
	prohibitMoved: true,

	description: '配信にコメントを投稿する。ノートとは独立した専用コメントで、配信ページ上でのみ表示される。中継 bot が設定されていれば Twitch チャットにも送信される。',

	limit: {
		duration: 60 * 1000,
		max: 30,
	},

	errors: {
		noSuchStream: {
			message: 'No such stream.',
			code: 'NO_SUCH_STREAM',
			id: '62b69d4c-d517-4a40-8800-6ca79a08e946',
		},
		streamEnded: {
			message: 'The stream has already ended.',
			code: 'STREAM_ENDED',
			id: 'b79d4514-119d-4e16-aaf2-665085558459',
		},
		invalidText: {
			message: 'Comment text is empty.',
			code: 'INVALID_TEXT',
			id: '7f54d8a0-bea9-43ac-a085-1494d0c9a9b4',
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
		streamId: { type: 'string', format: 'misskey:id' },
		text: { type: 'string', minLength: 1, maxLength: 500 },
	},
	required: ['streamId', 'text'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.twitchStreamsRepository)
		private twitchStreamsRepository: TwitchStreamsRepository,

		private twitchCommentService: TwitchCommentService,
		private twitchChatRelayService: TwitchChatRelayService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const stream = await this.twitchStreamsRepository.findOneBy({ id: ps.streamId });
			if (stream == null) throw new ApiError(meta.errors.noSuchStream);
			if (!stream.isLive) throw new ApiError(meta.errors.streamEnded);

			const text = ps.text.trim().slice(0, MAX_COMMENT_LENGTH);
			if (text.length === 0) throw new ApiError(meta.errors.invalidText);

			const comment = await this.twitchCommentService.createMisskeyComment(stream, me, text);

			// Twitch への中継は fire-and-forget (Twitch 障害時も投稿自体は成功させる)
			this.twitchChatRelayService.relayToTwitch(stream, me, text);

			return { id: comment.id };
		});
	}
}
