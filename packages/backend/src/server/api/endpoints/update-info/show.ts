/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { UpdateInfoService } from '@/core/UpdateInfoService.js';
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['meta'],

	requireCredential: false,

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'UpdateInfo',
	},

	errors: {
		noSuchUpdateInfo: {
			message: 'No such update info.',
			code: 'NO_SUCH_UPDATE_INFO',
			id: '525e946d-2a3c-4c06-9d4b-0b191c50e910',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		updateInfoId: { type: 'string', format: 'misskey:id' },
	},
	required: ['updateInfoId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private updateInfoService: UpdateInfoService,
	) {
		super(meta, paramDef, async (ps) => {
			const packed = await this.updateInfoService.show(ps.updateInfoId);

			if (packed == null) throw new ApiError(meta.errors.noSuchUpdateInfo);

			return packed;
		});
	}
}
