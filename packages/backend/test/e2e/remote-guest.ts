/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { describe, beforeAll, test } from 'vitest';
import { api, castAsError, signup } from '../utils.js';
import type * as misskey from 'misskey-js';

// テスト環境には config.remoteGuestLogin が無いため「未設定時」の分岐のみ検証する。
// (実際のリモート MiAuth フローとの疎通は別インスタンスが要るため e2e 対象外)
describe('リモートゲストログイン', () => {
	let alice: misskey.entities.SignupResponse;

	beforeAll(async () => {
		alice = await signup({ username: 'alice' });
	}, 1000 * 60 * 2);

	test('未設定のインスタンスではどのホストも許可されずログインを開始できない', async () => {
		const res = await api('remote-guest/login/start', { acct: 'someone@misskey.example', returnTo: '/live/@alice' });
		assert.strictEqual(res.status, 403);
		assert.strictEqual(castAsError(res.body as any).error.code, 'HOST_NOT_ALLOWED');
	});

	test('acct に @ が無いと INVALID_ACCT', async () => {
		const res = await api('remote-guest/login/start', { acct: 'not-an-acct', returnTo: '/live/@alice' });
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'INVALID_ACCT');
	});

	test('returnTo が /live/ 始まりでないと INVALID_ACCT', async () => {
		const res = await api('remote-guest/login/start', { acct: 'someone@misskey.example', returnTo: '/settings' });
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'INVALID_ACCT');
	});

	test('無効な guestToken ではコメント履歴を取得できない', async () => {
		const res = await api('remote-guest/twitch-comments', { guestToken: 'invalid-token', streamId: alice.id });
		assert.strictEqual(res.status, 401);
		assert.strictEqual(castAsError(res.body as any).error.code, 'GUEST_SESSION_INVALID');
	});

	test('無効な guestToken ではコメントを投稿できない', async () => {
		const res = await api('remote-guest/twitch-comments/create', { guestToken: 'invalid-token', streamId: alice.id, text: 'hello' });
		assert.strictEqual(res.status, 401);
		assert.strictEqual(castAsError(res.body as any).error.code, 'GUEST_SESSION_INVALID');
	});

	test('存在しない guestToken の revoke は success: false を返す (エラーにはしない)', async () => {
		const res = await api('remote-guest/session/revoke', { guestToken: 'invalid-token' });
		assert.strictEqual(res.status, 200);
		assert.strictEqual((res.body as any).success, false);
	});

	test('twitch/streams/show は未認証でも呼べる (視聴ページの認証不要化)', async () => {
		const res = await api('twitch/streams/show', { userId: alice.id });
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'TWITCH_NOT_LINKED');
	});
});
