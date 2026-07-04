/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import type { TwitchStreamsRepository, DriveFilesRepository } from '@/models/_.js';
import { TwitchCommentService, MAX_COMMENT_LENGTH } from '@/core/twitch/TwitchCommentService.js';
import { TwitchChatRelayService } from '@/core/twitch/TwitchChatRelayService.js';
import { TwitchStreamBlockService } from '@/core/twitch/TwitchStreamBlockService.js';

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
		noSuchFile: {
			message: 'Some attached files are not found.',
			code: 'NO_SUCH_FILE',
			id: '2dc2cd7f-5b4f-4a5e-8fa8-4e534ffa4f6b',
		},
		blocked: {
			message: 'You are blocked by the broadcaster.',
			code: 'BLOCKED_BY_BROADCASTER',
			id: '98346cfb-2c63-48e6-9038-5fc97e08beec',
			httpStatusCode: 403,
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
		fileIds: {
			type: 'array',
			uniqueItems: true,
			minItems: 1,
			maxItems: 16,
			items: { type: 'string', format: 'misskey:id' },
		},
	},
	required: ['streamId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.twitchStreamsRepository)
		private twitchStreamsRepository: TwitchStreamsRepository,

		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		private twitchCommentService: TwitchCommentService,
		private twitchChatRelayService: TwitchChatRelayService,
		private twitchStreamBlockService: TwitchStreamBlockService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const stream = await this.twitchStreamsRepository.findOneBy({ id: ps.streamId });
			if (stream == null) throw new ApiError(meta.errors.noSuchStream);
			if (!stream.isLive) throw new ApiError(meta.errors.streamEnded);

			if (await this.twitchStreamBlockService.isBlockedMisskeyUser(stream.userId, me.id)) {
				throw new ApiError(meta.errors.blocked);
			}

			const text = (ps.text ?? '').trim().slice(0, MAX_COMMENT_LENGTH);
			const fileIds = ps.fileIds ?? [];
			// テキストか添付のどちらかは必須
			if (text.length === 0 && fileIds.length === 0) throw new ApiError(meta.errors.invalidText);

			if (fileIds.length > 0) {
				// 自分のドライブファイルのみ添付可 (他人のファイル ID 指定を拒否)
				const count = await this.driveFilesRepository.countBy({ id: In(fileIds), userId: me.id });
				if (count !== fileIds.length) throw new ApiError(meta.errors.noSuchFile);
			}

			const comment = await this.twitchCommentService.createMisskeyComment(stream, me, text, fileIds);

			// Twitch への中継は fire-and-forget (Twitch 障害時も投稿自体は成功させる)。
			// メディアは中継できないため、テキストがある場合のみ送る
			if (text.length > 0) {
				this.twitchChatRelayService.relayToTwitch(stream, me, text);
			}

			return { id: comment.id };
		});
	}
}
