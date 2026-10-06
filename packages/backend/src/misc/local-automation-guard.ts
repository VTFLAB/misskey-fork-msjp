/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import ipaddr from 'ipaddr.js';

// bsky-fork 独自: LAN 内の自動化クライアント (ローカル LLM / MCP エージェント等) 専用
// endpoint の到達経路ガード。update-info/create-local で確立した二重ガードを共通化したもの:
// 1. X-Forwarded-For が付いたリクエストは無条件で拒否する。公開経路
//    (Cloudflare -> HAProxy) は必ず XFF を付与するため、proxied な WAN トラフィックを排除できる。
// 2. 残った直アクセスの送信元 IP が allowedIps (IP または CIDR) に一致すること。
// 3. token が設定されている場合は、ヘッダー x-misskey-local-token が token と一致すること
//    (定数時間比較)。Authorization ヘッダーは Misskey がユーザートークンとして解釈するため使わない。
//    token 未設定のときは 1, 2 のみで判定する (後方互換)。
// allowedIps 未設定 (空) では常に拒否 = 機能オフ。

export function matchesAllowedIp(ip: string, allowed: string[]): boolean {
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

export const LOCAL_AUTOMATION_TOKEN_HEADER = 'x-misskey-local-token';

function safeEqualString(a: string, b: string): boolean {
	// 長さの差を漏らさないよう、sha256 で固定長にしてから比較する
	const ha = createHash('sha256').update(a).digest();
	const hb = createHash('sha256').update(b).digest();
	return timingSafeEqual(ha, hb);
}

export function isAllowedLocalAutomationRequest(opts: {
	allowedIps: string[];
	token?: string | null;
	ip: string | null | undefined;
	headers: Record<string, string | string[] | undefined> | null | undefined;
}): boolean {
	const forwarded = opts.headers?.['x-forwarded-for'] ?? null;
	if (opts.allowedIps.length === 0 || forwarded != null || opts.ip == null) return false;
	if (opts.token != null && opts.token !== '') {
		const presented = opts.headers?.[LOCAL_AUTOMATION_TOKEN_HEADER];
		if (typeof presented !== 'string') return false;
		if (!safeEqualString(presented, opts.token)) return false;
	}
	return matchesAllowedIp(opts.ip, opts.allowedIps);
}
