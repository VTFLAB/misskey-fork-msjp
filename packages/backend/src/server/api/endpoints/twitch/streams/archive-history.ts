/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { TwitchStreamService } from '@/core/twitch/TwitchStreamService.js';

export const meta = {
	tags: ['twitch'],

	requireCredential: true,
	kind: 'read:account',

	description: '配信者本人が自分の過去配信のアーカイブ (Google Drive / YouTube) 状況を確認するための一覧。' +
		'カーソルページネーション (untilId) 対応。',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				streamId: { type: 'string', format: 'misskey:id', optional: false, nullable: false },
				title: { type: 'string', optional: false, nullable: false },
				startedAt: { type: 'string', format: 'date-time', optional: false, nullable: false },
				endedAt: { type: 'string', format: 'date-time', optional: false, nullable: true },
				recordingStatus: {
					type: 'string', optional: false, nullable: false,
					enum: ['none', 'pending', 'remuxing', 'uploading', 'processing', 'ready', 'failed'],
				},
				recordingGoogleDriveFileId: { type: 'string', optional: false, nullable: true },
				recordingGoogleDriveThumbnailLink: { type: 'string', optional: false, nullable: true },
				recordingError: { type: 'string', optional: false, nullable: true },
				youtubeUploadStatus: {
					type: 'string', optional: false, nullable: false,
					enum: ['none', 'pending', 'uploading', 'ready', 'failed', 'queued', 'cancelled'],
				},
				youtubeVideoId: { type: 'string', optional: false, nullable: true },
				youtubeThumbnailUrl: { type: 'string', optional: false, nullable: true },
				youtubeUploadError: { type: 'string', optional: false, nullable: true },
				// アーカイブ視聴制限 (bsky-fork 独自)。オーナー専用一覧のため常に値を返す
				// (show.ts の owner-only optional 分岐とは異なり optional にしない)。
				archiveViewVisibility: { type: 'string', optional: false, nullable: false, enum: ['public', 'followers', 'password', 'users'] },
				archiveViewPassword: { type: 'string', optional: false, nullable: true },
				archiveVisibleUserIds: { type: 'array', optional: false, nullable: false, items: { type: 'string', format: 'misskey:id' } },
				archiveUnpublished: { type: 'boolean', optional: false, nullable: false },
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
		untilId: { type: 'string', format: 'misskey:id' },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private twitchStreamService: TwitchStreamService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const streams = await this.twitchStreamService.getArchiveHistoryByUserId(me.id, ps.limit, ps.untilId);

			return streams.map(s => ({
				streamId: s.id,
				title: s.title,
				startedAt: s.startedAt.toISOString(),
				endedAt: s.endedAt?.toISOString() ?? null,
				recordingStatus: s.recordingStatus,
				recordingGoogleDriveFileId: s.recordingGoogleDriveFileId,
				recordingGoogleDriveThumbnailLink: s.recordingGoogleDriveThumbnailLink,
				recordingError: s.recordingError,
				youtubeUploadStatus: s.youtubeUploadStatus,
				youtubeVideoId: s.youtubeVideoId,
				youtubeThumbnailUrl: s.youtubeThumbnailUrl,
				youtubeUploadError: s.youtubeUploadError,
				archiveViewVisibility: s.archiveViewVisibility,
				archiveViewPassword: s.archiveViewPassword,
				archiveVisibleUserIds: s.archiveVisibleUserIds,
				archiveUnpublished: s.archiveUnpublishedAt != null,
			}));
		});
	}
}
