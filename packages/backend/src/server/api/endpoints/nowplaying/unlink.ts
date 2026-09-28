/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { NowPlayingService } from '@/core/nowplaying/NowPlayingService.js';

export const meta = {
	tags: ['nowplaying', 'account'],

	requireCredential: true,
	secure: true,

	description: 'NowPlaying の Last.fm / ListenBrainz アカウント連携を解除する。',

	limit: {
		duration: 60 * 1000,
		max: 10,
	},

	errors: {
		notLinked: {
			message: 'No such account is linked.',
			code: 'NOT_LINKED',
			id: '5ba6b0da-6851-48a6-a4dd-15060b7e3bc7',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		service: {
			type: 'string',
			enum: ['lastfm', 'listenbrainz'],
		},
	},
	required: ['service'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private nowPlayingService: NowPlayingService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const unlinked = await this.nowPlayingService.unlink(me.id, ps.service);
			if (!unlinked) throw new ApiError(meta.errors.notLinked);
		});
	}
}
