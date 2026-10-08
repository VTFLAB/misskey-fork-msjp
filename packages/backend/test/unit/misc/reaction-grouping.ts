/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { groupReactionsByIdentity } from '@/misc/reaction-grouping.js';

describe('groupReactionsByIdentity (bsky-fork)', () => {
	const identities: Record<string, string> = {
		':blob@a.example:': 'img1',
		':blob@b.example:': 'img1',
		':blob@c.example:': 'img2',
		':other@b.example:': 'img1',
		':blob@.:': 'img1',
	};
	const identityOf = (key: string) => identities[key] ?? null;

	test('merges same-image reactions across hosts, prefers the local emoji as representative', () => {
		const grouped = groupReactionsByIdentity({
			'👍': 2,
			':blob@a.example:': 3,
			':blob@b.example:': 1,
			':blob@.:': 1,
			':blob@c.example:': 4,
		}, {}, identityOf);
		expect(grouped.reactions).toEqual({ '👍': 2, ':blob@.:': 5, ':blob@c.example:': 4 });
		expect(grouped.keyMap.get(':blob@a.example:')).toBe(':blob@.:');
		expect(grouped.keyMap.get(':blob@b.example:')).toBe(':blob@.:');
		expect(grouped.keyMap.has(':blob@c.example:')).toBe(false);
	});

	test('without a local emoji the note author\'s host represents the group, and names may differ', () => {
		const grouped = groupReactionsByIdentity({
			':blob@a.example:': 1,
			':other@b.example:': 3,
			':blob@b.example:': 2,
		}, { 'other@b.example': 'https://b.example/other.png' }, identityOf, 'b.example');
		expect(Object.keys(grouped.reactions)).toEqual([':other@b.example:']);
		expect(grouped.reactions[':other@b.example:']).toBe(6);
		expect(grouped.reactionEmojis['other@b.example']).toBe('https://b.example/other.png');
	});

	test('the representative does not depend on counts (lexicographically first key when no local or author-host variant)', () => {
		const a = groupReactionsByIdentity({ ':blob@a.example:': 3, ':blob@b.example:': 2 }, {}, identityOf);
		const b = groupReactionsByIdentity({ ':blob@a.example:': 3, ':blob@b.example:': 10 }, {}, identityOf);
		expect(Object.keys(a.reactions)).toEqual([':blob@a.example:']);
		expect(Object.keys(b.reactions)).toEqual([':blob@a.example:']);
		expect(b.reactions[':blob@a.example:']).toBe(13);
	});

	test('keys without a known identity stay separate', () => {
		const grouped = groupReactionsByIdentity({
			':unknown@a.example:': 1,
			':unknown@b.example:': 1,
		}, {}, () => null);
		expect(grouped.reactions).toEqual({ ':unknown@a.example:': 1, ':unknown@b.example:': 1 });
		expect(grouped.keyMap.size).toBe(0);
	});
});
