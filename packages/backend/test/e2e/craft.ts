/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { beforeAll, describe, test } from 'vitest';
import { api, castAsError, connectStream, signup } from '../utils.js';
import type * as misskey from 'misskey-js';

describe('Misskey Craft', () => {
	let alice: misskey.entities.SignupResponse;
	let bob: misskey.entities.SignupResponse;

	beforeAll(async () => {
		alice = await signup({ username: 'alice' });
		bob = await signup({ username: 'bob' });
	}, 1000 * 60 * 2);

	test('ワールドを作成して取得できる', async () => {
		const created = await api('craft/create', { name: 'alice world', seed: 42, isPublic: true }, alice);
		assert.strictEqual(created.status, 200);
		assert.strictEqual(created.body.name, 'alice world');
		assert.strictEqual(created.body.seed, 42);
		assert.strictEqual(created.body.isPublic, true);
		assert.strictEqual(created.body.userId, alice.id);
		assert.strictEqual(created.body.blockCount, 0);

		const shown = await api('craft/show', { worldId: created.body.id }, bob);
		assert.strictEqual(shown.status, 200);
		assert.strictEqual(shown.body.id, created.body.id);

		const blocks = await api('craft/blocks', { worldId: created.body.id });
		assert.strictEqual(blocks.status, 200);
		assert.deepStrictEqual(blocks.body.blocks, []);
	});

	test('シード値を省略するとランダムに決まる', async () => {
		const created = await api('craft/create', { name: 'random seed' }, alice);
		assert.strictEqual(created.status, 200);
		assert.strictEqual(typeof created.body.seed, 'number');
	});

	test('未ログインでは作成できない', async () => {
		const res = await api('craft/create', { name: 'anon' });
		assert.strictEqual(res.status, 401);
	});

	test('一覧には公開ワールドだけが出て、my では自分のものが出る', async () => {
		const pub = await api('craft/create', { name: 'public', isPublic: true }, bob);
		const priv = await api('craft/create', { name: 'private', isPublic: false }, bob);
		assert.strictEqual(pub.status, 200);
		assert.strictEqual(priv.status, 200);

		const all = await api('craft/worlds', { limit: 100 });
		assert.strictEqual(all.status, 200);
		assert.ok(all.body.some(w => w.id === pub.body.id));
		assert.ok(!all.body.some(w => w.id === priv.body.id));

		const mine = await api('craft/worlds', { limit: 100, my: true }, bob);
		assert.strictEqual(mine.status, 200);
		assert.ok(mine.body.some(w => w.id === priv.body.id));
		assert.ok(!mine.body.some(w => w.userId !== bob.id));
	});

	test('ストリームでブロックを置くと保存され、壊した地形も空気として残る', async () => {
		const created = await api('craft/create', { name: 'build', isPublic: true }, alice);
		assert.strictEqual(created.status, 200);

		const received: Record<string, any>[] = [];
		const ws = await connectStream(bob, 'craftWorld', msg => received.push(msg), { worldId: created.body.id });
		ws.send(JSON.stringify({ type: 'ch', body: { id: 'a', type: 'setBlock', body: { x: 1, y: 30, z: 2, type: 9 } } }));
		ws.send(JSON.stringify({ type: 'ch', body: { id: 'a', type: 'setBlock', body: { x: 3, y: 30, z: 4, type: 0 } } }));
		// 範囲外・最下層の破壊は拒否される
		ws.send(JSON.stringify({ type: 'ch', body: { id: 'a', type: 'setBlock', body: { x: 999, y: 30, z: 4, type: 1 } } }));
		ws.send(JSON.stringify({ type: 'ch', body: { id: 'a', type: 'setBlock', body: { x: 5, y: 0, z: 5, type: 0 } } }));
		await new Promise(r => setTimeout(r, 1000));
		ws.close();

		const updated = received.filter(m => m.type === 'blockUpdated').map(m => m.body);
		assert.deepStrictEqual(updated.map(b => [b.x, b.y, b.z, b.type, b.userId]), [[1, 30, 2, 9, bob.id], [3, 30, 4, 0, bob.id]]);
		const rejected = received.filter(m => m.type === 'setBlockRejected').map(m => m.body);
		assert.deepStrictEqual(rejected.map(b => [b.x, b.y, b.z]), [[999, 30, 4], [5, 0, 5]]);

		const blocks = await api('craft/blocks', { worldId: created.body.id });
		assert.strictEqual(blocks.status, 200);
		assert.deepStrictEqual(blocks.body.blocks, [1, 30, 2, 9, 3, 30, 4, 0]);

		const shown = await api('craft/show', { worldId: created.body.id });
		assert.strictEqual(shown.body.blockCount, 2);

		// 同じ座標への上書きは行数を増やさない
		const ws2 = await connectStream(alice, 'craftWorld', () => {}, { worldId: created.body.id });
		ws2.send(JSON.stringify({ type: 'ch', body: { id: 'a', type: 'setBlock', body: { x: 1, y: 30, z: 2, type: 3 } } }));
		await new Promise(r => setTimeout(r, 1000));
		ws2.close();
		const shown2 = await api('craft/show', { worldId: created.body.id });
		assert.strictEqual(shown2.body.blockCount, 2);
		const blocks2 = await api('craft/blocks', { worldId: created.body.id });
		assert.ok(blocks2.body.blocks.length === 8);
	});

	test('非公開ワールドではオーナー以外のブロック設置が拒否される', async () => {
		const created = await api('craft/create', { name: 'locked', isPublic: false }, alice);
		assert.strictEqual(created.status, 200);

		const received: Record<string, any>[] = [];
		const ws = await connectStream(bob, 'craftWorld', msg => received.push(msg), { worldId: created.body.id });
		ws.send(JSON.stringify({ type: 'ch', body: { id: 'a', type: 'setBlock', body: { x: 1, y: 30, z: 2, type: 9 } } }));
		await new Promise(r => setTimeout(r, 1000));
		ws.close();

		assert.ok(received.some(m => m.type === 'setBlockRejected'));
		assert.ok(!received.some(m => m.type === 'blockUpdated'));
		const blocks = await api('craft/blocks', { worldId: created.body.id });
		assert.deepStrictEqual(blocks.body.blocks, []);
	});

	test('更新と削除はオーナーだけができる', async () => {
		const created = await api('craft/create', { name: 'owned', isPublic: true }, alice);
		assert.strictEqual(created.status, 200);

		const denied = await api('craft/update', { worldId: created.body.id, name: 'hacked' }, bob);
		assert.strictEqual(denied.status, 400);
		assert.strictEqual(castAsError(denied.body as any).error.code, 'ACCESS_DENIED');

		const updated = await api('craft/update', { worldId: created.body.id, name: 'renamed', isPublic: false }, alice);
		assert.strictEqual(updated.status, 200);
		assert.strictEqual(updated.body.name, 'renamed');
		assert.strictEqual(updated.body.isPublic, false);

		// 変更項目なしでも 500 にならず現状を返す
		const noop = await api('craft/update', { worldId: created.body.id }, alice);
		assert.strictEqual(noop.status, 200);
		assert.strictEqual(noop.body.name, 'renamed');

		const deniedDelete = await api('craft/delete', { worldId: created.body.id }, bob);
		assert.strictEqual(deniedDelete.status, 400);
		assert.strictEqual(castAsError(deniedDelete.body as any).error.code, 'ACCESS_DENIED');

		const deleted = await api('craft/delete', { worldId: created.body.id }, alice);
		assert.strictEqual(deleted.status, 204);

		const gone = await api('craft/show', { worldId: created.body.id });
		assert.strictEqual(gone.status, 400);
		assert.strictEqual(castAsError(gone.body as any).error.code, 'NO_SUCH_WORLD');
	});
});
