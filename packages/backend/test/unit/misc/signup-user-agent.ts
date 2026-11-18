/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { compileUserAgentPatterns, matchesUserAgent } from '@/misc/signup-user-agent.js';

describe('signup user-agent patterns', () => {
	test('matches only the configured patterns', () => {
		const { regexps, invalid } = compileUserAgentPatterns(['ExampleBot/\\d+', '^curl/']);
		expect(invalid).toEqual([]);
		expect(matchesUserAgent(regexps, 'Mozilla/5.0 (compatible; ExampleBot/2.1)')).toBe(true);
		expect(matchesUserAgent(regexps, 'curl/8.10.1')).toBe(true);
		expect(matchesUserAgent(regexps, 'Mozilla/5.0 curl/8.10.1')).toBe(false);
		expect(matchesUserAgent(regexps, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36')).toBe(false);
	});

	test('skips patterns that are not valid regular expressions', () => {
		const { regexps, invalid } = compileUserAgentPatterns(['(unclosed', 'ok']);
		expect(invalid).toEqual(['(unclosed']);
		expect(regexps).toHaveLength(1);
		expect(matchesUserAgent(regexps, 'ok')).toBe(true);
	});

	test('does not match a missing user-agent or an empty pattern list', () => {
		const { regexps } = compileUserAgentPatterns(['.*']);
		expect(matchesUserAgent(regexps, undefined)).toBe(false);
		expect(matchesUserAgent(regexps, '')).toBe(false);
		expect(matchesUserAgent([], 'anything')).toBe(false);
	});

	test('only looks at the first 1024 characters', () => {
		const { regexps } = compileUserAgentPatterns(['TAIL$']);
		expect(matchesUserAgent(regexps, 'a'.repeat(2000) + 'TAIL')).toBe(false);
		expect(matchesUserAgent(regexps, 'a'.repeat(1000) + 'TAIL')).toBe(true);
	});
});
