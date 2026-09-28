/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { NowPlayingService } from '@/core/nowplaying/NowPlayingService.js';
import { ListenBrainzApiError } from '@/core/nowplaying/ListenBrainzApiService.js';

export const meta = {
	tags: ['nowplaying', 'account'],

	requireCredential: true,
	secure: true,

	description: 'ListenBrainz の user token を検証してアカウントを連携する。',

	limit: {
		duration: 60 * 1000,
		max: 10,
	},

	errors: {
		invalidToken: {
			message: 'The given ListenBrainz token is invalid.',
			code: 'INVALID_TOKEN',
			id: '8c139118-8d1c-423b-981c-b6b316df5753',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			service: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['lastfm', 'listenbrainz'],
			},
			serviceUsername: { type: 'string', optional: false, nullable: true },
			createdAt: { type: 'string', optional: false, nullable: false, format: 'date-time' },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		token: { type: 'string', minLength: 1, maxLength: 256 },
	},
	required: ['token'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private nowPlayingService: NowPlayingService,
	) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const account = await this.nowPlayingService.linkListenBrainz(me.id, ps.token);
				return {
					service: account.service,
					serviceUsername: account.serviceUsername,
					createdAt: account.createdAt.toISOString(),
				};
			} catch (err) {
				if (err instanceof ListenBrainzApiError) {
					throw new ApiError(meta.errors.invalidToken, { reason: err.message });
				}
				throw err;
			}
		});
	}
}
