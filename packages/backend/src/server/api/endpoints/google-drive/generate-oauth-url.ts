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

	description: '配信アーカイブの Google Drive 連携、または YouTube アップロード追加認証の認可 URL を発行する。target=youtube の場合は既存の Drive 権限を維持したまま (incremental authorization) YouTube アップロード権限のみを追加要求する。',

	limit: {
		duration: 60 * 1000,
		max: 10,
	},

	errors: {
		notConfigured: {
			message: 'Google Drive integration is not configured on this instance.',
			code: 'GOOGLE_DRIVE_NOT_CONFIGURED',
			id: '2a6bae47-e5e9-4964-9cae-c4ec6a04210f',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			url: { type: 'string', optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		target: { type: 'string', enum: ['drive', 'youtube'], default: 'drive' },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private googleOAuthService: GoogleOAuthService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!this.googleOAuthService.isEnabled) throw new ApiError(meta.errors.notConfigured);

			const url = await this.googleOAuthService.generateAuthorizeUrl(me.id, ps.target);
			return { url };
		});
	}
}
