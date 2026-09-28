/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { LastfmApiService } from '@/core/nowplaying/LastfmApiService.js';
import { NowPlayingService } from '@/core/nowplaying/NowPlayingService.js';

export const meta = {
	tags: ['nowplaying', 'account'],

	requireCredential: true,
	secure: true,

	description: 'Last.fm アカウント連携の認可 URL を発行する。',

	limit: {
		duration: 60 * 1000,
		max: 10,
	},

	errors: {
		notConfigured: {
			message: 'Last.fm integration is not configured on this instance.',
			code: 'NOT_CONFIGURED',
			id: '362ce843-d8b5-4a96-8799-ef530f46387d',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			url: { type: 'string', optional: false, nullable: false },
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
		private lastfmApiService: LastfmApiService,
		private nowPlayingService: NowPlayingService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!this.lastfmApiService.isEnabled) throw new ApiError(meta.errors.notConfigured);

			const url = await this.nowPlayingService.generateLastfmAuthUrl(me.id);
			return { url };
		});
	}
}
