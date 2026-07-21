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

	description: '配信者本人が自分の配信アーカイブの公開を取り消す (冪等)。Google Drive / YouTube 上の実ファイルは削除しない。' +
		'MSJP 側の一覧・視聴・コメントリプレイから見えなくなるのみで、再公開する endpoint は存在しない (一方向)。',

	errors: {
		noSuchArchive: {
			message: 'No such archive owned by you.',
			code: 'NO_SUCH_ARCHIVE',
			id: '3bc860ee-d981-4b90-a1d2-9c7f99f4f95e',
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

			// LiveArchiveAccessService.unpublishArchive は既に冪等実装済み (archiveUnpublishedAt が
			// 非 null なら何もせず現在値を返す) なので、ここでの事前チェックは不要。
			const updated = await this.liveArchiveAccessService.unpublishArchive(stream);

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
