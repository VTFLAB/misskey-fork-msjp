/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import type { TwitchStreamsRepository } from '@/models/_.js';
import { LiveRecordingService } from '@/core/live/LiveRecordingService.js';

export const meta = {
	tags: ['twitch'],

	requireCredential: true,
	kind: 'write:account',

	description: 'retention 期間中の録画 mp4 の Google Drive 再アップロードを開始する (配信者本人のみ、bsky-fork 独自、YouTube 12時間アーカイブ上限対策)。' +
		'前提チェックの完了後すぐ応答し、アップロード本体はサーバー側でバックグラウンド継続する ' +
		'(大容量ファイルの転送完了を同期で待つとリバースプロキシのタイムアウトにかかるため)。' +
		'進捗と結果は recordingStatus (uploading → processing/ready | failed) で追跡する。',

	limit: {
		duration: 60 * 1000,
		max: 10,
	},

	errors: {
		noSuchStream: {
			message: 'No such stream.',
			code: 'NO_SUCH_STREAM',
			id: '1f3b9c2e-7a44-4f2d-9b6a-8e1c2f3a4b5c',
		},
		forbidden: {
			message: 'You are not the owner of this stream.',
			code: 'FORBIDDEN',
			id: '2a4c1d3e-8b55-4f3e-ac7b-9f2d3a4b5c6d',
		},
		notRetained: {
			message: 'This stream recording is not under retention.',
			code: 'NOT_RETAINED',
			id: '3b5d2e4f-9c66-4f4e-bd8c-0a3e4b5c6d7e',
		},
		driveFailed: {
			message: 'Google Drive upload failed.',
			code: 'DRIVE_UPLOAD_FAILED',
			id: '4c6e3f50-ad77-4f5f-ce9d-1b4f5c6d7e8f',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			recordingStatus: {
				type: 'string', optional: false, nullable: false,
				enum: ['none', 'pending', 'remuxing', 'uploading', 'processing', 'ready', 'failed'],
			},
			recordingGoogleDriveFileId: { type: 'string', optional: false, nullable: true },
			recordingGoogleDriveThumbnailLink: { type: 'string', optional: false, nullable: true },
			recordingError: { type: 'string', optional: false, nullable: true },
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

		private liveRecordingService: LiveRecordingService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const stream = await this.twitchStreamsRepository.findOneBy({ id: ps.streamId });
			if (stream == null) {
				throw new ApiError(meta.errors.noSuchStream);
			}
			if (stream.userId !== me.id) {
				throw new ApiError(meta.errors.forbidden);
			}
			if (stream.recordingRetentionExpiresAt == null || stream.recordingFilePath == null) {
				throw new ApiError(meta.errors.notRetained);
			}

			// 前提チェック (ファイル実在・Drive 連携・二重実行) までを同期で行い、
			// アップロード本体はバックグラウンドで継続される (メソッドの doc comment 参照)
			try {
				await this.liveRecordingService.startRetryDriveUploadFromRetention(stream.id, me.id);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				throw new ApiError(meta.errors.driveFailed, { reason: message });
			}

			// 再読込して開始直後の状態 (recordingStatus='uploading') を返す
			const refreshed = await this.twitchStreamsRepository.findOneBy({ id: ps.streamId });
			if (refreshed == null) {
				// 更新直後の再読込で null になることは実質起きないが、型ガードのため。
				throw new ApiError(meta.errors.noSuchStream);
			}

			return {
				recordingStatus: refreshed.recordingStatus,
				recordingGoogleDriveFileId: refreshed.recordingGoogleDriveFileId,
				recordingGoogleDriveThumbnailLink: refreshed.recordingGoogleDriveThumbnailLink,
				recordingError: refreshed.recordingError,
			};
		});
	}
}
