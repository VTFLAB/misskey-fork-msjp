/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { describe, beforeAll, test } from 'vitest';
import { api, castAsError, initTestDb, signup } from '../utils.js';
import { MiTwitchStream } from '@/models/TwitchStream.js';
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

	test('コメント履歴は未認証でも取得できる (OBS オーバーレイ用)', async () => {
		const res = await api('twitch/streams/comments', { streamId: alice.id });
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(res.body, []);
	});

	test('配信ブロック一覧は初期状態で空', async () => {
		const res = await api('twitch/streams/blocks/list', {}, alice);
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(res.body, []);
	});

	test('存在しないコメントからはブロックできない', async () => {
		const res = await api('twitch/streams/blocks/create', { commentId: alice.id }, alice);
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_COMMENT');
	});

	test('存在しないブロックは解除できない', async () => {
		const res = await api('twitch/streams/blocks/delete', { blockId: alice.id }, alice);
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_BLOCK');
	});

	test('配信ブロック一覧は未認証では取得できない', async () => {
		const res = await api('twitch/streams/blocks/list', {});
		assert.strictEqual(res.status, 401);
	});
});

// 配信ブロックの権限分岐・enforcement。twitch_stream は Twitch API 経由でしか
// 作られないため、DB へ直接 seed して API の分岐を検証する
describe('Twitch配信ブロック (配信中の enforcement)', () => {
	let broadcaster: misskey.entities.SignupResponse;
	let viewer: misskey.entities.SignupResponse;
	let streamId: string;

	beforeAll(async () => {
		broadcaster = await signup({ username: 'streamer1' });
		viewer = await signup({ username: 'viewer1' });

		const connection = await initTestDb(true);
		const streams = connection.getRepository(MiTwitchStream);
		const stream = await streams.save(new MiTwitchStream({
			id: 'e2eteststream0001',
			userId: broadcaster.id,
			twitchUserId: '900000001',
			twitchStreamId: 'e2e-session-1',
			twitchLogin: 'streamer1tv',
			isLive: true,
			title: 'e2e test stream',
			viewerCount: 0,
			startedAt: new Date(),
		}));
		streamId = stream.id;
		await connection.destroy();
	}, 1000 * 60 * 2);

	async function postComment(user: misskey.entities.SignupResponse, text: string) {
		return await api('twitch/streams/comments/create', { streamId, text }, user);
	}

	test('視聴者はコメントを投稿できる', async () => {
		const res = await postComment(viewer, 'hello');
		assert.strictEqual(res.status, 200);
	});

	test('配信者以外はブロックできない (NOT_STREAM_OWNER)', async () => {
		const comments = await api('twitch/streams/comments', { streamId }, broadcaster);
		const target = (comments.body as any[])[0];
		const res = await api('twitch/streams/blocks/create', { commentId: target.id }, viewer);
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'NOT_STREAM_OWNER');
	});

	test('配信者は自分自身のコメントをブロックできない (CANNOT_BLOCK)', async () => {
		const posted = await postComment(broadcaster, 'own comment');
		assert.strictEqual(posted.status, 200);
		const res = await api('twitch/streams/blocks/create', { commentId: (posted.body as any).id }, broadcaster);
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'CANNOT_BLOCK');
	});

	test('配信者は視聴者のコメントからブロックでき、以後の投稿は 403 になる', async () => {
		const posted = await postComment(viewer, 'to be blocked');
		assert.strictEqual(posted.status, 200);

		const blocked = await api('twitch/streams/blocks/create', { commentId: (posted.body as any).id }, broadcaster);
		assert.strictEqual(blocked.status, 200);

		const rejected = await postComment(viewer, 'after block');
		assert.strictEqual(rejected.status, 403);
		assert.strictEqual(castAsError(rejected.body as any).error.code, 'BLOCKED_BY_BROADCASTER');
	});

	test('ブロック一覧に対象ユーザーが載り、解除すると再投稿できる', async () => {
		const list = await api('twitch/streams/blocks/list', {}, broadcaster);
		assert.strictEqual(list.status, 200);
		const blocks = list.body as any[];
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(blocks[0].targetType, 'misskey');
		assert.strictEqual(blocks[0].targetUser?.id, viewer.id);

		const deleted = await api('twitch/streams/blocks/delete', { blockId: blocks[0].id }, broadcaster);
		assert.strictEqual(deleted.status, 204);

		const res = await postComment(viewer, 'after unblock');
		assert.strictEqual(res.status, 200);
	});
});
