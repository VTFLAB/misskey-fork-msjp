/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import type { TwitchStreamsRepository } from '@/models/_.js';
import { LiveArchiveAccessService } from '@/core/live/LiveArchiveAccessService.js';

export const meta = {
	tags: ['twitch'],

	requireCredential: true,
	kind: 'write:account',

	description: '配信者本人が自分の配信アーカイブの視聴制限 (視聴可否モード・パスワード・許可ユーザー) を個別に上書きする。' +
		'配信終了時点の live_channel 設定のスナップショットを上書きするのみで、live_channel 側の設定自体には影響しない。',

	limit: {
		duration: 60 * 1000,
		max: 10,
	},

	errors: {
		noSuchArchive: {
			message: 'No such archive owned by you.',
			code: 'NO_SUCH_ARCHIVE',
			id: 'b7ed11a3-6e9f-4a01-84b6-379d642931fd',
		},
		viewPasswordRequired: {
			message: 'viewPassword is required when visibility is password.',
			code: 'VIEW_PASSWORD_REQUIRED',
			id: '1a3f7c9e-5b2d-4e8a-9c6f-8d2b4a7e0f1c',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			streamId: { type: 'string', format: 'misskey:id', optional: false, nullable: false },
			archiveViewVisibility: { type: 'string', optional: false, nullable: false, enum: ['public', 'followers', 'password', 'users'] },
			archiveViewPassword: { type: 'string', optional: false, nullable: true },
			archiveVisibleUserIds: { type: 'array', optional: false, nullable: false, items: { type: 'string', format: 'misskey:id' } },
			archiveUnpublished: { type: 'boolean', optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		streamId: { type: 'string', format: 'misskey:id' },
		visibility: { type: 'string', enum: ['public', 'followers', 'password', 'users'] },
		viewPassword: { type: 'string', nullable: true, maxLength: 128 },
		visibleUserIds: {
			type: 'array',
			uniqueItems: true,
			maxItems: 100,
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

		private liveArchiveAccessService: LiveArchiveAccessService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const stream = await this.twitchStreamsRepository.findOneBy({ id: ps.streamId });
			if (stream == null || stream.userId !== me.id || stream.source !== 'ome' || stream.isLive) {
				throw new ApiError(meta.errors.noSuchArchive);
			}

			// viewPassword が空にならないことを確認する (live-channels/update.ts と同じ防御。
			// 未設定のまま password モードへ切り替えると、誰も verify-archive-view-password で
			// トークンを取得できず永久にロックされるアーカイブができてしまうため)。
			const nextVisibility = ps.visibility ?? stream.archiveViewVisibility;
			if (nextVisibility === 'password') {
				const nextViewPassword = ps.viewPassword !== undefined ? ps.viewPassword : stream.archiveViewPassword;
				if (nextViewPassword == null || nextViewPassword.length === 0) {
					throw new ApiError(meta.errors.viewPasswordRequired);
				}
			}

			const updated = await this.liveArchiveAccessService.updateArchiveSettings(stream, {
				visibility: ps.visibility,
				viewPassword: ps.viewPassword,
				visibleUserIds: ps.visibleUserIds,
			});

			return {
				streamId: updated.id,
				archiveViewVisibility: updated.archiveViewVisibility,
				archiveViewPassword: updated.archiveViewPassword,
				archiveVisibleUserIds: updated.archiveVisibleUserIds,
				archiveUnpublished: updated.archiveUnpublishedAt != null,
			};
		});
	}
}
