/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { UpdateInfoService } from '@/core/UpdateInfoService.js';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { isAllowedLocalAutomationRequest } from '@/misc/local-automation-guard.js';

// bsky-fork 独自: LAN 内の自動化クライアント (ローカル LLM / MCP エージェント等) が
// Misskey アカウント認証なしでアップデート情報を投稿するための endpoint。
//
// 認証の代わりに二重の到達経路ガード (XFF 拒否 + allowedIps 照合) で LAN 直アクセスのみに
// 限定する。ガードの詳細と根拠は @/misc/local-automation-guard.js (共有実装) を参照。
// rootless podman では published port の送信元が rootlessport の gateway IP に
// 書き換わるため、実際に観測される IP を config に列挙する運用
// (accessDenied の応答に観測 IP を含める)。allowedIps 未設定 (デフォルト) では常に拒否 = 機能オフ。
export const meta = {
	tags: ['meta'],

	requireCredential: false,

	limit: {
		duration: 1000 * 60 * 10,
		max: 30,
	},

	errors: {
		accessDenied: {
			message: 'Access denied.',
			code: 'ACCESS_DENIED',
			id: '77ab825c-c777-42e8-a26f-5bcffbdc96a5',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'UpdateInfo',
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		title: { type: 'string', minLength: 1 },
		text: { type: 'string', minLength: 1 },
		imageUrl: { type: 'string', nullable: true, minLength: 0 },
	},
	required: ['title', 'text'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.config)
		private config: Config,

		private updateInfoService: UpdateInfoService,
	) {
		super(meta, paramDef, async (ps, me, token, file, cleanup, ip, headers) => {
			// accessDenied に観測値を含めるのは allowedIps 設定のデバッグ用
			// (呼び出し元自身の情報を返すだけなので漏洩にはならない)。
			if (!isAllowedLocalAutomationRequest({
				allowedIps: this.config.updateInfoLocalPost?.allowedIps ?? [],
				ip,
				headers,
			})) {
				throw new ApiError(meta.errors.accessDenied, { ip: ip ?? null, forwarded: (headers?.['x-forwarded-for'] ?? null) != null });
			}

			const { packed } = await this.updateInfoService.create({
				title: ps.title,
				text: ps.text,
				/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- 空の文字列の場合、nullを渡すようにするため */
				imageUrl: ps.imageUrl || null,
			});

			return packed;
		});
	}
}
