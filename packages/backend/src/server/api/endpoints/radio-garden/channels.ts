/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { RadioGardenError, RadioGardenService } from '@/core/radio/RadioGardenService.js';

export const meta = {
	tags: ['radio'],

	requireCredential: true,
	kind: 'read:account',

	description: 'Radio Garden の地点にあるラジオ局の一覧を返す (bsky-fork 独自)。lang に利用者の表示言語 (ja-JP など) を渡すと、地名・国名をその言語で返す (Radio Garden が訳していない言語は英語)。',

	limit: {
		duration: 60 * 1000,
		max: 120,
	},

	errors: {
		unavailable: {
			message: 'Radio Garden is unavailable.',
			code: 'RADIO_GARDEN_UNAVAILABLE',
			id: '84bf9149-de6b-4047-9cd9-d58a3e1d4c69',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			placeId: { type: 'string', optional: false, nullable: false },
			title: { type: 'string', optional: false, nullable: false },
			country: { type: 'string', optional: false, nullable: false },
			channels: {
				type: 'array',
				optional: false, nullable: false,
				items: {
					type: 'object',
					optional: false, nullable: false,
					properties: {
						id: { type: 'string', optional: false, nullable: false },
						title: { type: 'string', optional: false, nullable: false },
						placeId: { type: 'string', optional: false, nullable: true },
						placeTitle: { type: 'string', optional: false, nullable: false },
						country: { type: 'string', optional: false, nullable: false },
						secure: { type: 'boolean', optional: false, nullable: false },
					},
				},
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		placeId: { type: 'string', pattern: '^[A-Za-z0-9_-]{4,32}$' },
		lang: { type: 'string', maxLength: 32 },
	},
	required: ['placeId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private radioGardenService: RadioGardenService,
	) {
		super(meta, paramDef, async (ps) => {
			try {
				return await this.radioGardenService.getPlaceChannels(ps.placeId, ps.lang);
			} catch (err) {
				if (err instanceof RadioGardenError) throw new ApiError(meta.errors.unavailable);
				throw err;
			}
		});
	}
}
