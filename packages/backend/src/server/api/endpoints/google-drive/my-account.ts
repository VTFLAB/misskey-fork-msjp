/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { GoogleOAuthService } from '@/core/google/GoogleOAuthService.js';
import { GoogleYoutubeService } from '@/core/google/GoogleYoutubeService.js';

export const meta = {
	tags: ['google-drive', 'account'],

	requireCredential: true,
	kind: 'read:account',

	description: '自分の Google Drive 連携状態 (配信アーカイブ用) を返す。',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			available: { type: 'boolean', optional: false, nullable: false },
			linked: { type: 'boolean', optional: false, nullable: false },
			googleEmail: { type: 'string', optional: false, nullable: true },
			youtubeAuthorized: { type: 'boolean', optional: false, nullable: false },
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
		private googleYoutubeService: GoogleYoutubeService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!this.googleOAuthService.isEnabled) {
				return {
					available: false,
					linked: false,
					googleEmail: null,
					youtubeAuthorized: false,
				};
			}

			const account = await this.googleOAuthService.getLinkedAccount(me.id);

			return {
				available: true,
				linked: account != null,
				googleEmail: account?.googleEmail ?? null,
				youtubeAuthorized: await this.googleYoutubeService.isAuthorizedForUpload(me.id),
			};
		});
	}
}
