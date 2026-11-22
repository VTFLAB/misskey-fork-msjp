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

	description: 'Radio Garden の地点 (ラジオ局のある町) の一覧を返す (bsky-fork 独自)。ラジオウィジェットの地球儀に描く点で、列ごとの配列で返す。lang に利用者の表示言語 (ja-JP など) を渡すと、地名・国名をその言語で返す (Radio Garden が訳していない言語は英語)。',

	limit: {
		duration: 60 * 1000,
		max: 10,
	},

	errors: {
		unavailable: {
			message: 'Radio Garden is unavailable.',
			code: 'RADIO_GARDEN_UNAVAILABLE',
			id: '46a6456e-314d-4f8f-a935-e312748b7e74',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			version: { type: 'string', optional: false, nullable: false },
			ids: { type: 'array', optional: false, nullable: false, items: { type: 'string', optional: false, nullable: false } },
			titles: { type: 'array', optional: false, nullable: false, items: { type: 'string', optional: false, nullable: false } },
			countries: { type: 'array', optional: false, nullable: false, items: { type: 'string', optional: false, nullable: false } },
			countryIndex: { type: 'array', optional: false, nullable: false, items: { type: 'integer', optional: false, nullable: false } },
			geo: { type: 'array', optional: false, nullable: false, items: { type: 'number', optional: false, nullable: false } },
			sizes: { type: 'array', optional: false, nullable: false, items: { type: 'integer', optional: false, nullable: false } },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		lang: { type: 'string', maxLength: 32 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private radioGardenService: RadioGardenService,
	) {
		super(meta, paramDef, async (ps) => {
			try {
				return await this.radioGardenService.getPlaces(ps.lang);
			} catch (err) {
				if (err instanceof RadioGardenError) throw new ApiError(meta.errors.unavailable);
				throw err;
			}
		});
	}
}
