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

	kind: 'read:account',

	limit: {
		duration: 1000 * 60,
		max: 120,
	},

	errors: {
		noSuchWorld: {
			message: 'No such world.',
			code: 'NO_SUCH_WORLD',
			id: 'f4b3d3e2-724d-4f0d-a1d3-a2c6b0248229',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			// 保存されていなければ null
			state: {
				type: 'object',
				optional: false, nullable: true,
				additionalProperties: true,
			},
			updatedAt: {
				type: 'string',
				optional: false, nullable: true,
				format: 'date-time',
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
		super(meta, paramDef, async (ps, me) => {
			const exists = await this.craftWorldsRepository.existsBy({ id: ps.worldId });
			if (!exists) throw new ApiError(meta.errors.noSuchWorld);

			const saved = await this.craftService.getPlayerState(ps.worldId, me.id);
			return {
				state: saved?.state ?? null,
				updatedAt: saved?.updatedAt.toISOString() ?? null,
			};
		});
	}
}
