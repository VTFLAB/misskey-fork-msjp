/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { UserProfilesRepository, UsersRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { IdService } from '@/core/IdService.js';
import { isAllowedLocalAutomationRequest } from '@/misc/local-automation-guard.js';
import { calcLoginStreak, earliestLoginDate } from '@/misc/login-streak.js';

// bsky-fork 独自: キャラクター bot (msjp-bot) が、質問したユーザー本人のアカウント統計
// (累計ログイン日数など) に答えるための endpoint。bot は質問者自身の ID しか渡さない (bot 側で保証する)。
// 呼べるのは config の msjpBotUserIds に載ったユーザーだけで、到達経路も LAN からの直アクセスに限る
// (learning-opt-outs と同じガード、config は updateInfoLocalPost.allowedIps を共用し、共有トークンは使わない)。
// ローカルの、凍結も削除もされていないユーザーだけを対象にする。
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
			id: 'cc69ac5d-aab2-4480-8d84-f4896badf9c5',
		},

		noSuchUser: {
			message: 'No such user.',
			code: 'NO_SUCH_USER',
			id: '68c1f976-5b76-465d-866e-be3b7d07e496',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			loggedInDays: { type: 'number', optional: false, nullable: false },
			loginStreakDays: { type: 'number', optional: false, nullable: false },
			firstLoginDate: { type: 'string', optional: false, nullable: true },
			createdAt: { type: 'string', optional: false, nullable: false, format: 'date-time' },
			notesCount: { type: 'number', optional: false, nullable: false },
			followersCount: { type: 'number', optional: false, nullable: false },
			followingCount: { type: 'number', optional: false, nullable: false },
			achievementsCount: { type: 'number', optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
	},
	required: ['userId'],
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

		private idService: IdService,
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
			if (!this.config.msjpBotUserIds.includes(me.id)) {
				throw new ApiError(meta.errors.accessDenied);
			}

			const user = await this.usersRepository.findOne({
				where: { id: ps.userId },
				select: { id: true, host: true, isSuspended: true, isDeleted: true, notesCount: true, followersCount: true, followingCount: true },
			});
			if (user == null || user.host != null || user.isSuspended || user.isDeleted) {
				throw new ApiError(meta.errors.noSuchUser);
			}

			const profile = await this.userProfilesRepository.findOne({
				where: { userId: user.id },
				select: { userId: true, loggedInDates: true, achievements: true },
			});
			if (profile == null) {
				throw new ApiError(meta.errors.noSuchUser);
			}

			return {
				loggedInDays: profile.loggedInDates.length,
				loginStreakDays: calcLoginStreak(profile.loggedInDates),
				firstLoginDate: earliestLoginDate(profile.loggedInDates),
				createdAt: this.idService.parse(user.id).date.toISOString(),
				notesCount: user.notesCount,
				followersCount: user.followersCount,
				followingCount: user.followingCount,
				achievementsCount: profile.achievements.length,
			};
		});
	}
}
