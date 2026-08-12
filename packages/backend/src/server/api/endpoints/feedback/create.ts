/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import type { UserFeedbacksRepository, DriveFilesRepository } from '@/models/_.js';
import { userFeedbackTypes } from '@/models/UserFeedback.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import { UserFeedbackEntityService } from '@/core/entities/UserFeedbackEntityService.js';

// bsky-fork 独自: バグ報告・機能要望の受付。ローカルユーザー (要認証) のみ。
// 投稿内容は LLM エージェントが参照するため、添付は画像のみに制限し、
// レートリミットでスパム的な大量投稿を抑止する。
export const meta = {
	tags: ['feedback'],

	requireCredential: true,

	prohibitMoved: true,

	kind: 'write:account',

	limit: {
		duration: 1000 * 60 * 60 * 24,
		max: 10,
		minInterval: 1000 * 30,
	},

	errors: {
		noSuchFile: {
			message: 'Some files are not found or not yours.',
			code: 'NO_SUCH_FILE',
			id: '714cc249-9e49-497e-931a-fd1749548d09',
		},
		invalidFileType: {
			message: 'Only image files can be attached.',
			code: 'INVALID_FILE_TYPE',
			id: 'b6aad397-9406-41bb-854e-9372de5a08ae',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'UserFeedback',
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		type: { type: 'string', enum: userFeedbackTypes },
		title: { type: 'string', minLength: 1, maxLength: 256 },
		body: { type: 'string', minLength: 1, maxLength: 8192 },
		fileIds: {
			type: 'array',
			uniqueItems: true,
			maxItems: 4,
			items: { type: 'string', format: 'misskey:id' },
		},
	},
	required: ['type', 'title', 'body'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.userFeedbacksRepository)
		private userFeedbacksRepository: UserFeedbacksRepository,

		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		private idService: IdService,
		private userFeedbackEntityService: UserFeedbackEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const fileIds = ps.fileIds ?? [];

			if (fileIds.length > 0) {
				// 自分の Drive ファイルのみ添付可。他人のファイル ID を指定した紐付けを防ぐ。
				const files = await this.driveFilesRepository.findBy({
					id: In(fileIds),
					userId: me.id,
				});
				if (files.length !== fileIds.length) throw new ApiError(meta.errors.noSuchFile);
				// スクリーンショット用途のため画像のみ許可 (SVG は script を含み得るため除外)。
				if (files.some(f => !f.type.startsWith('image/') || f.type === 'image/svg+xml')) {
					throw new ApiError(meta.errors.invalidFileType);
				}
			}

			const feedback = await this.userFeedbacksRepository.insertOne({
				id: this.idService.gen(),
				userId: me.id,
				type: ps.type,
				title: ps.title,
				body: ps.body,
				fileIds,
			});

			return await this.userFeedbackEntityService.pack(feedback);
		});
	}
}
