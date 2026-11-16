/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { IpRangeSet, cidrToRange } from '@/misc/ip-range-set.js';

describe('IpRangeSet', () => {
	test('matches IPv4 and IPv6 CIDRs, ignores comments and blank lines', () => {
		const { set, valid, invalid } = IpRangeSet.fromCidrLines([
			'# datacenter list',
			'140.248.0.0/16',
			'',
			'2a04:4e41::/33  # fastly',
			'2a04:4e42::/32',
			'203.0.113.7',
		]);
		expect(valid).toBe(4);
		expect(invalid).toBe(0);
		expect(set.has('140.248.51.104')).toBe(true);
		expect(set.has('140.249.0.1')).toBe(false);
		expect(set.has('2a04:4e41:80:a6::6007:e7a6')).toBe(true);
		expect(set.has('2a04:4e41:8000::1')).toBe(false); // /33 の外
		expect(set.has('2a04:4e42:ffff::1')).toBe(true);
		expect(set.has('203.0.113.7')).toBe(true);
		expect(set.has('203.0.113.8')).toBe(false);
	});

	test('IPv4-mapped IPv6 client addresses match IPv4 CIDRs', () => {
		const { set } = IpRangeSet.fromCidrLines(['10.0.0.0/8']);
		expect(set.has('::ffff:10.1.2.3')).toBe(true);
		expect(set.has('::ffff:11.1.2.3')).toBe(false);
	});

	test('merges overlapping and adjacent ranges', () => {
		const { set } = IpRangeSet.fromCidrLines(['192.0.2.0/25', '192.0.2.128/25', '192.0.2.64/26']);
		expect(set.size).toBe(1);
		expect(set.has('192.0.2.255')).toBe(true);
		expect(set.has('192.0.3.0')).toBe(false);
	});

	test('counts unparsable lines and does not match garbage', () => {
		const { set, valid, invalid } = IpRangeSet.fromCidrLines(['not an ip', '1.2.3.4/33', '2001:db8::/129', '2001:db8::/32']);
		expect(valid).toBe(1);
		expect(invalid).toBe(3);
		expect(set.has('garbage')).toBe(false);
		expect(set.has('2001:db8:1::1')).toBe(true);
	});

	test('empty set matches nothing', () => {
		const set = new IpRangeSet([]);
		expect(set.size).toBe(0);
		expect(set.has('1.1.1.1')).toBe(false);
	});

	test('cidrToRange handles host bits set in the address', () => {
		const a = cidrToRange('192.0.2.77/24');
		const b = cidrToRange('192.0.2.0/24');
		expect(a).toEqual(b);
		expect(cidrToRange('')).toBeNull();
	});
});
