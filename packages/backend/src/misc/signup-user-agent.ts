/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// bsky-fork 独自: 新規登録 (POST /api/signup) の User-Agent の判定。
// パターンは config の signupIpBlocklist.denyUserAgents (正規表現の文字列) で運用者が指定する。既定は空で判定しない。

// 判定にかける UA の長さの上限 (config の正規表現が長い入力で遅くならないように)
const MAX_USER_AGENT_LENGTH = 1024;

export function compileUserAgentPatterns(patterns: string[]): { regexps: RegExp[]; invalid: string[] } {
	const regexps: RegExp[] = [];
	const invalid: string[] = [];
	for (const pattern of patterns) {
		try {
			regexps.push(new RegExp(pattern));
		} catch {
			invalid.push(pattern);
		}
	}
	return { regexps, invalid };
}

/** UA がどれかのパターンに当たれば true。UA が無いときは判定しない (false) */
export function matchesUserAgent(regexps: RegExp[], userAgent: string | null | undefined): boolean {
	if (userAgent == null || userAgent === '') return false;
	const target = userAgent.slice(0, MAX_USER_AGENT_LENGTH);
	return regexps.some(re => re.test(target));
}
