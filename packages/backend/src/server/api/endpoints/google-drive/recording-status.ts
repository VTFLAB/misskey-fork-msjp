/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import type { TwitchStreamsRepository } from '@/models/_.js';
import { GoogleDriveService } from '@/core/google/GoogleDriveService.js';

export const meta = {
	tags: ['google-drive', 'twitch'],

	requireCredential: false,

	description: '配信アーカイブ (Google Drive) の処理状態を返す。processing 中は Drive 側のサムネイル生成状況を確認し、' +
		'生成済みなら ready に更新してから返す (フロントエンドのポーリング契機)。',

	limit: {
		duration: 60 * 1000,
		max: 30,
	},

	errors: {
		noSuchStream: {
			message: 'No such (OME) stream.',
			code: 'NO_SUCH_STREAM',
			id: '8c10b80e-bae2-4894-963b-de3c6af2e350',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			recordingStatus: { type: 'string', optional: false, nullable: false },
			recordingGoogleDriveFileId: { type: 'string', optional: false, nullable: true },
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

		private googleDriveService: GoogleDriveService,
	) {
		super(meta, paramDef, async (ps) => {
			const stream = await this.twitchStreamsRepository.findOneBy({ id: ps.streamId });
			if (stream == null || stream.source !== 'ome') {
				throw new ApiError(meta.errors.noSuchStream);
			}

			if (stream.recordingStatus === 'processing' && stream.recordingGoogleDriveFileId != null) {
				const result = await this.googleDriveService
					.checkProcessingStatus(stream.userId, stream.recordingGoogleDriveFileId)
					.catch(() => null); // 連携解除/一時的なAPI障害等はポーリング側の次回リトライに任せ、現状のstatusをそのまま返す

				if (result != null && result.thumbnailLink != null) {
					await this.twitchStreamsRepository.update(stream.id, {
						recordingStatus: 'ready',
						recordingGoogleDriveThumbnailLink: result.thumbnailLink,
					});
					return {
						recordingStatus: 'ready',
						recordingGoogleDriveFileId: stream.recordingGoogleDriveFileId,
					};
				}
			}

			return {
				recordingStatus: stream.recordingStatus,
				recordingGoogleDriveFileId: stream.recordingGoogleDriveFileId,
			};
		});
	}
}
