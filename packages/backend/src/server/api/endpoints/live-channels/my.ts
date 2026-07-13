/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { LiveChannelService } from '@/core/live/LiveChannelService.js';

export const meta = {
	tags: ['live-channel', 'account'],

	requireCredential: true,
	kind: 'read:account',
	secure: true,

	description: '自分のライブチャンネル設定を返す。未開設なら channel: null。' +
		'ingest 接続情報 (rtmpUrl/srtUrl/whipUrl) は Phase 2 (OME 連携) 実装まで null 固定。',

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
					createdAt: { type: 'string', format: 'date-time', optional: false, nullable: false },
					streamKey: { type: 'string', optional: true, nullable: false },
					streamKeyRegeneratedAt: { type: 'string', format: 'date-time', optional: true, nullable: false },
					lastCutReason: { type: 'string', optional: true, nullable: true },
				},
			},
			streamKey: { type: 'string', optional: false, nullable: true },
			rtmpUrl: { type: 'string', optional: false, nullable: true },
			srtUrl: { type: 'string', optional: false, nullable: true },
			whipUrl: { type: 'string', optional: false, nullable: true },
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
			const channel = await this.liveChannelService.show(me.id);
			if (channel == null) {
				return { channel: null, streamKey: null, rtmpUrl: null, srtUrl: null, whipUrl: null };
			}

			// ingest URL 3種は Phase 2 (WI-2.6, generateIngestUrls) 実装まで null 固定。
			return {
				channel: await this.liveChannelService.pack(channel, me),
				streamKey: channel.streamKey,
				rtmpUrl: null,
				srtUrl: null,
				whipUrl: null,
			};
		});
	}
}
