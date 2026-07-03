/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { TwitchOAuthService } from '@/core/twitch/TwitchOAuthService.js';

export const meta = {
	tags: ['twitch', 'account'],

	requireCredential: true,
	secure: true,

	description: 'Twitch アカウント連携を解除する。',

	limit: {
		duration: 60 * 1000,
		max: 10,
	},

	errors: {
		notLinked: {
			message: 'No Twitch account is linked.',
			code: 'TWITCH_NOT_LINKED',
			id: '824a3066-e464-431a-96dd-a467f16d28b7',
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
		private twitchOAuthService: TwitchOAuthService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const unlinked = await this.twitchOAuthService.unlink(me.id);
			if (!unlinked) throw new ApiError(meta.errors.notLinked);
		});
	}
}
