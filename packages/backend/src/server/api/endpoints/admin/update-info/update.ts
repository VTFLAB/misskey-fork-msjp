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
			id: '0f5588b1-c84b-4f96-9320-68969d2714a3',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		id: { type: 'string', format: 'misskey:id' },
		title: { type: 'string', minLength: 1 },
		text: { type: 'string', minLength: 1 },
		imageUrl: { type: 'string', nullable: true, minLength: 0 },
	},
	required: ['id', 'title', 'text'],
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

			await this.updateInfoService.update(updateInfo, {
				title: ps.title,
				text: ps.text,
				/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- 空の文字列の場合、nullを渡すようにするため */
				imageUrl: ps.imageUrl || null,
			}, me);
		});
	}
}
