/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { isAllowedLocalAutomationRequest } from '@/misc/local-automation-guard.js';

describe('isAllowedLocalAutomationRequest', () => {
	const allowedIps = ['10.0.0.0/8'];
	const ip = '10.1.2.3';
	const token = 'secret-token-value';

	test('no token configured: IP match only (legacy behavior)', () => {
		expect(isAllowedLocalAutomationRequest({ allowedIps, ip, headers: {} })).toBe(true);
		expect(isAllowedLocalAutomationRequest({ allowedIps, ip: '192.0.2.1', headers: {} })).toBe(false);
		expect(isAllowedLocalAutomationRequest({ allowedIps, ip: null, headers: {} })).toBe(false);
	});

	test('token configured: correct header is allowed', () => {
		expect(isAllowedLocalAutomationRequest({ allowedIps, token, ip, headers: { 'x-misskey-local-token': token } })).toBe(true);
	});

	test('token configured: wrong header is denied', () => {
		expect(isAllowedLocalAutomationRequest({ allowedIps, token, ip, headers: { 'x-misskey-local-token': 'wrong' } })).toBe(false);
	});

	test('token configured: missing header is denied', () => {
		expect(isAllowedLocalAutomationRequest({ allowedIps, token, ip, headers: {} })).toBe(false);
		expect(isAllowedLocalAutomationRequest({ allowedIps, token, ip, headers: null })).toBe(false);
	});

	test('X-Forwarded-For present is denied even with the correct token', () => {
		expect(isAllowedLocalAutomationRequest({
			allowedIps, token, ip,
			headers: { 'x-misskey-local-token': token, 'x-forwarded-for': '203.0.113.5' },
		})).toBe(false);
	});

	test('token configured but IP not allowed is denied', () => {
		expect(isAllowedLocalAutomationRequest({ allowedIps, token, ip: '192.0.2.1', headers: { 'x-misskey-local-token': token } })).toBe(false);
	});

	test('empty allowedIps is denied', () => {
		expect(isAllowedLocalAutomationRequest({ allowedIps: [], token, ip, headers: { 'x-misskey-local-token': token } })).toBe(false);
		expect(isAllowedLocalAutomationRequest({ allowedIps: [], ip, headers: {} })).toBe(false);
	});
});
