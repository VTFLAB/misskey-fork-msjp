/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { UpdateInfoService } from '@/core/UpdateInfoService.js';
import { UpdateInfoEntityService } from '@/core/entities/UpdateInfoEntityService.js';

export const meta = {
	tags: ['meta'],

	requireCredential: false,

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'UpdateInfo',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private updateInfoService: UpdateInfoService,
		private updateInfoEntityService: UpdateInfoEntityService,
	) {
		super(meta, paramDef, async (ps) => {
			const updateInfos = await this.updateInfoService.list({
				limit: ps.limit,
				sinceId: ps.sinceId,
				untilId: ps.untilId,
			});

			return await Promise.all(updateInfos.map(x => this.updateInfoEntityService.pack(x)));
		});
	}
}
