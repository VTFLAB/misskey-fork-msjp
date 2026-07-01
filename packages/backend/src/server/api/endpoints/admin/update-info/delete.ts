/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UpdateInfosRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { UpdateInfoService } from '@/core/UpdateInfoService.js';
import { ApiError } from '../../../error.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	kind: 'write:admin:update-info',

	errors: {
		noSuchUpdateInfo: {
			message: 'No such update info.',
			code: 'NO_SUCH_UPDATE_INFO',
			id: '3e5e5b50-8b7f-4be4-96fa-a64974bd47f3',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		id: { type: 'string', format: 'misskey:id' },
	},
	required: ['id'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.updateInfosRepository)
		private updateInfosRepository: UpdateInfosRepository,

		private updateInfoService: UpdateInfoService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const updateInfo = await this.updateInfosRepository.findOneBy({ id: ps.id });

			if (updateInfo == null) throw new ApiError(meta.errors.noSuchUpdateInfo);

			await this.updateInfoService.delete(updateInfo, me);
		});
	}
}
