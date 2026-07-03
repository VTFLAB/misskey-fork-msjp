/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { RoleService } from '@/core/RoleService.js';
import { TwitchApiService } from '@/core/twitch/TwitchApiService.js';
import { TwitchOAuthService } from '@/core/twitch/TwitchOAuthService.js';

export const meta = {
	tags: ['twitch', 'account'],

	requireCredential: true,
	secure: true,

	description: 'Twitch アカウント連携の認可 URL を発行する。forBot はインスタンス共通中継 bot の連携用 (管理者専用)。',

	limit: {
		duration: 60 * 1000,
		max: 10,
	},

	errors: {
		notConfigured: {
			message: 'Twitch integration is not configured on this instance.',
			code: 'TWITCH_NOT_CONFIGURED',
			id: 'c94e896e-b517-4449-b388-9c2b2dda9ffe',
		},
		accessDenied: {
			message: 'Only administrators can link the relay bot account.',
			code: 'ACCESS_DENIED',
			id: 'c13a2b42-8a01-48b7-a794-c53472998d83',
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
		forBot: { type: 'boolean', default: false },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private roleService: RoleService,
		private twitchApiService: TwitchApiService,
		private twitchOAuthService: TwitchOAuthService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!this.twitchApiService.isEnabled) throw new ApiError(meta.errors.notConfigured);

			if (ps.forBot && !await this.roleService.isAdministrator(me)) {
				throw new ApiError(meta.errors.accessDenied);
			}

			const url = await this.twitchOAuthService.generateAuthorizeUrl(me.id, ps.forBot);
			return { url };
		});
	}
}
