/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { UserFeedbacksRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { QueryService } from '@/core/QueryService.js';
import { DI } from '@/di-symbols.js';
import { UserFeedbackEntityService } from '@/core/entities/UserFeedbackEntityService.js';

// bsky-fork 独自: 自分が送ったバグ報告・機能要望の一覧 (状態確認用)。
export const meta = {
	tags: ['feedback'],

	requireCredential: true,

	kind: 'read:account',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'UserFeedback',
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
		@Inject(DI.userFeedbacksRepository)
		private userFeedbacksRepository: UserFeedbacksRepository,

		private userFeedbackEntityService: UserFeedbackEntityService,
		private queryService: QueryService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const query = this.queryService.makePaginationQuery(this.userFeedbacksRepository.createQueryBuilder('feedback'), ps.sinceId, ps.untilId)
				.andWhere('feedback.userId = :meId', { meId: me.id });

			const feedbacks = await query.limit(ps.limit).getMany();

			return await this.userFeedbackEntityService.packMany(feedbacks);
		});
	}
}
