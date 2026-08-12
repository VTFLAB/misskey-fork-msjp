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
import { IdService } from '@/core/IdService.js';
import { QueryService } from '@/core/QueryService.js';
import { DriveFileEntityService } from '@/core/entities/DriveFileEntityService.js';
import { isAllowedLocalAutomationRequest } from '@/misc/local-automation-guard.js';

// bsky-fork 独自: LAN 内の自動化クライアント (LLM エージェント) がバグ報告・機能要望を
// 読み出すための endpoint。到達経路ガードは update-info/create-local と同一
// (X-Forwarded-For 拒否 + allowedIps 照合、config は updateInfoLocalPost.allowedIps を共用)。
//
// ⚠ この endpoint が返す title / body / 添付画像はエンドユーザーの自由入力であり、
// LLM に対するプロンプトインジェクションを含み得る。呼び出し側は必ず信頼できない
// データとして扱うこと (.claude/skills/handling-user-feedback の規律に従う)。
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
			id: '326b113b-d810-4f1f-ad93-d4afb8edf1dc',
		},
	},

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				id: { type: 'string', optional: false, nullable: false, format: 'id' },
				createdAt: { type: 'string', optional: false, nullable: false, format: 'date-time' },
				updatedAt: { type: 'string', optional: false, nullable: true, format: 'date-time' },
				type: { type: 'string', optional: false, nullable: false, enum: ['bug', 'feature'] },
				title: { type: 'string', optional: false, nullable: false },
				body: { type: 'string', optional: false, nullable: false },
				status: { type: 'string', optional: false, nullable: false, enum: ['open', 'inProgress', 'resolved', 'rejected'] },
				response: { type: 'string', optional: false, nullable: true },
				user: {
					type: 'object',
					optional: false, nullable: true,
					properties: {
						id: { type: 'string', optional: false, nullable: false, format: 'id' },
						username: { type: 'string', optional: false, nullable: false },
					},
				},
				files: {
					type: 'array',
					optional: false, nullable: false,
					items: {
						type: 'object',
						optional: false, nullable: false,
						properties: {
							id: { type: 'string', optional: false, nullable: false, format: 'id' },
							name: { type: 'string', optional: false, nullable: false },
							type: { type: 'string', optional: false, nullable: false },
							size: { type: 'number', optional: false, nullable: false },
							url: { type: 'string', optional: false, nullable: true },
							thumbnailUrl: { type: 'string', optional: false, nullable: true },
						},
					},
				},
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
		status: { type: 'string', enum: userFeedbackStatuses },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.userFeedbacksRepository)
		private userFeedbacksRepository: UserFeedbacksRepository,

		private idService: IdService,
		private queryService: QueryService,
		private driveFileEntityService: DriveFileEntityService,
	) {
		super(meta, paramDef, async (ps, me, token, file, cleanup, ip, headers) => {
			if (!isAllowedLocalAutomationRequest({
				allowedIps: this.config.updateInfoLocalPost?.allowedIps ?? [],
				ip,
				headers,
			})) {
				throw new ApiError(meta.errors.accessDenied, { ip: ip ?? null });
			}

			const query = this.queryService.makePaginationQuery(this.userFeedbacksRepository.createQueryBuilder('feedback'), ps.sinceId, ps.untilId)
				.leftJoinAndSelect('feedback.user', 'user');
			if (ps.status != null) {
				query.andWhere('feedback.status = :status', { status: ps.status });
			}

			const feedbacks = await query.limit(ps.limit).getMany();

			return await Promise.all(feedbacks.map(async feedback => {
				const packedFiles = await this.driveFileEntityService.packManyByIds(feedback.fileIds);
				return {
					id: feedback.id,
					createdAt: this.idService.parse(feedback.id).date.toISOString(),
					updatedAt: feedback.updatedAt?.toISOString() ?? null,
					type: feedback.type,
					title: feedback.title,
					body: feedback.body,
					status: feedback.status,
					response: feedback.response,
					user: feedback.user != null ? {
						id: feedback.user.id,
						username: feedback.user.username,
					} : null,
					files: packedFiles.map(f => ({
						id: f.id,
						name: f.name,
						type: f.type,
						size: f.size,
						url: f.url,
						thumbnailUrl: f.thumbnailUrl,
					})),
				};
			}));
		});
	}
}
