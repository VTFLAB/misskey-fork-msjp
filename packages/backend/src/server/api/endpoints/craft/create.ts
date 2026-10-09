/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { CraftService, CRAFT_WORLD } from '@/core/CraftService.js';
import { CraftWorldEntityService } from '@/core/entities/CraftWorldEntityService.js';

export const meta = {
	tags: ['craft'],

	requireCredential: true,

	kind: 'write:account',

	prohibitMoved: true,

	limit: {
		duration: 1000 * 60 * 60,
		max: 20,
	},

	errors: {
		tooManyWorlds: {
			message: 'You cannot create a world any more.',
			code: 'TOO_MANY_WORLDS',
			id: 'df7c0b41-6ad0-4158-a4b6-9244fedb9eb1',
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
		name: { type: 'string', minLength: 1, maxLength: 128 },
		seed: { type: 'integer', minimum: 0, maximum: 2147483647, nullable: true },
		isPublic: { type: 'boolean', default: true },
	},
	required: ['name'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private craftService: CraftService,
		private craftWorldEntityService: CraftWorldEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const count = await this.craftService.countWorldsOf(me);
			if (count >= CRAFT_WORLD.maxWorldsPerUser) {
				throw new ApiError(meta.errors.tooManyWorlds);
			}

			const world = await this.craftService.createWorld(me, {
				name: ps.name,
				seed: ps.seed,
				isPublic: ps.isPublic,
			});

			return await this.craftWorldEntityService.pack(world);
		});
	}
}
