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
		ws.send(JSON.stringify({ type: 'ch', body: { id: 'a', type: 'setBlock', body: { x: 2000000, y: 30, z: 4, type: 1 } } }));
		ws.send(JSON.stringify({ type: 'ch', body: { id: 'a', type: 'setBlock', body: { x: 5, y: 0, z: 5, type: 0 } } }));
		await new Promise(r => setTimeout(r, 1000));
		ws.close();

		const updated = received.filter(m => m.type === 'blockUpdated').map(m => m.body);
		assert.deepStrictEqual(updated.map(b => [b.x, b.y, b.z, b.type, b.userId]), [[1, 30, 2, 9, bob.id], [3, 30, 4, 0, bob.id]]);
		const rejected = received.filter(m => m.type === 'setBlockRejected').map(m => m.body);
		assert.deepStrictEqual(rejected.map(b => [b.x, b.y, b.z]), [[2000000, 30, 4], [5, 0, 5]]);

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

	test('MOB の配信は move を送った接続からだけ中継され、target が長すぎる配信は捨てられる', async () => {
		const created = await api('craft/create', { name: 'mobs', isPublic: true }, alice);
		assert.strictEqual(created.status, 200);

		const received: Record<string, any>[] = [];
		const watcher = await connectStream(alice, 'craftWorld', msg => received.push(msg), { worldId: created.body.id });
		const host = await connectStream(bob, 'craftWorld', () => {}, { worldId: created.body.id });
		const mob = { id: 'bob:1', type: 'zombie', x: 1, y: 40, z: 2, yaw: 0, hp: 20, target: null, attackAt: 0 };
		// move を送る前の配信は中継されない
		host.send(JSON.stringify({ type: 'ch', body: { id: 'a', type: 'mobs', body: { t: 1, mobs: [mob] } } }));
		await new Promise(r => setTimeout(r, 500));
		assert.ok(!received.some(m => m.type === 'mobsUpdated'));

		host.send(JSON.stringify({ type: 'ch', body: { id: 'a', type: 'move', body: { x: 0, y: 40, z: 0, yaw: 0, pitch: 0 } } }));
		host.send(JSON.stringify({ type: 'ch', body: { id: 'a', type: 'mobs', body: { t: 2, mobs: [mob] } } }));
		host.send(JSON.stringify({ type: 'ch', body: { id: 'a', type: 'mobs', body: { t: 3, mobs: [{ ...mob, target: 'x'.repeat(100) }] } } }));
		await new Promise(r => setTimeout(r, 1000));
		watcher.close();
		host.close();

		const updates = received.filter(m => m.type === 'mobsUpdated').map(m => m.body);
		assert.strictEqual(updates.length, 1);
		assert.strictEqual(updates[0].hostId, bob.id);
		assert.strictEqual(updates[0].t, 2);
		assert.deepStrictEqual(updates[0].mobs, [mob]);
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

	test('スキンは自分の 64x64 PNG だけ設定でき、解除もできる', async () => {
		const none = await api('craft/skin', {}, alice);
		assert.strictEqual(none.status, 200);
		assert.strictEqual(none.body.skinUrl, null);

		const missing = await api('craft/set-skin', { fileId: 'aaaaaaaaaaaaaaaa' }, alice);
		assert.strictEqual(missing.status, 400);
		assert.strictEqual(castAsError(missing.body as any).error.code, 'NO_SUCH_FILE');

		const cleared = await api('craft/set-skin', { fileId: null }, alice);
		assert.strictEqual(cleared.status, 200);
		assert.strictEqual(cleared.body.skinUrl, null);
	});

	test('プレイヤーのセーブデータを保存して取得でき、大きすぎる状態と存在しないワールドは拒否される', async () => {
		const created = await api('craft/create', { name: 'state', isPublic: true }, alice);
		assert.strictEqual(created.status, 200);

		const empty = await api('craft/state', { worldId: created.body.id }, bob);
		assert.strictEqual(empty.status, 200);
		assert.strictEqual(empty.body.state, null);
		assert.strictEqual(empty.body.updatedAt, null);

		const state = { inv: [[1, 64], [2, 3]], hp: 18, pos: [1.5, 40, -2.5] };
		const saved = await api('craft/save-state', { worldId: created.body.id, state }, bob);
		assert.strictEqual(saved.status, 204);

		const got = await api('craft/state', { worldId: created.body.id }, bob);
		assert.strictEqual(got.status, 200);
		assert.deepStrictEqual(got.body.state, state);
		assert.strictEqual(typeof got.body.updatedAt, 'string');

		// 上書きできる。他のユーザーには見えない
		const saved2 = await api('craft/save-state', { worldId: created.body.id, state: { hp: 5 } }, bob);
		assert.strictEqual(saved2.status, 204);
		const got2 = await api('craft/state', { worldId: created.body.id }, bob);
		assert.deepStrictEqual(got2.body.state, { hp: 5 });
		const other = await api('craft/state', { worldId: created.body.id }, alice);
		assert.strictEqual(other.body.state, null);

		const tooLarge = await api('craft/save-state', { worldId: created.body.id, state: { blob: 'x'.repeat(32768) } }, bob);
		assert.strictEqual(tooLarge.status, 400);
		assert.strictEqual(castAsError(tooLarge.body as any).error.code, 'STATE_TOO_LARGE');
		// 上限は byte 数で数える (CJK は 1 文字 3 byte)
		const tooLargeCjk = await api('craft/save-state', { worldId: created.body.id, state: { blob: 'あ'.repeat(11000) } }, bob);
		assert.strictEqual(tooLargeCjk.status, 400);
		assert.strictEqual(castAsError(tooLargeCjk.body as any).error.code, 'STATE_TOO_LARGE');
		// jsonb が受け付けない NUL 文字
		const nul = await api('craft/save-state', { worldId: created.body.id, state: { s: '\u0000' } }, bob);
		assert.strictEqual(nul.status, 400);
		assert.strictEqual(castAsError(nul.body as any).error.code, 'STATE_TOO_LARGE');
		const still = await api('craft/state', { worldId: created.body.id }, bob);
		assert.deepStrictEqual(still.body.state, { hp: 5 });

		const noWorld = await api('craft/save-state', { worldId: 'aaaaaaaaaaaaaaaa', state: {} }, bob);
		assert.strictEqual(noWorld.status, 400);
		assert.strictEqual(castAsError(noWorld.body as any).error.code, 'NO_SUCH_WORLD');
		const noWorld2 = await api('craft/state', { worldId: 'aaaaaaaaaaaaaaaa' }, bob);
		assert.strictEqual(castAsError(noWorld2.body as any).error.code, 'NO_SUCH_WORLD');
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
