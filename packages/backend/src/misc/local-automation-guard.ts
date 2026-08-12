/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ipaddr from 'ipaddr.js';

// bsky-fork 独自: LAN 内の自動化クライアント (ローカル LLM / MCP エージェント等) 専用
// endpoint の到達経路ガード。update-info/create-local で確立した二重ガードを共通化したもの:
// 1. X-Forwarded-For が付いたリクエストは無条件で拒否する。公開経路
//    (Cloudflare -> HAProxy) は必ず XFF を付与するため、proxied な WAN トラフィックを排除できる。
// 2. 残った直アクセスの送信元 IP が allowedIps (IP または CIDR) に一致すること。
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

export function isAllowedLocalAutomationRequest(opts: {
	allowedIps: string[];
	ip: string | null | undefined;
	headers: Record<string, string> | null | undefined;
}): boolean {
	const forwarded = opts.headers?.['x-forwarded-for'] ?? null;
	if (opts.allowedIps.length === 0 || forwarded != null || opts.ip == null) return false;
	return matchesAllowedIp(opts.ip, opts.allowedIps);
}
