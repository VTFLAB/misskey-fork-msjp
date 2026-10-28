/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { calcLoginStreak, earliestLoginDate } from '@/misc/login-streak.js';

describe(calcLoginStreak, () => {
	const now = new Date(2026, 9, 28, 12, 0, 0); // 2026/10/28 local

	it('returns 0 for empty', () => {
		expect(calcLoginStreak([], now)).toBe(0);
	});
	it('counts consecutive days ending today', () => {
		expect(calcLoginStreak(['2026/10/26', '2026/10/27', '2026/10/28'], now)).toBe(3);
	});
	it('counts streak ending yesterday', () => {
		expect(calcLoginStreak(['2026/10/26', '2026/10/27'], now)).toBe(2);
	});
	it('returns 0 when last login is older than yesterday', () => {
		expect(calcLoginStreak(['2026/10/25', '2026/10/26'], now)).toBe(0);
	});
	it('stops at a gap', () => {
		expect(calcLoginStreak(['2026/10/20', '2026/10/27', '2026/10/28'], now)).toBe(2);
	});
	it('crosses month and year boundaries with unpadded dates', () => {
		const n = new Date(2026, 0, 2, 12, 0, 0);
		expect(calcLoginStreak(['2025/12/31', '2026/1/1', '2026/1/2'], n)).toBe(3);
	});
	it('ignores unparsable entries and duplicates', () => {
		expect(calcLoginStreak(['x', '2026/10/28', '2026/10/28'], now)).toBe(1);
	});
});

describe(earliestLoginDate, () => {
	it('returns null for empty', () => {
		expect(earliestLoginDate([])).toBeNull();
	});
	it('compares numerically, not lexically', () => {
		expect(earliestLoginDate(['2026/10/5', '2026/9/30', '2025/12/1'])).toBe('2025/12/1');
		expect(earliestLoginDate(['2026/10/5', '2026/9/30'])).toBe('2026/9/30');
	});
});
