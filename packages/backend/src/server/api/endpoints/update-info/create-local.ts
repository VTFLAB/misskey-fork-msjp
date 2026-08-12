/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import ipaddr from 'ipaddr.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { UpdateInfoService } from '@/core/UpdateInfoService.js';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';

// bsky-fork 独自: LAN 内の自動化クライアント (ローカル LLM / MCP エージェント等) が
// Misskey アカウント認証なしでアップデート情報を投稿するための endpoint。
//
// 認証の代わりに二重の到達経路ガードで LAN 直アクセスのみに限定する:
// 1. X-Forwarded-For が付いたリクエストは無条件で拒否する。公開経路
//    (Cloudflare -> HAProxy) は必ず XFF を付与するため、これで proxied な
//    WAN トラフィックを排除できる。
// 2. 残った直アクセスの送信元 IP が config の updateInfoLocalPost.allowedIps
//    (IP または CIDR) に一致すること。rootless podman では published port の
//    送信元が rootlessport の gateway IP に書き換わるため、実際に観測される
//    IP を config に列挙する運用 (accessDenied の応答に観測 IP を含める)。
// allowedIps 未設定 (デフォルト) では常に拒否 = 機能オフ。
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

function matchesAllowedIp(ip: string, allowed: string[]): boolean {
	let parsed: ipaddr.IPv4 | ipaddr.IPv6;
	try {
		// IPv4-mapped IPv6 (::ffff:192.168.1.1) を IPv4 に正規化する
		parsed = ipaddr.process(ip);
	} catch {
		return false;
	}
	for (const entry of allowed) {
		try {
			if (entry.includes('/')) {
				const cidr = ipaddr.parseCIDR(entry);
				if (cidr[0].kind() === parsed.kind() && parsed.match(cidr)) return true;
			} else {
				if (ipaddr.process(entry).toString() === parsed.toString()) return true;
			}
		} catch {
			continue;
		}
	}
	return false;
}

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.config)
		private config: Config,

		private updateInfoService: UpdateInfoService,
	) {
		super(meta, paramDef, async (ps, me, token, file, cleanup, ip, headers) => {
			const allowedIps = this.config.updateInfoLocalPost?.allowedIps ?? [];
			const forwarded = headers?.['x-forwarded-for'] ?? null;
			// accessDenied に観測値を含めるのは allowedIps 設定のデバッグ用
			// (呼び出し元自身の情報を返すだけなので漏洩にはならない)。
			if (allowedIps.length === 0 || forwarded != null || ip == null || !matchesAllowedIp(ip, allowedIps)) {
				throw new ApiError(meta.errors.accessDenied, { ip: ip ?? null, forwarded: forwarded != null });
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
