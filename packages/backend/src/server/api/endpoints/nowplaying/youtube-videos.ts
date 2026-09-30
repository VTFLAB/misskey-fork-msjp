/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { MusicUrlResolverService } from '@/core/nowplaying/MusicUrlResolverService.js';

export const meta = {
	tags: ['nowplaying'],

	requireCredential: true,
	kind: 'read:account',

	description: 'YouTube の動画 ID (最大 50 件) の曲名・チャンネル名・サムネイルと再生可否をまとめて取得する。常駐プレイヤーのプレイリスト情報の定期更新と、YouTube プレイリストのインポートに使う。playlistId を渡すとプレイリスト名も返す。',

	limit: {
		duration: 60 * 1000,
		max: 12,
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			videos: {
				type: 'array',
				optional: false, nullable: false,
				items: {
					type: 'object',
					optional: false, nullable: false,
					properties: {
						videoId: { type: 'string', optional: false, nullable: false },
						status: {
							type: 'string',
							optional: false, nullable: false,
							enum: ['available', 'removed', 'private', 'error'],
						},
						title: { type: 'string', optional: false, nullable: true },
						author: { type: 'string', optional: false, nullable: true },
						thumbnailUrl: { type: 'string', optional: false, nullable: true },
					},
				},
			},
			playlistTitle: { type: 'string', optional: false, nullable: true },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		videoIds: {
			type: 'array',
			minItems: 1,
			maxItems: 50,
			uniqueItems: true,
			items: { type: 'string', pattern: '^[A-Za-z0-9_-]{11}$' },
		},
		playlistId: { type: 'string', pattern: '^[A-Za-z0-9_-]{2,64}$' },
	},
	required: ['videoIds'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private musicUrlResolverService: MusicUrlResolverService,
	) {
		super(meta, paramDef, async (ps) => {
			const [videos, playlistTitle] = await Promise.all([
				this.musicUrlResolverService.lookupYoutubeVideos(ps.videoIds),
				ps.playlistId != null ? this.musicUrlResolverService.lookupYoutubePlaylistTitle(ps.playlistId) : Promise.resolve(null),
			]);
			return { videos, playlistTitle };
		});
	}
}
