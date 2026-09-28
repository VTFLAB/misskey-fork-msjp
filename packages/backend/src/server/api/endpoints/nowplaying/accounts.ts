/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { NowPlayingService } from '@/core/nowplaying/NowPlayingService.js';
import { LastfmApiService } from '@/core/nowplaying/LastfmApiService.js';

export const meta = {
	tags: ['nowplaying', 'account'],

	requireCredential: true,
	kind: 'read:account',

	description: '自分の NowPlaying (Last.fm / ListenBrainz) 連携状態を返す。lastfmAvailable はこのインスタンスで Last.fm 連携が有効かどうか。',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			lastfmAvailable: { type: 'boolean', optional: false, nullable: false },
			accounts: {
				type: 'array',
				optional: false, nullable: false,
				items: {
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
		private nowPlayingService: NowPlayingService,
		private lastfmApiService: LastfmApiService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const accounts = await this.nowPlayingService.listAccounts(me.id);
			return {
				lastfmAvailable: this.lastfmApiService.isEnabled,
				accounts: accounts.map(a => ({
					service: a.service,
					serviceUsername: a.serviceUsername,
					createdAt: a.createdAt.toISOString(),
				})),
			};
		});
	}
}
