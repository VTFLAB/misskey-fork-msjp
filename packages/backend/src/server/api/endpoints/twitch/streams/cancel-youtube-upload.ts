/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import type { TwitchStreamsRepository } from '@/models/_.js';

export const meta = {
	tags: ['twitch'],

	requireCredential: true,
	kind: 'write:account',

	description: 'YouTubeアップロードのリトライキューをキャンセルする(配信者本人のみ)。' +
		'Drive側に一時退避されたファイルは削除しない (視聴者が引き続き閲覧できるようにするため)。',

	errors: {
		noSuchStream: {
			message: 'No such stream.',
			code: 'NO_SUCH_STREAM',
			id: 'aa6d64db-ef5e-48eb-b651-a76672f8c33c',
		},
		notQueued: {
			message: 'The YouTube upload for this stream is not queued.',
			code: 'NOT_QUEUED',
			id: 'c051d29d-b512-43a3-9ca1-d9615b00435e',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			youtubeUploadStatus: {
				type: 'string', optional: false, nullable: false,
				enum: ['none', 'pending', 'uploading', 'ready', 'failed', 'queued', 'cancelled'],
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		streamId: { type: 'string', format: 'misskey:id' },
	},
	required: ['streamId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.twitchStreamsRepository)
		private twitchStreamsRepository: TwitchStreamsRepository,
	) {
		super(meta, paramDef, async (ps, me) => {
			const stream = await this.twitchStreamsRepository.findOneBy({ id: ps.streamId });
			if (stream == null || stream.userId !== me.id) {
				throw new ApiError(meta.errors.noSuchStream);
			}
			if (stream.youtubeUploadStatus !== 'queued') {
				throw new ApiError(meta.errors.notQueued);
			}

			await this.twitchStreamsRepository.update(stream.id, {
				youtubeUploadStatus: 'cancelled',
				youtubeUploadError: 'ユーザーによりキャンセルされました。',
			});

			return { youtubeUploadStatus: 'cancelled' as const };
		});
	}
}
