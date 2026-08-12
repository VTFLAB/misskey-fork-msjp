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
import type { Config } from '@/config.js';
import { isAllowedLocalAutomationRequest } from '@/misc/local-automation-guard.js';

// bsky-fork 独自: LAN 内の自動化クライアント (LLM エージェント) がバグ報告・機能要望の
// 対応状況を更新するための endpoint。response は報告者本人の一覧 (/feedback) に表示される。
export const meta = {
	tags: ['feedback'],

	requireCredential: false,

	limit: {
		duration: 1000 * 60 * 10,
		max: 60,
	},

	errors: {
		accessDenied: {
			message: 'Access denied.',
			code: 'ACCESS_DENIED',
			id: 'e09adcc8-ca5c-4286-a294-f11200ba024a',
		},
		noSuchFeedback: {
			message: 'No such feedback.',
			code: 'NO_SUCH_FEEDBACK',
			id: '5b41b479-fc09-4274-bd69-1bc449655854',
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
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.userFeedbacksRepository)
		private userFeedbacksRepository: UserFeedbacksRepository,
	) {
		super(meta, paramDef, async (ps, me, token, file, cleanup, ip, headers) => {
			if (!isAllowedLocalAutomationRequest({
				allowedIps: this.config.updateInfoLocalPost?.allowedIps ?? [],
				ip,
				headers,
			})) {
				throw new ApiError(meta.errors.accessDenied, { ip: ip ?? null });
			}

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
