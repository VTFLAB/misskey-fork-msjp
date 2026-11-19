/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { describe, beforeAll, test } from 'vitest';
import { api, castAsError, createAppToken, signup } from '../utils.js';
import type * as misskey from 'misskey-js';

// 音声秘書など外部アプリ向けの常駐オーディオプレイヤー操作 (bsky-fork 独自)
describe('Audio player remote control', () => {
	let alice: misskey.entities.SignupResponse;
	let bob: misskey.entities.SignupResponse;

	const playlistIndex = [
		{ id: 'abc123', name: '作業用', trackCount: 3, updatedAt: 1700000000000 },
		{ id: 'def456', name: '寝る前', trackCount: 0, updatedAt: 1700000001000 },
	];

	beforeAll(async () => {
		alice = await signup({ username: 'alice' });
		bob = await signup({ username: 'bob' });
	}, 1000 * 60 * 2);

	describe('i/audio-player/playlists', () => {
		test('何も保存していなければ空配列を返す', async () => {
			const res = await api('i/audio-player/playlists', {}, bob);
			assert.strictEqual(res.status, 200);
			assert.deepStrictEqual(res.body, []);
		});

		test('Web クライアントが保存したインデックスを返す', async () => {
			const set = await api('i/registry/set', { scope: ['client', 'audioPlayer'], key: 'playlists', value: playlistIndex }, alice);
			assert.strictEqual(set.status, 204);

			const res = await api('i/audio-player/playlists', {}, alice);
			assert.strictEqual(res.status, 200);
			assert.deepStrictEqual(res.body, playlistIndex);
		});

		test('壊れたエントリは取り除く', async () => {
			const set = await api('i/registry/set', {
				scope: ['client', 'audioPlayer'],
				key: 'playlists',
				value: [playlistIndex[0], null, { id: 1, name: 'x', trackCount: 1, updatedAt: 1 }, { id: 'ok', name: 'y' }, 'str'],
			}, alice);
			assert.strictEqual(set.status, 204);

			const res = await api('i/audio-player/playlists', {}, alice);
			assert.strictEqual(res.status, 200);
			assert.deepStrictEqual(res.body, [playlistIndex[0]]);
		});

		test('read:audio-player 権限のアクセストークンでも Web クライアントのプレイリストを読める', async () => {
			const set = await api('i/registry/set', { scope: ['client', 'audioPlayer'], key: 'playlists', value: playlistIndex }, alice);
			assert.strictEqual(set.status, 204);

			const token = await createAppToken(alice, ['read:audio-player']);
			const res = await api('i/audio-player/playlists', {}, { token, bearer: true });
			assert.strictEqual(res.status, 200);
			assert.deepStrictEqual(res.body, playlistIndex);
		});

		test('権限のないアクセストークンでは読めない', async () => {
			const token = await createAppToken(alice, ['read:account']);
			const res = await api('i/audio-player/playlists', {}, { token, bearer: true });
			assert.strictEqual(res.status, 403);
		});
	});

	describe('i/audio-player/command', () => {
		test('playPlaylist に playlistId が無ければエラー', async () => {
			const res = await api('i/audio-player/command', { action: 'playPlaylist' }, alice);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'PLAYLIST_ID_REQUIRED');
		});

		test('存在しないプレイリストならエラー', async () => {
			const res = await api('i/audio-player/command', { action: 'playPlaylist', playlistId: 'doesnotexist' }, alice);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_PLAYLIST');
		});

		test('保存済みのプレイリストなら playPlaylist が成功する', async () => {
			const set = await api('i/registry/set', {
				scope: ['client', 'audioPlayer'],
				key: 'playlist:abc123',
				value: { id: 'abc123', name: '作業用', tracks: [], updatedAt: 1700000000000 },
			}, alice);
			assert.strictEqual(set.status, 204);

			const res = await api('i/audio-player/command', { action: 'playPlaylist', playlistId: 'abc123', shuffle: true }, alice);
			assert.strictEqual(res.status, 204);
		});

		test('他のユーザーのプレイリストは存在しない扱い', async () => {
			const res = await api('i/audio-player/command', { action: 'playPlaylist', playlistId: 'abc123' }, bob);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_PLAYLIST');
		});

		test('play が成功する', async () => {
			const res = await api('i/audio-player/command', { action: 'play' }, alice);
			assert.strictEqual(res.status, 204);
		});

		test('不正な action は拒否される', async () => {
			const res = await api('i/audio-player/command', { action: 'explode' } as any, alice);
			assert.strictEqual(res.status, 400);
		});

		test('不正な playlistId は拒否される', async () => {
			const res = await api('i/audio-player/command', { action: 'playPlaylist', playlistId: 'a/b' }, alice);
			assert.strictEqual(res.status, 400);
		});

		test('write:audio-player 権限のアクセストークンで操作できる', async () => {
			const token = await createAppToken(alice, ['write:audio-player']);
			const res = await api('i/audio-player/command', { action: 'toggle' }, { token, bearer: true });
			assert.strictEqual(res.status, 204);
		});

		test('read:audio-player 権限だけでは操作できない', async () => {
			const token = await createAppToken(alice, ['read:audio-player']);
			const res = await api('i/audio-player/command', { action: 'toggle' }, { token, bearer: true });
			assert.strictEqual(res.status, 403);
		});
	});
});
