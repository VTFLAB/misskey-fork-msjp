/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { LiveChannelService } from '@/core/live/LiveChannelService.js';

export const meta = {
	tags: ['live-channel'],

	requireCredential: false,

	description: '指定ユーザーのライブチャンネル設定を返す。チャンネル未開設 (live_channel 行が無い) 場合は NO_SUCH_CHANNEL。' +
		'ストリームキー等の秘匿フィールドは本人がログインしている場合のみ返す。',

	errors: {
		noSuchChannel: {
			message: 'The user has no live channel.',
			code: 'NO_SUCH_CHANNEL',
			id: '7c9f1f2e-2f3a-4b1a-9b3a-9b7b6a1c2d3e',
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
			channelId: { type: 'string', format: 'misskey:id', optional: false, nullable: true },
			createdAt: { type: 'string', format: 'date-time', optional: false, nullable: false },
			streamKey: { type: 'string', optional: true, nullable: false },
			streamKeyRegeneratedAt: { type: 'string', format: 'date-time', optional: true, nullable: false },
			lastCutReason: { type: 'string', optional: true, nullable: true },
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
		private liveChannelService: LiveChannelService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const channel = await this.liveChannelService.show(ps.userId);
			if (channel == null) throw new ApiError(meta.errors.noSuchChannel);

			return await this.liveChannelService.pack(channel, me);
		});
	}
}
