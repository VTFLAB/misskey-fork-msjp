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
		assert.strictEqual(typeof body.channelId, 'string');
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

	test('update で紐づく channel の name/description も同期される', async () => {
		const my = await api('live-channels/my', {}, alice);
		assert.strictEqual(my.status, 200);
		const channelId = (my.body as any).channel.channelId;
		assert.strictEqual(typeof channelId, 'string');

		const update = await api('live-channels/update', { name: 'Alice Updated', description: 'updated desc' }, alice);
		assert.strictEqual(update.status, 200);

		const channelShow = await api('channels/show', { channelId });
		assert.strictEqual(channelShow.status, 200);
		assert.strictEqual((channelShow.body as any).name, 'Alice Updated');
		assert.strictEqual((channelShow.body as any).description, 'updated desc');
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

// 視聴制限機能 (WI-視聴制限)。update/my の往復と verify-view-password の成功/失敗を検証する。
// OME 実体 (admission webhook / 実際の視聴) は対象外 (config.ome 非依存)。
describe('ライブチャンネル 視聴制限', () => {
	let alice: misskey.entities.SignupResponse;
	let bob: misskey.entities.SignupResponse;

	beforeAll(async () => {
		alice = await signup({ username: 'aliceviewrestrict' });
		bob = await signup({ username: 'bobviewrestrict' });
		const created = await api('live-channels/create', {}, alice);
		assert.strictEqual(created.status, 200);
	}, 1000 * 60 * 2);

	test('既定値は public', async () => {
		const res = await api('live-channels/my', {}, alice);
		assert.strictEqual(res.status, 200);
		assert.strictEqual((res.body as any).channel.visibility, 'public');
		assert.deepStrictEqual((res.body as any).channel.visibleUserIds, []);
		assert.strictEqual((res.body as any).channel.viewPassword, null);
	});

	test('password モードへ viewPassword 無しで切り替えると VIEW_PASSWORD_REQUIRED', async () => {
		const res = await api('live-channels/update', { visibility: 'password' }, alice);
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'VIEW_PASSWORD_REQUIRED');
	});

	test('password モードへ viewPassword 付きで切り替えられ、my に反映される', async () => {
		const res = await api('live-channels/update', { visibility: 'password', viewPassword: 'himitsu123' }, alice);
		assert.strictEqual(res.status, 200);
		assert.strictEqual((res.body as any).visibility, 'password');
		assert.strictEqual((res.body as any).viewPassword, 'himitsu123');

		const my = await api('live-channels/my', {}, alice);
		assert.strictEqual((my.body as any).channel.visibility, 'password');
		assert.strictEqual((my.body as any).channel.viewPassword, 'himitsu123');
	});

	test('他人には visibility/viewPassword/visibleUserIds が見えない (show 経由)', async () => {
		const res = await api('live-channels/show', { userId: alice.id }, bob);
		assert.strictEqual(res.status, 200);
		assert.strictEqual((res.body as any).visibility, undefined);
		assert.strictEqual((res.body as any).viewPassword, undefined);
		assert.strictEqual((res.body as any).visibleUserIds, undefined);
	});

	test('users モードで visibleUserIds を設定できる', async () => {
		const res = await api('live-channels/update', { visibility: 'users', visibleUserIds: [bob.id] }, alice);
		assert.strictEqual(res.status, 200);
		assert.strictEqual((res.body as any).visibility, 'users');
		assert.deepStrictEqual((res.body as any).visibleUserIds, [bob.id]);
	});

	test('visibleUserIds が101件だと 400 (maxItems)', async () => {
		const tooMany = Array.from({ length: 101 }, (_, i) => i.toString(36).padStart(16, '0'));
		const res = await api('live-channels/update', { visibility: 'users', visibleUserIds: tooMany }, alice);
		assert.strictEqual(res.status, 400);
	});

	test('verify-view-password: 正しいパスワードで viewToken が発行される', async () => {
		const setPassword = await api('live-channels/update', { visibility: 'password', viewPassword: 'correct-horse' }, alice);
		assert.strictEqual(setPassword.status, 200);

		const res = await api('live-channels/verify-view-password', { userId: alice.id, password: 'correct-horse' });
		assert.strictEqual(res.status, 200);
		assert.strictEqual(typeof (res.body as any).viewToken, 'string');
		assert.ok((res.body as any).viewToken.length > 0);
	});

	test('verify-view-password: 誤ったパスワードは INVALID_PASSWORD', async () => {
		const res = await api('live-channels/verify-view-password', { userId: alice.id, password: 'wrong-password' });
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'INVALID_PASSWORD');
	});

	test('verify-view-password: ライブチャンネル未開設のユーザーは NO_SUCH_CHANNEL', async () => {
		// bob はこの describe 内で live-channels/create を呼んでいない (未開設)。
		const res = await api('live-channels/verify-view-password', { userId: bob.id, password: 'anything' });
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_CHANNEL');
	});

	test('verify-view-password: password モード以外のチャンネルは NO_SUCH_CHANNEL', async () => {
		const back = await api('live-channels/update', { visibility: 'public' }, alice);
		assert.strictEqual(back.status, 200);

		const res = await api('live-channels/verify-view-password', { userId: alice.id, password: 'anything' });
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_CHANNEL');
	});

	test('verify-view-password: 存在しない userId は NO_SUCH_CHANNEL', async () => {
		const res = await api('live-channels/verify-view-password', { userId: '000000000000000000000000', password: 'anything' });
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_CHANNEL');
	});
});
