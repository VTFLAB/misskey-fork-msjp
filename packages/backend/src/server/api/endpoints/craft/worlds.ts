/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CraftWorldEntityService } from '@/core/entities/CraftWorldEntityService.js';
import { DI } from '@/di-symbols.js';
import type { CraftWorldsRepository } from '@/models/_.js';
import { QueryService } from '@/core/QueryService.js';

export const meta = {
	tags: ['craft'],

	requireCredential: false,

	limit: {
		duration: 1000 * 60,
		max: 60,
	},

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: { ref: 'CraftWorld' },
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
		my: { type: 'boolean', default: false },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.craftWorldsRepository)
		private craftWorldsRepository: CraftWorldsRepository,

		private craftWorldEntityService: CraftWorldEntityService,
		private queryService: QueryService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const query = this.queryService.makePaginationQuery(this.craftWorldsRepository.createQueryBuilder('world'), ps.sinceId, ps.untilId)
				.innerJoinAndSelect('world.user', 'user');

			if (ps.my && me) {
				query.andWhere('world.userId = :userId', { userId: me.id });
			} else {
				query.andWhere('world.isPublic = TRUE');
			}

			const worlds = await query.take(ps.limit).getMany();

			return await this.craftWorldEntityService.packMany(worlds);
		});
	}
}
