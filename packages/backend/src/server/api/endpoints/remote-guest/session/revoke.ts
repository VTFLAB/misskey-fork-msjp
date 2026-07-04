/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { RemoteGuestSessionService } from '@/core/remote-guest/RemoteGuestSessionService.js';

export const meta = {
	tags: ['remote-guest'],

	requireCredential: false,

	description: 'リモートゲストログインセッションをログアウトする。',

	limit: {
		duration: 1000 * 60,
		max: 30,
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			success: { type: 'boolean', optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		guestToken: { type: 'string', minLength: 1, maxLength: 128 },
	},
	required: ['guestToken'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private remoteGuestSessionService: RemoteGuestSessionService,
	) {
		super(meta, paramDef, async (ps) => {
			const success = await this.remoteGuestSessionService.revoke(ps.guestToken);
			return { success };
		});
	}
}
