/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { MusicUrlResolverService } from '@/core/nowplaying/MusicUrlResolverService.js';

export const meta = {
	tags: ['nowplaying'],

	requireCredential: true,
	kind: 'read:account',

	description: '貼られた音楽共有 URL (Spotify / YouTube / YouTube Music / Apple Music / Amazon Music / その他) をタイトル・アーティスト・サムネイルに解決する。',

	limit: {
		duration: 60 * 1000,
		max: 30,
	},

	errors: {
		invalidUrl: {
			message: 'The given URL is not a valid http(s) URL.',
			code: 'INVALID_URL',
			id: '3b0888a8-ff6e-4f2f-92a5-cd5482cb7bb2',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			service: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['spotify', 'youtube', 'youtubeMusic', 'appleMusic', 'amazonMusic', 'other'],
			},
			serviceLabel: { type: 'string', optional: false, nullable: false },
			title: { type: 'string', optional: false, nullable: true },
			artist: { type: 'string', optional: false, nullable: true },
			url: { type: 'string', optional: false, nullable: false },
			thumbnailUrl: { type: 'string', optional: false, nullable: true },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		url: { type: 'string', minLength: 1, maxLength: 2048 },
	},
	required: ['url'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private musicUrlResolverService: MusicUrlResolverService,
	) {
		super(meta, paramDef, async (ps) => {
			try {
				return await this.musicUrlResolverService.resolve(ps.url);
			} catch (err) {
				throw new ApiError(meta.errors.invalidUrl, { reason: err instanceof Error ? err.message : String(err) });
			}
		});
	}
}
