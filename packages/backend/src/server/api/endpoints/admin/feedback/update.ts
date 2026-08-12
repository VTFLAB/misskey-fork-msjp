/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { UserFeedbacksRepository } from '@/models/_.js';
import { userFeedbackStatuses } from '@/models/UserFeedback.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';

// bsky-fork 独自: バグ報告・機能要望の状態変更・返信 (モデレーター向け)。
// feedback/update-status-local (LAN 限定・LLM 向け) とセマンティクスを揃える。
export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	kind: 'write:admin:feedback',

	errors: {
		noSuchFeedback: {
			message: 'No such feedback.',
			code: 'NO_SUCH_FEEDBACK',
			id: '9586ec1d-47e4-4cbf-8369-2386412383d7',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			id: { type: 'string', optional: false, nullable: false, format: 'id' },
			status: { type: 'string', optional: false, nullable: false, enum: ['open', 'inProgress', 'resolved', 'rejected'] },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		feedbackId: { type: 'string', format: 'misskey:id' },
		status: { type: 'string', enum: userFeedbackStatuses },
		response: { type: 'string', nullable: true, maxLength: 8192 },
	},
	required: ['feedbackId', 'status'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.userFeedbacksRepository)
		private userFeedbacksRepository: UserFeedbacksRepository,
	) {
		super(meta, paramDef, async (ps) => {
			const feedback = await this.userFeedbacksRepository.findOneBy({ id: ps.feedbackId });
			if (feedback == null) throw new ApiError(meta.errors.noSuchFeedback);

			await this.userFeedbacksRepository.update(feedback.id, {
				status: ps.status,
				// response は明示的に渡されたときのみ更新する (undefined は据え置き、null はクリア)
				...(ps.response !== undefined ? { response: ps.response } : {}),
				updatedAt: new Date(),
			});

			return { id: feedback.id, status: ps.status };
		});
	}
}
