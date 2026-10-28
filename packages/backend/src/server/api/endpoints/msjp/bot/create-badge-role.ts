/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { IsNull } from 'typeorm';
import type { EmojisRepository, RolesRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { RoleService } from '@/core/RoleService.js';
import { isAllowedLocalAutomationRequest } from '@/misc/local-automation-guard.js';

// bsky-fork 独自: キャラクター bot (msjp-bot、モデレーター) が、依頼に応じて見た目だけのバッジロールを作るための endpoint。
// モデレーターは admin/roles/create を呼べないので、このために用意した。
// 名前・説明・色・アイコンの絵文字以外の値はサーバーが固定する (手動割り当て、条件なし、公開、権限なし、バッジとして表示)。
// そのため bot は、権限を持つロールを作れない。ロールの作成は RoleService.create 経由なので、モデレーションログに bot の操作として残る。
// 呼べるのは config の msjpBotUserIds に載ったユーザーだけで、到達経路も LAN からの直アクセスに限る
// (learning-opt-outs と同じガード、config は updateInfoLocalPost.allowedIps を共用し、共有トークンは使わない)。
export const meta = {
	tags: ['admin', 'role'],

	requireCredential: true,
	// msjpBotUserIds に載っていても、モデレーターでなくなった bot はロールを作れない
	requireModerator: true,
	kind: 'write:admin:roles',

	limit: {
		duration: 1000 * 60 * 60 * 24,
		max: 10,
	},

	errors: {
		accessDenied: {
			message: 'Access denied.',
			code: 'ACCESS_DENIED',
			id: '98461447-05ee-46fe-8fce-e0cbdd857b58',
		},

		noSuchEmoji: {
			message: 'No such emoji.',
			code: 'NO_SUCH_EMOJI',
			id: '5524dd4e-010e-4db0-ab60-736e23f4d7c4',
		},

		roleExists: {
			message: 'A role with the same name already exists.',
			code: 'ROLE_EXISTS',
			id: 'f0b7c1d4-3a6e-4c52-8e19-7d2a9b5c6e18',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			roleId: { type: 'string', optional: false, nullable: false, format: 'id' },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		name: { type: 'string', minLength: 1, maxLength: 20, pattern: '\\S' }, // 空白だけの名前は不可
		description: { type: 'string', maxLength: 100, default: '' },
		color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', nullable: true, default: null },
		emojiName: { type: 'string', nullable: true, default: null },
	},
	required: ['name'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.rolesRepository)
		private rolesRepository: RolesRepository,

		@Inject(DI.emojisRepository)
		private emojisRepository: EmojisRepository,

		private roleService: RoleService,
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

			let iconUrl: string | null = null;
			if (ps.emojiName != null) {
				const emoji = await this.emojisRepository.findOne({
					// センシティブな絵文字は誰にでも見えるバッジのアイコンにしない
					where: { name: ps.emojiName, host: IsNull(), isSensitive: false },
					select: { id: true, publicUrl: true, originalUrl: true },
				});
				if (emoji == null) {
					throw new ApiError(meta.errors.noSuchEmoji);
				}
				// || originalUrl は後方互換性のため (publicUrl は空文字になり得る)
				iconUrl = emoji.publicUrl || emoji.originalUrl;
			}

			const name = ps.name.trim();
			const normalized = name.toLowerCase();
			const names = await this.rolesRepository.find({ select: { id: true, name: true } });
			if (names.some(r => r.name.trim().toLowerCase() === normalized)) {
				throw new ApiError(meta.errors.roleExists);
			}

			const role = await this.roleService.create({
				name,
				description: ps.description,
				color: ps.color,
				iconUrl,
				target: 'manual',
				condFormula: { id: randomUUID(), type: 'and', values: [] }, // 手動割り当てでは評価されない空の条件
				isPublic: true,
				isModerator: false,
				isAdministrator: false,
				isExplorable: false,
				asBadge: true,
				preserveAssignmentOnMoveAccount: false,
				canEditMembersByModerator: true,
				displayOrder: 0,
				policies: {},
			}, me);

			return { roleId: role.id };
		});
	}
}
