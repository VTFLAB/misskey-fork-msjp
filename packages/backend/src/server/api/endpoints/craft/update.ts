/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { CraftService } from '@/core/CraftService.js';
import { CraftWorldEntityService } from '@/core/entities/CraftWorldEntityService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { DI } from '@/di-symbols.js';
import type { CraftWorldsRepository } from '@/models/_.js';

export const meta = {
	tags: ['craft'],

	requireCredential: true,

	kind: 'write:account',

	prohibitMoved: true,

	limit: {
		duration: 1000 * 60 * 60,
		max: 120,
	},

	errors: {
		noSuchWorld: {
			message: 'No such world.',
			code: 'NO_SUCH_WORLD',
			id: '2b13200b-35f7-4324-b581-38eca3394659',
		},
		accessDenied: {
			message: 'Access denied.',
			code: 'ACCESS_DENIED',
			id: 'f90eb3d2-8dde-48bb-90f3-4417ac127437',
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
		name: { type: 'string', minLength: 1, maxLength: 128 },
		isPublic: { type: 'boolean' },
	},
	required: ['worldId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.craftWorldsRepository)
		private craftWorldsRepository: CraftWorldsRepository,

		private craftService: CraftService,
		private craftWorldEntityService: CraftWorldEntityService,
		private globalEventService: GlobalEventService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const world = await this.craftWorldsRepository.findOneBy({ id: ps.worldId });
			if (world == null) throw new ApiError(meta.errors.noSuchWorld);
			if (!await this.craftService.canManage(world, me)) throw new ApiError(meta.errors.accessDenied);

			const patch = {
				...(ps.name !== undefined ? { name: ps.name } : {}),
				...(ps.isPublic !== undefined ? { isPublic: ps.isPublic } : {}),
			};
			if (Object.keys(patch).length > 0) {
				await this.craftWorldsRepository.update(world.id, patch);
			}

			const packed = await this.craftWorldEntityService.pack(world.id);
			if (Object.keys(patch).length > 0) {
				this.globalEventService.publishCraftWorldStream(world.id, 'worldUpdated', {
					worldId: world.id,
					name: packed.name,
					isPublic: packed.isPublic,
				});
			}
			return packed;
		});
	}
}
