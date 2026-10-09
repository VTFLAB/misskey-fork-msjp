/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { CraftService } from '@/core/CraftService.js';
import { DI } from '@/di-symbols.js';
import type { CraftWorldsRepository } from '@/models/_.js';

export const meta = {
	tags: ['craft'],

	requireCredential: false,

	limit: {
		duration: 1000 * 60,
		max: 30,
	},

	errors: {
		noSuchWorld: {
			message: 'No such world.',
			code: 'NO_SUCH_WORLD',
			id: '130fd3e5-308e-486e-b8bb-ea6bbad05733',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			// [x, y, z, type, x, y, z, type, ...] の平坦な配列
			blocks: {
				type: 'array',
				optional: false, nullable: false,
				items: {
					type: 'number',
					optional: false, nullable: false,
				},
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		worldId: { type: 'string', format: 'misskey:id' },
	},
	required: ['worldId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.craftWorldsRepository)
		private craftWorldsRepository: CraftWorldsRepository,

		private craftService: CraftService,
	) {
		super(meta, paramDef, async (ps) => {
			const exists = await this.craftWorldsRepository.existsBy({ id: ps.worldId });
			if (!exists) throw new ApiError(meta.errors.noSuchWorld);

			return {
				blocks: await this.craftService.getBlocksFlat(ps.worldId),
			};
		});
	}
}
