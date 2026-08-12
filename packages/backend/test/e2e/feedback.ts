/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { describe, beforeAll, test } from 'vitest';
import { api, castAsError, signup, uploadFile } from '../utils.js';
import type * as misskey from 'misskey-js';

// bsky-fork 独自: バグ報告・機能要望の受付 API (feedback/create, feedback/list)。
// LAN 限定の feedback/list-local / update-status-local は到達経路ガードにより
// テスト環境から正常系を通せないため対象外 (update-info/create-local と同じ扱い)。
describe('フィードバック受付', () => {
	let alice: misskey.entities.SignupResponse;
	let bob: misskey.entities.SignupResponse;

	beforeAll(async () => {
		alice = await signup({ username: 'alice' });
		bob = await signup({ username: 'bob' });
	}, 1000 * 60 * 2);

	test('バグ報告を送信できる', async () => {
		const res = await api('feedback/create', {
			type: 'bug',
			title: 'テストのバグ報告',
			body: '再現手順: ...',
		}, alice);
		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.body.type, 'bug');
		assert.strictEqual(res.body.status, 'open');
	});

	test('画像を添付して送信できる', async () => {
		const file = (await uploadFile(alice)).body!;
		const res = await api('feedback/create', {
			type: 'feature',
			title: '画像添付テスト',
			body: 'スクリーンショットつき',
			fileIds: [file.id],
		}, alice);
		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.body.files.length, 1);
		assert.strictEqual(res.body.files[0].id, file.id);
	});

	test('他人の Drive ファイルは添付できない', async () => {
		const file = (await uploadFile(bob)).body!;
		const res = await api('feedback/create', {
			type: 'bug',
			title: '不正添付テスト',
			body: '本文',
			fileIds: [file.id],
		}, alice);
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_FILE');
	});

	test('画像以外 (SVG) は添付できない', async () => {
		const file = (await uploadFile(alice, { path: 'image.svg' })).body!;
		const res = await api('feedback/create', {
			type: 'bug',
			title: 'SVG 添付テスト',
			body: '本文',
			fileIds: [file.id],
		}, alice);
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'INVALID_FILE_TYPE');
	});

	test('未認証では送信できない', async () => {
		const res = await api('feedback/create', {
			type: 'bug',
			title: '未認証テスト',
			body: '本文',
		});
		assert.strictEqual(res.status, 401);
	});

	test('自分の報告のみ一覧に出る', async () => {
		const res = await api('feedback/list', { limit: 100 }, alice);
		assert.strictEqual(res.status, 200);
		assert.ok(res.body.length >= 2);
		// bob の報告は 1 件もないはず (bob 名義で feedback は送っていない)
		const resBob = await api('feedback/list', { limit: 100 }, bob);
		assert.strictEqual(resBob.status, 200);
		assert.strictEqual(resBob.body.length, 0);
	});

	test('管理 API はモデレーター以外拒否される', async () => {
		// alice はこのファイルの最初の signup = インスタンス初期管理者、bob は一般ユーザー
		const res = await api('admin/feedback/list', {}, bob);
		assert.strictEqual(res.status, 403);
	});

	test('モデレーターは全件一覧と状態更新・返信ができる', async () => {
		const list = await api('admin/feedback/list', { limit: 100 }, alice);
		assert.strictEqual(list.status, 200);
		assert.ok(list.body.length >= 2);
		// admin 一覧には報告者 (user) が含まれる
		assert.ok(list.body.every(f => f.user != null));

		const target = list.body[list.body.length - 1];
		const updated = await api('admin/feedback/update', {
			feedbackId: target.id,
			status: 'resolved',
			response: '対応しました',
		}, alice);
		assert.strictEqual(updated.status, 200);

		// 報告者本人の一覧に状態と返信が反映される
		const mine = await api('feedback/list', { limit: 100 }, alice);
		const mineTarget = mine.body.find(f => f.id === target.id)!;
		assert.strictEqual(mineTarget.status, 'resolved');
		assert.strictEqual(mineTarget.response, '対応しました');
	});

	test('LAN 限定 endpoint は経路ガードで拒否される (allowedIps 未設定)', async () => {
		const res = await api('feedback/list-local', {});
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'ACCESS_DENIED');
	});
});
