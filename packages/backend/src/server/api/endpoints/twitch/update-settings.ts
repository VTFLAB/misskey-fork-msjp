/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import type { TwitchAccountsRepository } from '@/models/_.js';

export const meta = {
	tags: ['twitch', 'account'],

	requireCredential: true,
	kind: 'write:account',
	secure: true,

	description: '配信コメント翻訳機能など、Twitch 連携アカウントの配信者向け設定を更新する。',

	limit: {
		duration: 60 * 1000,
		max: 10,
	},

	errors: {
		notLinked: {
			message: 'No Twitch account is linked.',
			code: 'TWITCH_NOT_LINKED',
			id: 'ad2b06d8-1b0c-4c6b-b418-13162df5ebad',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			translationEnabled: { type: 'boolean', optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		translationEnabled: { type: 'boolean' },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.twitchAccountsRepository)
		private twitchAccountsRepository: TwitchAccountsRepository,
	) {
		super(meta, paramDef, async (ps, me) => {
			const account = await this.twitchAccountsRepository.findOneBy({ userId: me.id });
			if (account == null) throw new ApiError(meta.errors.notLinked);

			if (ps.translationEnabled !== undefined) {
				await this.twitchAccountsRepository.update(account.id, {
					translationEnabled: ps.translationEnabled,
				});
			}

			const updated = await this.twitchAccountsRepository.findOneByOrFail({ id: account.id });
			return { translationEnabled: updated.translationEnabled };
		});
	}
}
