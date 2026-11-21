/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { RadioGardenError, RadioGardenService } from '@/core/radio/RadioGardenService.js';

export const meta = {
	tags: ['radio'],

	requireCredential: true,
	kind: 'read:account',

	description: 'Radio Garden のラジオ局の音声の URL を返す (bsky-fork 独自)。url は https の局だけで、ブラウザが局から直接受けるときに使う。proxyUrl はこのサーバーが中継する URL で、10 分だけ使える。',

	limit: {
		duration: 60 * 1000,
		max: 60,
	},

	errors: {
		unavailable: {
			message: 'Radio Garden is unavailable.',
			code: 'RADIO_GARDEN_UNAVAILABLE',
			id: '7a549df4-ada3-4c85-a706-3f7684bc2995',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			url: { type: 'string', optional: false, nullable: true },
			proxyUrl: { type: 'string', optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		channelId: { type: 'string', pattern: '^[A-Za-z0-9_-]{4,32}$' },
	},
	required: ['channelId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.config)
		private config: Config,
		private radioGardenService: RadioGardenService,
	) {
		super(meta, paramDef, async (ps, me) => {
			let url: URL;
			try {
				url = await this.radioGardenService.resolveStreamUrl(ps.channelId);
			} catch (err) {
				if (err instanceof RadioGardenError) throw new ApiError(meta.errors.unavailable);
				throw err;
			}
			const token = await this.radioGardenService.issueStreamToken(me.id, ps.channelId);
			return {
				// http の局は https のページから直接は再生できない (混在コンテンツ) ので、中継だけを使わせる
				url: url.protocol === 'https:' ? url.toString() : null,
				proxyUrl: `${this.config.url}/radio-garden-stream/${token}`,
			};
		});
	}
}
