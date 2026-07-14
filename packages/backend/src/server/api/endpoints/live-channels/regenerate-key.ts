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

	description: 'ストリームキーを再生成する。旧キーは即座に無効化される。' +
		'Phase 2 (OME 連携) では旧キーでの既存接続も強制切断するが、Phase 1 では乱数の入れ替えのみ行う。',

	limit: {
		duration: 60 * 1000,
		max: 5,
	},

	errors: {
		noSuchChannel: {
			message: 'The user has no live channel.',
			code: 'NO_SUCH_CHANNEL',
			id: '9e7eec3b-7183-4a40-8ea1-f00304671075',
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
			if (existing == null) throw new ApiError(meta.errors.noSuchChannel);

			const regenerated = await this.liveChannelService.regenerateStreamKey(me.id);
			return await this.liveChannelService.pack(regenerated, me);
		});
	}
}
