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

	description: 'Radio Garden で地点とラジオ局を検索する (bsky-fork 独自)。それぞれ最大 30 件。',

	limit: {
		duration: 60 * 1000,
		max: 60,
	},

	errors: {
		unavailable: {
			message: 'Radio Garden is unavailable.',
			code: 'RADIO_GARDEN_UNAVAILABLE',
			id: '3335f548-d755-47db-b334-83084ced52ac',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			places: {
				type: 'array',
				optional: false, nullable: false,
				items: {
					type: 'object',
					optional: false, nullable: false,
					properties: {
						id: { type: 'string', optional: false, nullable: false },
						title: { type: 'string', optional: false, nullable: false },
						country: { type: 'string', optional: false, nullable: false },
						count: { type: 'integer', optional: false, nullable: false },
					},
				},
			},
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
		query: { type: 'string', minLength: 1, maxLength: 100 },
	},
	required: ['query'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private radioGardenService: RadioGardenService,
	) {
		super(meta, paramDef, async (ps) => {
			if (ps.query.trim() === '') return { places: [], channels: [] };
			try {
				return await this.radioGardenService.search(ps.query);
			} catch (err) {
				if (err instanceof RadioGardenError) throw new ApiError(meta.errors.unavailable);
				throw err;
			}
		});
	}
}
