/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { CraftWorldEntityService } from '@/core/entities/CraftWorldEntityService.js';
import { DI } from '@/di-symbols.js';
import type { CraftWorldsRepository } from '@/models/_.js';

export const meta = {
	tags: ['craft'],

	requireCredential: false,

	limit: {
		duration: 1000 * 60,
		max: 120,
	},

	errors: {
		noSuchWorld: {
			message: 'No such world.',
			code: 'NO_SUCH_WORLD',
			id: '1b14db43-1010-4835-b23b-bc187bb06805',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'CraftWorld',
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

		private craftWorldEntityService: CraftWorldEntityService,
	) {
		super(meta, paramDef, async (ps) => {
			const world = await this.craftWorldsRepository.findOneBy({ id: ps.worldId });
			if (world == null) throw new ApiError(meta.errors.noSuchWorld);

			return await this.craftWorldEntityService.pack(world);
		});
	}
}
