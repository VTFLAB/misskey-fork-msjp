/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import type { UserProfilesRepository, UsersRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { isAllowedLocalAutomationRequest } from '@/misc/local-automation-guard.js';

// bsky-fork 独自: サーバー内で学習する bot (msjp-bot) が、学習してはいけないユーザーを調べるための endpoint。
// preventAiLearning と isExplorable は本人向けの pack にしか入らないため、bot は users/show で読めない。
// 呼べるのは config の learningOptOutReaders に載ったユーザーだけで、返すのは拒否しているユーザーの ID だけ。
// さらに到達経路を LAN からの直アクセスに限る (update-info/create-local と同じガード、config は
// updateInfoLocalPost.allowedIps を共用し、共有トークンは使わない)。公開経路は X-Forwarded-For が付くので届かない。
//
// - ローカルユーザー: isExplorable が false、または (includePreventAiLearning のとき) preventAiLearning が true
// - リモートユーザー: isExplorable (ActivityPub の discoverable) が false。preventAiLearning は連合されず、
//   リモートユーザーのプロフィールには既定値が入っているだけなので見ない
export const meta = {
	tags: ['users'],

	requireCredential: true,
	kind: 'read:account',

	limit: {
		duration: 1000 * 60,
		max: 120,
	},

	errors: {
		accessDenied: {
			message: 'Access denied.',
			code: 'ACCESS_DENIED',
			id: 'c6f3a8d2-5b1e-4f7a-9d0c-2e8b4a6f1d93',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			userIds: {
				type: 'array',
				optional: false, nullable: false,
				items: {
					type: 'string',
					optional: false, nullable: false,
					format: 'id',
				},
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userIds: {
			type: 'array',
			minItems: 1,
			maxItems: 100,
			uniqueItems: true,
			items: { type: 'string', format: 'misskey:id' },
		},
		includePreventAiLearning: { type: 'boolean', default: true },
	},
	required: ['userIds'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,
	) {
		super(meta, paramDef, async (ps, me, token, file, cleanup, ip, headers) => {
			if (!isAllowedLocalAutomationRequest({
				allowedIps: this.config.updateInfoLocalPost?.allowedIps ?? [],
				token: null,
				ip,
				headers,
			})) {
				throw new ApiError(meta.errors.accessDenied);
			}
			if (!this.config.learningOptOutReaders.includes(me.id)) {
				throw new ApiError(meta.errors.accessDenied);
			}

			const users = await this.usersRepository.find({
				where: { id: In(ps.userIds) },
				select: { id: true, host: true, isExplorable: true },
			});

			const localIds = users.filter(u => u.host == null).map(u => u.id);
			const preventing = new Set<string>();
			if (ps.includePreventAiLearning && localIds.length > 0) {
				const profiles = await this.userProfilesRepository.find({
					where: { userId: In(localIds), preventAiLearning: true },
					select: { userId: true },
				});
				for (const p of profiles) preventing.add(p.userId);
			}

			return {
				userIds: users.filter(u => !u.isExplorable || preventing.has(u.id)).map(u => u.id),
			};
		});
	}
}
