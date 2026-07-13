/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { describe, beforeAll, test } from 'vitest';
import { api, castAsError, signup } from '../utils.js';
import type * as misskey from 'misskey-js';

// Phase 1 (config.ome 非依存) の live-channels/* endpoint 5本を検証する。
// OME 連携 (ingest URL の実際値・admission 判定) は Phase 2 の対象で本テストの対象外。
describe('ライブチャンネル', () => {
	let alice: misskey.entities.SignupResponse;
	let bob: misskey.entities.SignupResponse;

	beforeAll(async () => {
		alice = await signup({ username: 'alice' });
		bob = await signup({ username: 'bob' });
	}, 1000 * 60 * 2);

	test('未設定時: show は NO_SUCH_CHANNEL', async () => {
		const res = await api('live-channels/show', { userId: alice.id });
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_CHANNEL');
	});

	test('未設定時: my は channel: null を返す', async () => {
		const res = await api('live-channels/my', {}, alice);
		assert.strictEqual(res.status, 200);
		assert.strictEqual((res.body as any).channel, null);
		assert.strictEqual((res.body as any).streamKey, null);
		assert.strictEqual((res.body as any).rtmpUrl, null);
		assert.strictEqual((res.body as any).srtUrl, null);
		assert.strictEqual((res.body as any).whipUrl, null);
	});

	test('create で有効化できる', async () => {
		const res = await api('live-channels/create', {}, alice);
		assert.strictEqual(res.status, 200);
		const body = res.body as any;
		assert.strictEqual(body.enabled, true);
		assert.strictEqual(body.userId, alice.id);
		assert.strictEqual(typeof body.streamKey, 'string');
		assert.strictEqual(body.streamKey.length, 32);
	});

	test('二重作成は ALREADY_EXISTS', async () => {
		const res = await api('live-channels/create', {}, alice);
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'ALREADY_EXISTS');
	});

	test('他人からは streamKey が見えない', async () => {
		const asOwner = await api('live-channels/show', { userId: alice.id }, alice);
		assert.strictEqual(asOwner.status, 200);
		assert.strictEqual(typeof (asOwner.body as any).streamKey, 'string');

		const asOther = await api('live-channels/show', { userId: alice.id }, bob);
		assert.strictEqual(asOther.status, 200);
		assert.strictEqual((asOther.body as any).streamKey, undefined);
	});

	test('regenerate-key で streamKey が変わる', async () => {
		const before = await api('live-channels/my', {}, alice);
		const beforeKey = (before.body as any).streamKey;
		const beforeRegeneratedAt = (before.body as any).channel.streamKeyRegeneratedAt;

		const res = await api('live-channels/regenerate-key', {}, alice);
		assert.strictEqual(res.status, 200);
		const body = res.body as any;
		assert.notStrictEqual(body.streamKey, beforeKey);
		assert.notStrictEqual(body.streamKeyRegeneratedAt, beforeRegeneratedAt);
	});

	test('update で name/description/enabled を更新できる', async () => {
		const res = await api('live-channels/update', { name: 'Alice Channel', description: 'hello' }, alice);
		assert.strictEqual(res.status, 200);
		const body = res.body as any;
		assert.strictEqual(body.name, 'Alice Channel');
		assert.strictEqual(body.description, 'hello');
		// enabled は未指定なので変更されない (true のまま)
		assert.strictEqual(body.enabled, true);

		const res2 = await api('live-channels/update', { enabled: false }, alice);
		assert.strictEqual(res2.status, 200);
		const body2 = res2.body as any;
		assert.strictEqual(body2.enabled, false);
		// name/description は未指定なので変更されない
		assert.strictEqual(body2.name, 'Alice Channel');
		assert.strictEqual(body2.description, 'hello');
	});

	test('未認証では create/update/regenerate-key/my を呼べない (show のみ未認証可)', async () => {
		// live-channels/{create,update,regenerate-key,my} は secure:true。
		// ApiCallService.call() は secure チェック (401 の CREDENTIAL_REQUIRED より前段) で弾くため、
		// 未認証時は 400 ACCESS_DENIED になる (twitch/generate-oauth-url 等の secure:true endpoint と同型)。
		const create = await api('live-channels/create', {});
		assert.strictEqual(create.status, 400);

		const update = await api('live-channels/update', {});
		assert.strictEqual(update.status, 400);

		const regenerate = await api('live-channels/regenerate-key', {});
		assert.strictEqual(regenerate.status, 400);

		const my = await api('live-channels/my', {});
		assert.strictEqual(my.status, 400);

		const show = await api('live-channels/show', { userId: alice.id });
		assert.strictEqual(show.status, 200);
	});

	test('存在しない userId の show は NO_SUCH_CHANNEL', async () => {
		const res = await api('live-channels/show', { userId: '000000000000000000000000' });
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_CHANNEL');
	});
});
