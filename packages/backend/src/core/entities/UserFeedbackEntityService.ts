/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import type { MiUserFeedback } from '@/models/_.js';
import type { Packed } from '@/misc/json-schema.js';
import { bindThis } from '@/decorators.js';
import { IdService } from '@/core/IdService.js';
import { DriveFileEntityService } from '@/core/entities/DriveFileEntityService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';

// bsky-fork 独自: ユーザーからのバグ報告・機能要望の pack。
// withUser は admin 向け一覧でのみ true (本人向け一覧では自明なので含めない)。
@Injectable()
export class UserFeedbackEntityService {
	constructor(
		private idService: IdService,
		private driveFileEntityService: DriveFileEntityService,
		private userEntityService: UserEntityService,
	) {
	}

	@bindThis
	public async pack(src: MiUserFeedback, opts: { withUser?: boolean } = {}): Promise<Packed<'UserFeedback'>> {
		return {
			id: src.id,
			createdAt: this.idService.parse(src.id).date.toISOString(),
			updatedAt: src.updatedAt?.toISOString() ?? null,
			type: src.type,
			title: src.title,
			body: src.body,
			status: src.status,
			response: src.response,
			// 報告者が削除済みアカウントの場合は null (relation 未ロード時に withUser を
			// 指定した場合は userId から pack する)
			...(opts.withUser ? {
				user: src.user != null || src.userId != null
					? await this.userEntityService.pack(src.user ?? src.userId).catch(() => null)
					: null,
			} : {}),
			// 添付が Drive 側で削除済みの場合は packManyByIds が黙って間引くため、
			// files.length < fileIds.length になり得る (報告一覧では許容)。
			files: await this.driveFileEntityService.packManyByIds(src.fileIds),
		};
	}

	@bindThis
	public async packMany(src: MiUserFeedback[], opts: { withUser?: boolean } = {}): Promise<Packed<'UserFeedback'>[]> {
		return Promise.all(src.map(x => this.pack(x, opts)));
	}
}
