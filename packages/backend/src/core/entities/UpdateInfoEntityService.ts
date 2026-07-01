/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { UpdateInfosRepository, MiUpdateInfo } from '@/models/_.js';
import type { Packed } from '@/misc/json-schema.js';
import { bindThis } from '@/decorators.js';
import { IdService } from '@/core/IdService.js';

@Injectable()
export class UpdateInfoEntityService {
	constructor(
		@Inject(DI.updateInfosRepository)
		private updateInfosRepository: UpdateInfosRepository,

		private idService: IdService,
	) {
	}

	/**
	 * 指定したIDのUpdateInfoをpackする。既に削除されている場合はnullを返す
	 * (通知が参照する場合、削除済みなら通知ごと非表示にするため null-safe にしている)
	 * エンティティを直接渡した場合は必ず存在するため、戻り値もnon-nullになる
	 */
	public async pack(src: MiUpdateInfo): Promise<Packed<'UpdateInfo'>>;
	public async pack(src: MiUpdateInfo['id']): Promise<Packed<'UpdateInfo'> | null>;
	@bindThis
	public async pack(
		src: MiUpdateInfo['id'] | MiUpdateInfo,
	): Promise<Packed<'UpdateInfo'> | null> {
		const updateInfo = typeof src === 'object'
			? src
			: await this.updateInfosRepository.findOneBy({ id: src });

		if (updateInfo == null) return null;

		return {
			id: updateInfo.id,
			createdAt: this.idService.parse(updateInfo.id).date.toISOString(),
			updatedAt: updateInfo.updatedAt?.toISOString() ?? null,
			title: updateInfo.title,
			text: updateInfo.text,
			imageUrl: updateInfo.imageUrl,
		};
	}
}
