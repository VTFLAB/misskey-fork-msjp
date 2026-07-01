/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { MiUser } from '@/models/User.js';
import type { UpdateInfosRepository, MiUpdateInfo, UsersRepository } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import { Packed } from '@/misc/json-schema.js';
import { IdService } from '@/core/IdService.js';
import { UpdateInfoEntityService } from '@/core/entities/UpdateInfoEntityService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { QueryService } from '@/core/QueryService.js';

@Injectable()
export class UpdateInfoService {
	constructor(
		@Inject(DI.updateInfosRepository)
		private updateInfosRepository: UpdateInfosRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private idService: IdService,
		private queryService: QueryService,
		private notificationService: NotificationService,
		private moderationLogService: ModerationLogService,
		private updateInfoEntityService: UpdateInfoEntityService,
	) {
	}

	@bindThis
	public async create(values: { title: string; text: string; imageUrl?: string | null }, moderator?: MiUser): Promise<{ raw: MiUpdateInfo; packed: Packed<'UpdateInfo'> }> {
		const updateInfo = await this.updateInfosRepository.insertOne({
			id: this.idService.gen(),
			updatedAt: null,
			title: values.title,
			text: values.text,
			imageUrl: values.imageUrl ?? null,
		});

		const packed = await this.updateInfoEntityService.pack(updateInfo);

		// ローカルの有効なユーザー全員に通知として配信する
		const localActiveUsers = await this.usersRepository.findBy({
			host: IsNull(),
			isSuspended: false,
			isDeleted: false,
		});

		for (const user of localActiveUsers) {
			this.notificationService.createNotification(user.id, 'updateInfo', {
				updateInfoId: updateInfo.id,
			});
		}

		if (moderator) {
			this.moderationLogService.log(moderator, 'createUpdateInfo', {
				updateInfoId: updateInfo.id,
				updateInfo: updateInfo,
			});
		}

		return {
			raw: updateInfo,
			packed: packed,
		};
	}

	@bindThis
	public async update(updateInfo: MiUpdateInfo, values: { title: string; text: string; imageUrl?: string | null }, moderator?: MiUser): Promise<void> {
		await this.updateInfosRepository.update(updateInfo.id, {
			updatedAt: new Date(),
			title: values.title,
			text: values.text,
			imageUrl: values.imageUrl ?? null,
		});

		if (moderator) {
			const after = await this.updateInfosRepository.findOneByOrFail({ id: updateInfo.id });

			this.moderationLogService.log(moderator, 'updateUpdateInfo', {
				updateInfoId: updateInfo.id,
				before: updateInfo,
				after: after,
			});
		}
	}

	@bindThis
	public async delete(updateInfo: MiUpdateInfo, moderator?: MiUser): Promise<void> {
		await this.updateInfosRepository.delete(updateInfo.id);

		if (moderator) {
			this.moderationLogService.log(moderator, 'deleteUpdateInfo', {
				updateInfoId: updateInfo.id,
				updateInfo: updateInfo,
			});
		}
	}

	@bindThis
	public async list(ps: { limit: number; sinceId?: string; untilId?: string }): Promise<MiUpdateInfo[]> {
		const query = this.queryService.makePaginationQuery(this.updateInfosRepository.createQueryBuilder('updateInfo'), ps.sinceId, ps.untilId);

		return await query.limit(ps.limit).getMany();
	}

	@bindThis
	public async show(id: MiUpdateInfo['id']): Promise<Packed<'UpdateInfo'> | null> {
		return await this.updateInfoEntityService.pack(id);
	}
}
