/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import type { TwitchStreamBlocksRepository } from '@/models/_.js';

export const meta = {
	tags: ['twitch'],

	requireCredential: true,
	kind: 'write:account',
	prohibitMoved: true,

	description: '自分の配信チャットのブロックを解除する (配信者専用)。',

	limit: {
		duration: 60 * 1000,
		max: 30,
	},

	errors: {
		noSuchBlock: {
			message: 'No such block.',
			code: 'NO_SUCH_BLOCK',
			id: '63a7a49b-7c62-41fc-8a17-003a301e0af4',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		blockId: { type: 'string', format: 'misskey:id' },
	},
	required: ['blockId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.twitchStreamBlocksRepository)
		private twitchStreamBlocksRepository: TwitchStreamBlocksRepository,
	) {
		super(meta, paramDef, async (ps, me) => {
			const block = await this.twitchStreamBlocksRepository.findOneBy({ id: ps.blockId, userId: me.id });
			if (block == null) throw new ApiError(meta.errors.noSuchBlock);

			await this.twitchStreamBlocksRepository.delete(block.id);
		});
	}
}
