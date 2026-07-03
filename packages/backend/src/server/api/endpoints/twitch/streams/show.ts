/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import type { TwitchAccountsRepository } from '@/models/_.js';
import { TwitchStreamService } from '@/core/twitch/TwitchStreamService.js';

export const meta = {
	tags: ['twitch'],

	requireCredential: true,
	kind: 'read:account',

	description: '指定ユーザーの Twitch 配信状態を返す。連携済みなら twitchLogin は常に返り、配信中なら stream が非 null。',

	errors: {
		notLinked: {
			message: 'The user has not linked a Twitch account.',
			code: 'TWITCH_NOT_LINKED',
			id: '1669e0fa-787e-49fa-8612-6a04cb6cf98d',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			twitchLogin: { type: 'string', optional: false, nullable: false },
			twitchDisplayName: { type: 'string', optional: false, nullable: false },
			stream: {
				type: 'object',
				optional: false, nullable: true,
				properties: {
					id: { type: 'string', format: 'misskey:id', optional: false, nullable: false },
					title: { type: 'string', optional: false, nullable: false },
					gameName: { type: 'string', optional: false, nullable: true },
					viewerCount: { type: 'number', optional: false, nullable: false },
					thumbnailUrl: { type: 'string', optional: false, nullable: true },
					startedAt: { type: 'string', format: 'date-time', optional: false, nullable: false },
				},
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
	},
	required: ['userId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.twitchAccountsRepository)
		private twitchAccountsRepository: TwitchAccountsRepository,

		private twitchStreamService: TwitchStreamService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const account = await this.twitchAccountsRepository.findOneBy({ userId: ps.userId });
			if (account == null) throw new ApiError(meta.errors.notLinked);

			const stream = await this.twitchStreamService.getLiveStreamByUserId(ps.userId);

			return {
				twitchLogin: account.twitchLogin,
				twitchDisplayName: account.twitchDisplayName,
				stream: stream == null ? null : {
					id: stream.id,
					title: stream.title,
					gameName: stream.gameName,
					viewerCount: stream.viewerCount,
					thumbnailUrl: stream.thumbnailUrl,
					startedAt: stream.startedAt.toISOString(),
				},
			};
		});
	}
}
