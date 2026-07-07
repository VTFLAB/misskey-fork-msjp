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
	kind: 'write:account',
	prohibitMoved: true,

	description: '配信者自身が配信開始前にチャット動作確認 (プレビュー) を行うための配信セッションを find-or-create する。' +
		'返る stream は twitch/streams/show と同形で isPreview: true が付く。配信中判定 (isLive) には一切影響しない。',

	errors: {
		notLinked: {
			message: 'The user has not linked a Twitch account.',
			code: 'TWITCH_NOT_LINKED',
			id: 'c9f8d4e2-2b0a-4f7e-9b2b-9e6e6e9f9c1a',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			id: { type: 'string', format: 'misskey:id', optional: false, nullable: false },
			title: { type: 'string', optional: false, nullable: false },
			gameName: { type: 'string', optional: false, nullable: true },
			viewerCount: { type: 'number', optional: false, nullable: false },
			thumbnailUrl: { type: 'string', optional: false, nullable: true },
			startedAt: { type: 'string', format: 'date-time', optional: false, nullable: false },
			isPreview: { type: 'boolean', optional: false, nullable: false },
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
		@Inject(DI.twitchAccountsRepository)
		private twitchAccountsRepository: TwitchAccountsRepository,

		private twitchStreamService: TwitchStreamService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const account = await this.twitchAccountsRepository.findOneBy({ userId: me.id });
			if (account == null) throw new ApiError(meta.errors.notLinked);

			const stream = await this.twitchStreamService.findOrCreatePreviewStream(account);

			return {
				id: stream.id,
				title: stream.title,
				gameName: stream.gameName,
				viewerCount: stream.viewerCount,
				thumbnailUrl: stream.thumbnailUrl,
				startedAt: stream.startedAt.toISOString(),
				isPreview: true,
			};
		});
	}
}
