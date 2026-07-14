/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { LiveChannelService } from '@/core/live/LiveChannelService.js';

export const meta = {
	tags: ['live-channel', 'account'],

	requireCredential: true,
	kind: 'write:account',
	secure: true,

	description: 'ライブチャンネル (自己配信) 機能を有効化する。既に live_channel 行があれば ALREADY_EXISTS。',

	limit: {
		duration: 60 * 1000,
		max: 5,
	},

	errors: {
		alreadyExists: {
			message: 'You already have a live channel.',
			code: 'ALREADY_EXISTS',
			id: '07813309-ac5e-43f8-9887-a8e5d0ded5bb',
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
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private liveChannelService: LiveChannelService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const existing = await this.liveChannelService.show(me.id);
			if (existing != null) throw new ApiError(meta.errors.alreadyExists);

			const created = await this.liveChannelService.create(me.id);
			return await this.liveChannelService.pack(created, me);
		});
	}
}
