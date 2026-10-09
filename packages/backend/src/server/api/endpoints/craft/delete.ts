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

	requireCredential: true,

	kind: 'write:account',

	prohibitMoved: true,

	limit: {
		duration: 1000 * 60 * 60,
		max: 60,
	},

	errors: {
		noSuchWorld: {
			message: 'No such world.',
			code: 'NO_SUCH_WORLD',
			id: '80d21a93-40f4-4447-a423-ee27d2e4720c',
		},
		accessDenied: {
			message: 'Access denied.',
			code: 'ACCESS_DENIED',
			id: '978e3dd1-06f3-4b0a-a0b7-943819e46a64',
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
		super(meta, paramDef, async (ps, me) => {
			const world = await this.craftWorldsRepository.findOneBy({ id: ps.worldId });
			if (world == null) throw new ApiError(meta.errors.noSuchWorld);
			if (!await this.craftService.canManage(world, me)) throw new ApiError(meta.errors.accessDenied);

			await this.craftService.deleteWorld(world);
		});
	}
}
