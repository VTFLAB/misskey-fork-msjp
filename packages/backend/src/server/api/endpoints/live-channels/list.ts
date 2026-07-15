/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { QueryService } from '@/core/QueryService.js';
import type { LiveChannelsRepository, TwitchStreamsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { LiveChannelService } from '@/core/live/LiveChannelService.js';

export const meta = {
	tags: ['live-channel'],

	requireCredential: false,

	description: '配信機能が有効な配信チャンネルの一覧を返す (`/live` の配信チャンネルタブ用)。' +
		'MSJP配信・Twitch配信いずれの配信中状態も twitch_stream(isLive=true) を突合して isLive/startedAt に反映する。',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				id: { type: 'string', format: 'misskey:id', optional: false, nullable: false },
				userId: { type: 'string', format: 'misskey:id', optional: false, nullable: false },
				name: { type: 'string', optional: false, nullable: true },
				description: { type: 'string', optional: false, nullable: true },
				bannerUrl: { type: 'string', optional: false, nullable: true },
				offlineImageUrl: { type: 'string', optional: false, nullable: true },
				channelId: { type: 'string', format: 'misskey:id', optional: false, nullable: true },
				isLive: { type: 'boolean', optional: false, nullable: false },
				startedAt: { type: 'string', format: 'date-time', optional: false, nullable: true },
				user: {
					type: 'object',
					optional: false, nullable: false,
					ref: 'UserLite',
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
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.liveChannelsRepository)
		private liveChannelsRepository: LiveChannelsRepository,

		@Inject(DI.twitchStreamsRepository)
		private twitchStreamsRepository: TwitchStreamsRepository,

		private userEntityService: UserEntityService,
		private liveChannelService: LiveChannelService,
		private queryService: QueryService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const query = this.queryService.makePaginationQuery(this.liveChannelsRepository.createQueryBuilder('liveChannel'), ps.sinceId, ps.untilId)
				.andWhere('liveChannel.enabled = TRUE');

			const channels = await query
				.limit(ps.limit)
				.getMany();

			if (channels.length === 0) return [];

			// 少数想定でDBサブクエリ化はせず、別クエリ→Mapで突合する。MSJP配信 (source='ome') / Twitch配信のいずれの配信中セッションも対象。
			const liveStreams = await this.twitchStreamsRepository.findBy({ isLive: true });
			const liveByUserId = new Map(liveStreams.map(s => [s.userId, s]));

			const users = await this.userEntityService.packMany(channels.map(c => c.userId), me);
			const userById = new Map(users.map(u => [u.id, u]));

			const packed = await Promise.all(channels.map(async channel => {
				const user = userById.get(channel.userId);
				if (user == null) return null;

				const live = liveByUserId.get(channel.userId);
				const base = await this.liveChannelService.packForList(channel, live != null, live?.startedAt ?? null);

				return { ...base, user };
			}));

			return packed.filter(x => x != null);
		});
	}
}
