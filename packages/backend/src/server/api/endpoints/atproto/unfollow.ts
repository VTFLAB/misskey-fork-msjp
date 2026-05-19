/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import type { FollowingsRepository, UsersRepository } from '@/models/_.js';
import type { MiRemoteUser } from '@/models/User.js';
import { UserFollowingService } from '@/core/UserFollowingService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';

export const meta = {
	tags: ['atproto', 'following'],

	requireCredential: true,
	kind: 'write:following',

	description: 'Bluesky DID で識別される pseudo-user を unfollow する。pseudo-user 自体は残す (他 user の follow 対象になっている場合があるため)。',

	limit: {
		duration: 60 * 1000,
		max: 30,
	},

	errors: {
		noSuchUser: {
			message: 'No pseudo-user found for the given did.',
			code: 'NO_SUCH_USER',
			id: '6257a072-8b4d-4459-802c-9cd956afcac6',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'UserDetailedNotMe',
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		did: { type: 'string', minLength: 5, maxLength: 256 },
	},
	required: ['did'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.followingsRepository)
		private followingsRepository: FollowingsRepository,

		private userFollowingService: UserFollowingService,
		private userEntityService: UserEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const pseudoUser = await this.usersRepository.findOneBy({ atDid: ps.did }) as MiRemoteUser | null;
			if (pseudoUser == null) {
				throw new ApiError(meta.errors.noSuchUser);
			}

			const exists = await this.followingsRepository.exists({
				where: { followerId: me.id, followeeId: pseudoUser.id },
			});

			if (exists) {
				await this.userFollowingService.unfollow(me, pseudoUser);
			}

			return await this.userEntityService.pack(pseudoUser.id, me, { schema: 'UserDetailedNotMe' });
		});
	}
}
