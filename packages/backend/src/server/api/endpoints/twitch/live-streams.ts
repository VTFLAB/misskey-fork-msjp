/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { TwitchStreamService } from '@/core/twitch/TwitchStreamService.js';

export const meta = {
	tags: ['twitch'],

	requireCredential: true,
	kind: 'read:account',

	description: '現在配信中の Twitch 連携ユーザーの一覧を返す (視聴者数の多い順)。',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				user: {
					type: 'object',
					optional: false, nullable: false,
					ref: 'UserLite',
				},
				twitchLogin: { type: 'string', optional: false, nullable: false },
				title: { type: 'string', optional: false, nullable: false },
				gameName: { type: 'string', optional: false, nullable: true },
				viewerCount: { type: 'number', optional: false, nullable: false },
				thumbnailUrl: { type: 'string', optional: false, nullable: true },
				startedAt: { type: 'string', format: 'date-time', optional: false, nullable: false },
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private userEntityService: UserEntityService,
		private twitchStreamService: TwitchStreamService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const streams = await this.twitchStreamService.getAllLiveStreams();
			if (streams.length === 0) return [];

			const users = await this.userEntityService.packMany(streams.map(s => s.userId), me);
			const userById = new Map(users.map(u => [u.id, u]));

			return streams.flatMap(s => {
				const user = userById.get(s.userId);
				if (user == null) return [];
				return [{
					user,
					twitchLogin: s.twitchLogin,
					title: s.title,
					gameName: s.gameName,
					viewerCount: s.viewerCount,
					thumbnailUrl: s.thumbnailUrl,
					startedAt: s.startedAt.toISOString(),
				}];
			});
		});
	}
}
