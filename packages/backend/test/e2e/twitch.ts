/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { describe, beforeAll, test } from 'vitest';
import { api, castAsError, signup } from '../utils.js';
import type * as misskey from 'misskey-js';

// テスト環境には config.twitch が無いため「未設定時」の分岐のみ検証する。
// (Twitch API 本体との疎通は外部依存のため e2e 対象外)
describe('Twitch連携', () => {
	let alice: misskey.entities.SignupResponse;

	beforeAll(async () => {
		alice = await signup({ username: 'alice' });
	}, 1000 * 60 * 2);

	test('未設定のインスタンスでは my-account が available: false を返す', async () => {
		const res = await api('twitch/my-account', {}, alice);
		assert.strictEqual(res.status, 200);
		assert.strictEqual((res.body as any).available, false);
		assert.strictEqual((res.body as any).linked, false);
	});

	test('未設定のインスタンスでは認可 URL を発行できない', async () => {
		const res = await api('twitch/generate-oauth-url', {}, alice);
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'TWITCH_NOT_CONFIGURED');
	});

	test('未連携のユーザーは unlink できない', async () => {
		const res = await api('twitch/unlink', {}, alice);
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'TWITCH_NOT_LINKED');
	});

	test('未認証では my-account にアクセスできない', async () => {
		const res = await api('twitch/my-account', {});
		assert.strictEqual(res.status, 401);
	});

	test('未連携ユーザーの streams/show は TWITCH_NOT_LINKED', async () => {
		const res = await api('twitch/streams/show', { userId: alice.id }, alice);
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'TWITCH_NOT_LINKED');
	});

	test('存在しない streamId のコメント履歴は空配列', async () => {
		const res = await api('twitch/streams/comments', { streamId: alice.id }, alice);
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(res.body, []);
	});

	test('存在しない streamId にはコメントを投稿できない', async () => {
		const res = await api('twitch/streams/comments/create', { streamId: alice.id, text: 'hello' }, alice);
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_STREAM');
	});
});
