/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { CraftService } from '@/core/CraftService.js';

export const meta = {
	tags: ['craft'],

	requireCredential: true,

	kind: 'write:account',

	prohibitMoved: true,

	limit: {
		duration: 1000 * 60 * 60,
		max: 60,
	},

	errors: {
		noSuchFile: {
			message: 'No such file.',
			code: 'NO_SUCH_FILE',
			id: '91027aea-7a14-4bb5-af0e-6fffdf197adb',
		},
		invalidFile: {
			message: 'The file must be a PNG or WebP of 64x64 or 64x32 pixels, at most 256 KB, uploaded to this server and not marked sensitive.',
			code: 'INVALID_SKIN_FILE',
			id: '7df7b670-dae7-4ff1-8b1e-a84eb8bfa5aa',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			skinUrl: {
				type: 'string',
				optional: false, nullable: true,
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		// null で解除
		fileId: { type: 'string', format: 'misskey:id', nullable: true },
	},
	required: ['fileId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private craftService: CraftService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const result = await this.craftService.setSkin(me, ps.fileId);
			if (!result.ok) {
				throw new ApiError(result.reason === 'noSuchFile' ? meta.errors.noSuchFile : meta.errors.invalidFile);
			}
			return { skinUrl: result.url };
		});
	}
}
