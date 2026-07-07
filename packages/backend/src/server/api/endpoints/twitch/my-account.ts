/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { TwitchApiService } from '@/core/twitch/TwitchApiService.js';
import { TwitchOAuthService } from '@/core/twitch/TwitchOAuthService.js';

export const meta = {
	tags: ['twitch', 'account'],

	requireCredential: true,
	kind: 'read:account',

	description: '自分の Twitch 連携状態を返す。botLinked はインスタンス共通中継 bot が設定済みかどうか。',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			available: { type: 'boolean', optional: false, nullable: false },
			linked: { type: 'boolean', optional: false, nullable: false },
			twitchLogin: { type: 'string', optional: false, nullable: true },
			twitchDisplayName: { type: 'string', optional: false, nullable: true },
			botLinked: { type: 'boolean', optional: false, nullable: false },
			botLogin: { type: 'string', optional: false, nullable: true },
			translationEnabled: { type: 'boolean', optional: false, nullable: false },
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
		private twitchApiService: TwitchApiService,
		private twitchOAuthService: TwitchOAuthService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!this.twitchApiService.isEnabled) {
				return {
					available: false,
					linked: false,
					twitchLogin: null,
					twitchDisplayName: null,
					botLinked: false,
					botLogin: null,
					translationEnabled: false,
				};
			}

			const [account, bot] = await Promise.all([
				this.twitchOAuthService.getLinkedAccount(me.id),
				this.twitchOAuthService.getBotAccount(),
			]);

			return {
				available: true,
				linked: account != null,
				twitchLogin: account?.twitchLogin ?? null,
				twitchDisplayName: account?.twitchDisplayName ?? null,
				botLinked: bot != null,
				botLogin: bot?.twitchLogin ?? null,
				translationEnabled: account?.translationEnabled ?? false,
			};
		});
	}
}
