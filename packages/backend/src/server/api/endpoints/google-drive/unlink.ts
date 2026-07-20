/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { GoogleOAuthService } from '@/core/google/GoogleOAuthService.js';

export const meta = {
	tags: ['google-drive', 'account'],

	requireCredential: true,
	secure: true,

	description: '配信アーカイブの Google Drive 連携を解除する。',

	limit: {
		duration: 60 * 1000,
		max: 10,
	},

	errors: {
		notLinked: {
			message: 'No Google account is linked.',
			code: 'GOOGLE_DRIVE_NOT_LINKED',
			id: '0d64c6dd-b75a-404d-95b9-64a13702ca04',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private googleOAuthService: GoogleOAuthService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const unlinked = await this.googleOAuthService.unlink(me.id);
			if (!unlinked) throw new ApiError(meta.errors.notLinked);
		});
	}
}
