/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// loggedInDates は i.ts が `${年}/${月}/${日}` (ゼロ埋めなし、サーバーのタイムゾーン) で追記する。
function toDayNumber(s: string): number | null {
	const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s);
	if (m == null) return null;
	// UTC の暦日として数えるので、夏時間の影響を受けない
	return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
}

/** 日付文字列のうち最も古いもの (解釈できないものは無視)。無ければ null。形式は YYYY/M/D のまま返す。 */
export function earliestLoginDate(dates: string[]): string | null {
	let best: string | null = null;
	let bestN = Infinity;
	for (const d of dates) {
		const n = toDayNumber(d);
		if (n != null && n < bestN) {
			bestN = n;
			best = d;
		}
	}
	return best;
}

/** 今日または昨日で終わる連続ログイン日数。どちらも無ければ 0。 */
export function calcLoginStreak(dates: string[], now: Date = new Date()): number {
	const days = new Set<number>();
	for (const d of dates) {
		const n = toDayNumber(d);
		if (n != null) days.add(n);
	}
	const today = Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
	let cursor = days.has(today) ? today : today - 1;
	let streak = 0;
	while (days.has(cursor)) {
		streak++;
		cursor--;
	}
	return streak;
}
