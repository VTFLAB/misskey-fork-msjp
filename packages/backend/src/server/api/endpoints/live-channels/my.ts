/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, Inject } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { LiveChannelService } from '@/core/live/LiveChannelService.js';

export const meta = {
	tags: ['live-channel', 'account'],

	requireCredential: true,
	kind: 'read:account',
	secure: true,

	description: '自分のライブチャンネル設定を返す。未開設なら channel: null。' +
		'OME 連携有効時は whipUrl を含む。',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			channel: {
				type: 'object',
				optional: false, nullable: true,
				properties: {
					id: { type: 'string', format: 'misskey:id', optional: false, nullable: false },
					userId: { type: 'string', format: 'misskey:id', optional: false, nullable: false },
					enabled: { type: 'boolean', optional: false, nullable: false },
					name: { type: 'string', optional: false, nullable: true },
					description: { type: 'string', optional: false, nullable: true },
					bannerId: { type: 'string', format: 'misskey:id', optional: false, nullable: true },
					bannerUrl: { type: 'string', optional: false, nullable: true },
					offlineImageId: { type: 'string', format: 'misskey:id', optional: false, nullable: true },
					offlineImageUrl: { type: 'string', optional: false, nullable: true },
					channelId: { type: 'string', format: 'misskey:id', optional: false, nullable: true },
					createdAt: { type: 'string', format: 'date-time', optional: false, nullable: false },
					autoPostNoteEnabled: { type: 'boolean', optional: false, nullable: false },
					streamKey: { type: 'string', optional: true, nullable: false },
					streamKeyRegeneratedAt: { type: 'string', format: 'date-time', optional: true, nullable: false },
					lastCutReason: { type: 'string', optional: true, nullable: true },
					autoPostNoteTemplate: { type: 'string', optional: true, nullable: true },
				},
			},
			streamKey: { type: 'string', optional: false, nullable: true },
			rtmpUrl: { type: 'string', optional: false, nullable: true },
			srtUrl: { type: 'string', optional: false, nullable: true },
			whipUrl: { type: 'string', optional: true, nullable: true },
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

		@Inject(DI.config)
		private config: Config,
	) {
		super(meta, paramDef, async (ps, me) => {
			const channel = await this.liveChannelService.show(me.id);
			if (channel == null) {
				return { channel: null, streamKey: null, rtmpUrl: null, srtUrl: null, whipUrl: null };
			}

			const ingest = this.config.ome != null
				? this.liveChannelService.generateIngestUrls(channel, this.config.ome)
				: null;

			return {
				channel: await this.liveChannelService.pack(channel, me),
				streamKey: channel.streamKey,
				rtmpUrl: null,
				srtUrl: null,
				whipUrl: ingest?.whip ?? null,
			};
		});
	}
}
