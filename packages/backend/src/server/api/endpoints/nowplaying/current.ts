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
	kind: 'read:account',

	description: 'リンク済の Last.fm / ListenBrainz アカウントから現在再生中のトラックを返す。再生中のトラックが無ければ null。',

	errors: {
		noLinkedAccount: {
			message: 'No Last.fm or ListenBrainz account is linked.',
			code: 'NO_LINKED_ACCOUNT',
			id: '4a27f684-3109-41f2-9d1a-19121685fb76',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: true,
		properties: {
			source: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['listenbrainz', 'lastfm'],
			},
			title: { type: 'string', optional: false, nullable: false },
			artist: { type: 'string', optional: false, nullable: false },
			album: { type: 'string', optional: false, nullable: true },
			url: { type: 'string', optional: false, nullable: true },
			thumbnailUrl: { type: 'string', optional: false, nullable: true },
			serviceLabel: { type: 'string', optional: false, nullable: false },
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
		private nowPlayingService: NowPlayingService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const accounts = await this.nowPlayingService.listAccounts(me.id);
			if (accounts.length === 0) throw new ApiError(meta.errors.noLinkedAccount);

			return await this.nowPlayingService.getCurrent(me.id);
		});
	}
}
