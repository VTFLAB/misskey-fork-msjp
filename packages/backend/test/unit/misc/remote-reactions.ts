/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { mergeRemoteReactions, pickReactionEntries } from '@/misc/remote-reactions.js';

describe('mergeRemoteReactions (bsky-fork)', () => {
	test('returns the local diff when nothing was fetched', () => {
		const local = { reactions: { '👍': 1 }, reactionEmojis: {} };
		expect(mergeRemoteReactions(local, null)).toBe(local);
	});

	test('takes the larger count per reaction and keeps local-only ones', () => {
		const merged = mergeRemoteReactions(
			{ reactions: { '👍': 2, ':local@.:': 1 }, reactionEmojis: {} },
			{ fetchedAt: 0, reactions: { '👍': 5, ':blob@example.com:': 3 }, reactionEmojis: { 'blob@example.com': 'https://example.com/blob.png' } },
		);
		expect(merged.reactions).toEqual({ '👍': 5, ':local@.:': 1, ':blob@example.com:': 3 });
		expect(merged.reactionEmojis).toEqual({ 'blob@example.com': 'https://example.com/blob.png' });
	});

	test('local emoji urls win over remote ones and zero counts are ignored', () => {
		const merged = mergeRemoteReactions(
			{ reactions: { ':blob@example.com:': 1 }, reactionEmojis: { 'blob@example.com': 'https://proxy.local/blob.png' } },
			{ fetchedAt: 0, reactions: { ':blob@example.com:': 0, '❤': 0 }, reactionEmojis: { 'blob@example.com': 'https://example.com/blob.png' } },
		);
		expect(merged.reactions).toEqual({ ':blob@example.com:': 1 });
		expect(merged.reactionEmojis['blob@example.com']).toBe('https://proxy.local/blob.png');
	});
});

describe('pickReactionEntries (bsky-fork)', () => {
	test('drops non-positive, non-integer, and over-long keys and keeps the top entries by count', () => {
		const longKey = 'x'.repeat(129);
		const picked = pickReactionEntries({
			'👍': 3,
			':blob@.:': 7,
			'❤': 0,
			'💯': -1,
			'🎉': 1.5,
			'🔥': 'many',
			[longKey]: 100,
		}, 2, 128);
		expect(picked).toEqual([[':blob@.:', 7], ['👍', 3]]);
	});

	test('returns nothing for non-object input', () => {
		expect(pickReactionEntries(null, 10, 128)).toEqual([]);
		expect(pickReactionEntries(['👍'], 10, 128)).toEqual([]);
		expect(pickReactionEntries('👍', 10, 128)).toEqual([]);
	});
});
