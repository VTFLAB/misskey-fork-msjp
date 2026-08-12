/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { UserFeedbacksRepository } from '@/models/_.js';
import { userFeedbackStatuses } from '@/models/UserFeedback.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { QueryService } from '@/core/QueryService.js';
import { DI } from '@/di-symbols.js';
import { UserFeedbackEntityService } from '@/core/entities/UserFeedbackEntityService.js';

// bsky-fork 独自: バグ報告・機能要望の全件一覧 (モデレーター向け)。
export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	kind: 'read:admin:feedback',

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
		status: { type: 'string', enum: userFeedbackStatuses },
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
		super(meta, paramDef, async (ps) => {
			const query = this.queryService.makePaginationQuery(this.userFeedbacksRepository.createQueryBuilder('feedback'), ps.sinceId, ps.untilId)
				.leftJoinAndSelect('feedback.user', 'user');
			if (ps.status != null) {
				query.andWhere('feedback.status = :status', { status: ps.status });
			}

			const feedbacks = await query.limit(ps.limit).getMany();

			return await Promise.all(feedbacks.map(x => this.userFeedbackEntityService.pack(x, { withUser: true })));
		});
	}
}
