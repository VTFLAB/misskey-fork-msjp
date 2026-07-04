/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { TwitchStreamBlocksRepository } from '@/models/_.js';
import { TwitchStreamBlockService } from '@/core/twitch/TwitchStreamBlockService.js';

export const meta = {
	tags: ['twitch'],

	requireCredential: true,
	kind: 'read:account',

	description: '自分の配信チャットのブロック一覧を取得する (配信者専用)。',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				id: { type: 'string', format: 'misskey:id', optional: false, nullable: false },
				createdAt: { type: 'string', format: 'date-time', optional: false, nullable: false },
				targetType: { type: 'string', enum: ['misskey', 'remote-guest', 'twitch'], optional: false, nullable: false },
				targetUser: { type: 'object', ref: 'UserLite', optional: false, nullable: true },
				targetRemoteGuest: {
					type: 'object',
					optional: false, nullable: true,
					properties: {
						username: { type: 'string', optional: false, nullable: false },
						host: { type: 'string', optional: false, nullable: false },
					},
				},
				targetTwitch: {
					type: 'object',
					optional: false, nullable: true,
					properties: {
						userName: { type: 'string', optional: false, nullable: false },
						displayName: { type: 'string', optional: false, nullable: true },
					},
				},
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.twitchStreamBlocksRepository)
		private twitchStreamBlocksRepository: TwitchStreamBlocksRepository,

		private twitchStreamBlockService: TwitchStreamBlockService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const query = this.twitchStreamBlocksRepository.createQueryBuilder('block')
				.where('block.userId = :meId', { meId: me.id })
				.orderBy('block.id', 'DESC')
				.take(ps.limit);
			if (ps.sinceId) query.andWhere('block.id > :sinceId', { sinceId: ps.sinceId });
			if (ps.untilId) query.andWhere('block.id < :untilId', { untilId: ps.untilId });

			const blocks = await query.getMany();
			return await this.twitchStreamBlockService.packMany(blocks);
		});
	}
}
