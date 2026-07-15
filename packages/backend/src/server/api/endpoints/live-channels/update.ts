/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import type { DriveFilesRepository } from '@/models/_.js';
import { LiveChannelService } from '@/core/live/LiveChannelService.js';

export const meta = {
	tags: ['live-channel', 'account'],

	requireCredential: true,
	kind: 'write:account',
	secure: true,

	description: 'ライブチャンネル (自己配信) の設定 (有効/無効・チャンネル名・説明・バナー) を更新する。',

	limit: {
		duration: 60 * 1000,
		max: 10,
	},

	errors: {
		noSuchChannel: {
			message: 'The user has no live channel.',
			code: 'NO_SUCH_CHANNEL',
			id: '1e638001-9368-479a-b15a-bd517f2a68a5',
		},
		noSuchBanner: {
			message: 'No such banner file.',
			code: 'NO_SUCH_BANNER',
			id: '22a62eab-1306-47d2-90c3-4cac2a972839',
		},
		noSuchOfflineImage: {
			message: 'No such offline image file.',
			code: 'NO_SUCH_OFFLINE_IMAGE',
			id: '9d6b6e0b-8e2c-4b9a-9e2a-6b7c2f5e1a3d',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			id: { type: 'string', format: 'misskey:id', optional: false, nullable: false },
			userId: { type: 'string', format: 'misskey:id', optional: false, nullable: false },
			enabled: { type: 'boolean', optional: false, nullable: false },
			name: { type: 'string', optional: false, nullable: true },
			description: { type: 'string', optional: false, nullable: true },
			bannerId: { type: 'string', format: 'misskey:id', optional: false, nullable: true },
			bannerUrl: { type: 'string', optional: false, nullable: true },
			offlineImageId: { type: 'string', format: 'misskey:id', optional: false, nullable: true },
			offlineImageUrl: { type: 'string', optional: false, nullable: true },
			channelId: { type: 'string', format: 'misskey:id', optional: false, nullable: true },
			createdAt: { type: 'string', format: 'date-time', optional: false, nullable: false },
			autoPostNoteEnabled: { type: 'boolean', optional: false, nullable: false },
			streamKey: { type: 'string', optional: true, nullable: false },
			streamKeyRegeneratedAt: { type: 'string', format: 'date-time', optional: true, nullable: false },
			lastCutReason: { type: 'string', optional: true, nullable: true },
			autoPostNoteTemplate: { type: 'string', optional: true, nullable: true },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		enabled: { type: 'boolean' },
		name: { type: 'string', nullable: true, maxLength: 128 },
		description: { type: 'string', nullable: true, maxLength: 2048 },
		bannerId: { type: 'string', format: 'misskey:id', nullable: true },
		offlineImageId: { type: 'string', format: 'misskey:id', nullable: true },
		autoPostNoteEnabled: { type: 'boolean' },
		autoPostNoteTemplate: { type: 'string', nullable: true, maxLength: 512 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		private liveChannelService: LiveChannelService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const channel = await this.liveChannelService.show(me.id);
			if (channel == null) throw new ApiError(meta.errors.noSuchChannel);

			if (ps.bannerId != null) {
				const banner = await this.driveFilesRepository.findOneBy({ id: ps.bannerId });
				if (banner == null || banner.userId !== me.id) throw new ApiError(meta.errors.noSuchBanner);
			}

			if (ps.offlineImageId != null) {
				const offlineImage = await this.driveFilesRepository.findOneBy({ id: ps.offlineImageId });
				if (offlineImage == null || offlineImage.userId !== me.id) throw new ApiError(meta.errors.noSuchOfflineImage);
			}

			const updated = await this.liveChannelService.update(me.id, {
				enabled: ps.enabled,
				name: ps.name,
				description: ps.description,
				bannerId: ps.bannerId,
				offlineImageId: ps.offlineImageId,
				autoPostNoteEnabled: ps.autoPostNoteEnabled,
				autoPostNoteTemplate: ps.autoPostNoteTemplate,
			});

			return await this.liveChannelService.pack(updated, me);
		});
	}
}
