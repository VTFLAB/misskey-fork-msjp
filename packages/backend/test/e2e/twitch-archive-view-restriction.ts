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

// 配信アーカイブの視聴制限引き継ぎ機能 (bsky-fork 独自)。LiveArchiveAccessService.canWatchArchive
// (owner即許可 → archiveUnpublishedAt → public/followers/users/password の分岐) と、それを使う
// verify-archive-view-password / update-archive-settings / unpublish-archive / comments.ts の
// 視聴制限分岐を検証する。twitch_stream (source: 'ome', isLive: false) は OME 録画パイプライン
// 経由でしか作られないため、「視聴制限 (twitch/streams/show の ome セッション)」ブロック (twitch.ts)
// と同じく DB へ直接 seed する。

// canWatchArchive の分岐網羅。show.ts 経由 (API レイヤ) で検証する。モード遷移は
// twitch/streams/update-archive-settings を経由する (live-channels/update を使う twitch.ts の
// 既存「視聴制限」ブロックと対称の構成)。
describe('配信アーカイブ視聴制限 (canWatchArchive, twitch/streams/show 経由)', () => {
	let broadcaster: misskey.entities.SignupResponse;
	let follower: misskey.entities.SignupResponse;
	let stranger: misskey.entities.SignupResponse;
	const streamId = 'e2earchiveshow01';

	beforeAll(async () => {
		broadcaster = await signup({ username: 'archshowbc' });
		follower = await signup({ username: 'archshowfollower' });
		stranger = await signup({ username: 'archshowstranger' });

		const created = await api('live-channels/create', {}, broadcaster);
		assert.strictEqual(created.status, 200);

		const follow = await api('following/create', { userId: broadcaster.id }, follower);
		assert.strictEqual(follow.status, 200);

		const connection = await initTestDb(true);
		const streams = connection.getRepository(MiTwitchStream);
		await streams.save(new MiTwitchStream({
			id: streamId,
			userId: broadcaster.id,
			twitchUserId: null,
			twitchStreamId: null,
			twitchLogin: null,
			source: 'ome',
			isLive: false,
			title: 'archive show e2e test',
			viewerCount: 0,
			startedAt: new Date(Date.now() - 60 * 60 * 1000),
			endedAt: new Date(),
			recordingStatus: 'ready',
			recordingGoogleDriveFileId: 'drivefile-show-01',
			recordingGoogleDriveThumbnailLink: 'https://example.com/thumb-show-01.jpg',
			youtubeUploadStatus: 'ready',
			youtubeVideoId: 'ytvideo-show-01',
			// archiveViewVisibility はデフォルト 'public' のまま (public モードのテストを先頭に置くため明示しない)
		}));
		await connection.destroy();
	}, 1000 * 60 * 2);

	function archiveSession(res: any) {
		return (res.body as any).sessions.find((s: any) => s.streamId === streamId);
	}

	test('public: 未認証でも authorized:true で youtubeVideoId/recordingGoogleDriveFileId 込みで取得できる', async () => {
		const res = await api('twitch/streams/show', { userId: broadcaster.id });
		assert.strictEqual(res.status, 200);
		const session = archiveSession(res);
		assert.strictEqual(session.authorized, true);
		assert.strictEqual(session.viewRestriction, undefined);
		assert.strictEqual(session.youtubeVideoId, 'ytvideo-show-01');
		assert.strictEqual(session.recordingGoogleDriveFileId, 'drivefile-show-01');
		assert.strictEqual(session.recordingGoogleDriveThumbnailLink, 'https://example.com/thumb-show-01.jpg');
	});

	test('followers: 非フォロワーは authorized:false + viewRestriction:followers (ID省略)、フォロワーは authorized:true (ID込み)', async () => {
		const set = await api('twitch/streams/update-archive-settings', { streamId, visibility: 'followers' }, broadcaster);
		assert.strictEqual(set.status, 200);
		assert.strictEqual((set.body as any).archiveViewVisibility, 'followers');

		const denied = await api('twitch/streams/show', { userId: broadcaster.id }, stranger);
		const deniedSession = archiveSession(denied);
		assert.strictEqual(deniedSession.authorized, false);
		assert.strictEqual(deniedSession.viewRestriction, 'followers');
		assert.strictEqual(deniedSession.youtubeVideoId, undefined);
		assert.strictEqual(deniedSession.recordingGoogleDriveFileId, undefined);
		assert.strictEqual(deniedSession.recordingGoogleDriveThumbnailLink, undefined);

		const allowed = await api('twitch/streams/show', { userId: broadcaster.id }, follower);
		const allowedSession = archiveSession(allowed);
		assert.strictEqual(allowedSession.authorized, true);
		assert.strictEqual(allowedSession.youtubeVideoId, 'ytvideo-show-01');
	});

	test('users: archiveVisibleUserIds に含まれるユーザーのみ authorized:true', async () => {
		const set = await api('twitch/streams/update-archive-settings', { streamId, visibility: 'users', visibleUserIds: [follower.id] }, broadcaster);
		assert.strictEqual(set.status, 200);
		assert.deepStrictEqual((set.body as any).archiveVisibleUserIds, [follower.id]);

		const denied = await api('twitch/streams/show', { userId: broadcaster.id }, stranger);
		const deniedSession = archiveSession(denied);
		assert.strictEqual(deniedSession.authorized, false);
		assert.strictEqual(deniedSession.viewRestriction, 'users');

		const allowed = await api('twitch/streams/show', { userId: broadcaster.id }, follower);
		const allowedSession = archiveSession(allowed);
		assert.strictEqual(allowedSession.authorized, true);
	});

	test('password: archiveViewToken 無しは authorized:false + viewRestriction:password', async () => {
		const set = await api('twitch/streams/update-archive-settings', { streamId, visibility: 'password', viewPassword: 'archiveshow-secret' }, broadcaster);
		assert.strictEqual(set.status, 200);

		const res = await api('twitch/streams/show', { userId: broadcaster.id });
		const session = archiveSession(res);
		assert.strictEqual(session.authorized, false);
		assert.strictEqual(session.viewRestriction, 'password');
	});

	test('owner は視聴制限モードに関わらず常に authorized:true', async () => {
		const res = await api('twitch/streams/show', { userId: broadcaster.id }, broadcaster);
		const session = archiveSession(res);
		assert.strictEqual(session.authorized, true);
		assert.strictEqual(session.youtubeVideoId, 'ytvideo-show-01');
	});
});

// verify-archive-view-password: password モード視聴制限のパスワード検証・視聴トークン発行 (bsky-fork 独自)。
describe('配信アーカイブ視聴制限: verify-archive-view-password', () => {
	let broadcaster: misskey.entities.SignupResponse;
	const pwStreamId = 'e2earchivepw01';
	const publicStreamId = 'e2earchivepwpub01';
	let issuedViewToken: string;

	beforeAll(async () => {
		broadcaster = await signup({ username: 'archpwbc' });

		const created = await api('live-channels/create', {}, broadcaster);
		assert.strictEqual(created.status, 200);

		const connection = await initTestDb(true);
		const streams = connection.getRepository(MiTwitchStream);
		await streams.save(new MiTwitchStream({
			id: pwStreamId,
			userId: broadcaster.id,
			twitchUserId: null,
			twitchStreamId: null,
			twitchLogin: null,
			source: 'ome',
			isLive: false,
			title: 'archive verify-password e2e test',
			viewerCount: 0,
			startedAt: new Date(Date.now() - 60 * 60 * 1000),
			endedAt: new Date(),
			recordingStatus: 'ready',
			recordingGoogleDriveFileId: 'drivefile-pw-01',
			youtubeUploadStatus: 'ready',
			youtubeVideoId: 'ytvideo-pw-01',
			archiveViewVisibility: 'password',
			archiveViewPassword: 'archive-pw-correct',
		}));
		await streams.save(new MiTwitchStream({
			id: publicStreamId,
			userId: broadcaster.id,
			twitchUserId: null,
			twitchStreamId: null,
			twitchLogin: null,
			source: 'ome',
			isLive: false,
			title: 'archive verify-password (public mode) e2e test',
			viewerCount: 0,
			startedAt: new Date(Date.now() - 60 * 60 * 1000),
			endedAt: new Date(),
			recordingStatus: 'ready',
			recordingGoogleDriveFileId: 'drivefile-pw-public-01',
			// archiveViewVisibility はデフォルト 'public' のまま (password モードではないアーカイブの代表として使う)
		}));
		await connection.destroy();
	}, 1000 * 60 * 2);

	test('正しいパスワードで viewToken が発行される', async () => {
		const res = await api('twitch/streams/verify-archive-view-password', { streamId: pwStreamId, password: 'archive-pw-correct' });
		assert.strictEqual(res.status, 200);
		issuedViewToken = (res.body as any).viewToken;
		assert.strictEqual(typeof issuedViewToken, 'string');
		assert.ok(issuedViewToken.length > 0);
	});

	test('誤ったパスワードは invalidPassword エラー', async () => {
		const res = await api('twitch/streams/verify-archive-view-password', { streamId: pwStreamId, password: 'wrong-password' });
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'INVALID_PASSWORD');
	});

	test('発行された viewToken を show の archiveViewToken に渡すと該当アーカイブが authorized:true になる', async () => {
		assert.strictEqual(typeof issuedViewToken, 'string');
		const res = await api('twitch/streams/show', { userId: broadcaster.id, archiveViewToken: issuedViewToken });
		assert.strictEqual(res.status, 200);
		const session = (res.body as any).sessions.find((s: any) => s.streamId === pwStreamId);
		assert.strictEqual(session.authorized, true);
		assert.strictEqual(session.recordingGoogleDriveFileId, 'drivefile-pw-01');
	});

	test('password モードでないアーカイブは noSuchArchive エラー', async () => {
		const res = await api('twitch/streams/verify-archive-view-password', { streamId: publicStreamId, password: 'anything' });
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_ARCHIVE');
	});

	test('存在しない streamId は noSuchArchive エラー', async () => {
		const res = await api('twitch/streams/verify-archive-view-password', { streamId: 'e2earchivenonexistent', password: 'anything' });
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_ARCHIVE');
	});
});

// update-archive-settings: オーナー限定の視聴制限個別上書き (bsky-fork 独自)。
describe('配信アーカイブ視聴制限: update-archive-settings', () => {
	let broadcaster: misskey.entities.SignupResponse;
	let stranger: misskey.entities.SignupResponse;
	const streamId = 'e2earchiveupd01';

	beforeAll(async () => {
		broadcaster = await signup({ username: 'archupdbc' });
		stranger = await signup({ username: 'archupdstranger' });

		const connection = await initTestDb(true);
		const streams = connection.getRepository(MiTwitchStream);
		await streams.save(new MiTwitchStream({
			id: streamId,
			userId: broadcaster.id,
			twitchUserId: null,
			twitchStreamId: null,
			twitchLogin: null,
			source: 'ome',
			isLive: false,
			title: 'archive update-settings e2e test',
			viewerCount: 0,
			startedAt: new Date(Date.now() - 60 * 60 * 1000),
			endedAt: new Date(),
			recordingStatus: 'ready',
			recordingGoogleDriveFileId: 'drivefile-upd-01',
		}));
		await connection.destroy();
	}, 1000 * 60 * 2);

	test('オーナーが visibility を変更でき、archive-history に反映される', async () => {
		const res = await api('twitch/streams/update-archive-settings', { streamId, visibility: 'followers' }, broadcaster);
		assert.strictEqual(res.status, 200);
		assert.strictEqual((res.body as any).archiveViewVisibility, 'followers');

		const history = await api('twitch/streams/archive-history', {}, broadcaster);
		assert.strictEqual(history.status, 200);
		const entry = (history.body as any[]).find(s => s.streamId === streamId);
		assert.ok(entry != null);
		assert.strictEqual(entry.archiveViewVisibility, 'followers');
	});

	test('非オーナーが呼ぶと noSuchArchive エラー (権限漏洩防止のため「存在しない」を返す)', async () => {
		const res = await api('twitch/streams/update-archive-settings', { streamId, visibility: 'public' }, stranger);
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_ARCHIVE');
	});
});

// unpublish-archive: オーナー限定・冪等な公開取り消し (bsky-fork 独自)。取り消し後は show.ts の
// 非オーナー一覧から除外され、オーナーには archiveUnpublished:true 付きで見え続けることも
// 合わせて確認する (LiveArchiveAccessService.canWatchArchive の archiveUnpublishedAt 分岐)。
describe('配信アーカイブ視聴制限: unpublish-archive', () => {
	let broadcaster: misskey.entities.SignupResponse;
	let stranger: misskey.entities.SignupResponse;
	const streamId = 'e2earchiveunpub01';

	beforeAll(async () => {
		broadcaster = await signup({ username: 'archunpubbc' });
		stranger = await signup({ username: 'archunpubstranger' });

		const created = await api('live-channels/create', {}, broadcaster);
		assert.strictEqual(created.status, 200);

		const connection = await initTestDb(true);
		const streams = connection.getRepository(MiTwitchStream);
		await streams.save(new MiTwitchStream({
			id: streamId,
			userId: broadcaster.id,
			twitchUserId: null,
			twitchStreamId: null,
			twitchLogin: null,
			source: 'ome',
			isLive: false,
			title: 'archive unpublish e2e test',
			viewerCount: 0,
			startedAt: new Date(Date.now() - 60 * 60 * 1000),
			endedAt: new Date(),
			recordingStatus: 'ready',
			recordingGoogleDriveFileId: 'drivefile-unpub-01',
			youtubeUploadStatus: 'ready',
			youtubeVideoId: 'ytvideo-unpub-01',
		}));
		await connection.destroy();
	}, 1000 * 60 * 2);

	async function readArchiveUnpublishedAt(): Promise<Date | null> {
		const connection = await initTestDb(true);
		const streams = connection.getRepository(MiTwitchStream);
		const stream = await streams.findOneByOrFail({ id: streamId });
		await connection.destroy();
		return stream.archiveUnpublishedAt;
	}

	test('呼ぶと archiveUnpublished:true になる', async () => {
		const res = await api('twitch/streams/unpublish-archive', { streamId }, broadcaster);
		assert.strictEqual(res.status, 200);
		assert.strictEqual((res.body as any).archiveUnpublished, true);
	});

	test('2回呼んでも冪等 (エラーにならず archiveUnpublishedAt が変わらない)', async () => {
		const before = await readArchiveUnpublishedAt();
		assert.ok(before != null);

		const res = await api('twitch/streams/unpublish-archive', { streamId }, broadcaster);
		assert.strictEqual(res.status, 200);
		assert.strictEqual((res.body as any).archiveUnpublished, true);

		const after = await readArchiveUnpublishedAt();
		assert.ok(after != null);
		assert.strictEqual(after.getTime(), before.getTime());
	});

	test('非オーナーが呼ぶと noSuchArchive エラー', async () => {
		const res = await api('twitch/streams/unpublish-archive', { streamId }, stranger);
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_ARCHIVE');
	});

	test('公開取り消し後は非オーナーの一覧から除外され、オーナーには archiveUnpublished:true 付きで見える', async () => {
		const asStranger = await api('twitch/streams/show', { userId: broadcaster.id }, stranger);
		assert.strictEqual(asStranger.status, 200);
		const strangerSession = (asStranger.body as any).sessions.find((s: any) => s.streamId === streamId);
		assert.strictEqual(strangerSession, undefined);

		const asOwner = await api('twitch/streams/show', { userId: broadcaster.id }, broadcaster);
		assert.strictEqual(asOwner.status, 200);
		const ownerSession = (asOwner.body as any).sessions.find((s: any) => s.streamId === streamId);
		assert.ok(ownerSession != null);
		assert.strictEqual(ownerSession.authorized, true);
		assert.strictEqual(ownerSession.archiveUnpublished, true);
	});
});

// comments.ts の視聴制限分岐 (bsky-fork 独自)。アーカイブ (source:'ome' && !isLive) にのみ
// canWatchArchive を適用し、ライブ配信中 (isLive:true) や source:'twitch' のセッションは
// archiveViewVisibility の値に関わらず常に無制限のままであることを回帰確認する
// (OBS オーバーレイ互換)。comments/create は isLive:false だと STREAM_ENDED になるため、
// コメントは isLive:true の間に投稿してから配信終了状態へ直接遷移させる (config.ome が
// テスト環境に無く markOmeStreamEnded を実際に発火できないための直接操作)。
describe('配信アーカイブ視聴制限: comments.ts の視聴制限分岐', () => {
	let broadcaster: misskey.entities.SignupResponse;
	let viewer: misskey.entities.SignupResponse;
	const passwordArchiveStreamId = 'e2earchivecomm01';
	const liveOmeStreamId = 'e2earchivecomm02';
	const endedTwitchStreamId = 'e2earchivecomm03';

	async function endStream(id: string, patch: Partial<MiTwitchStream>) {
		const connection = await initTestDb(true);
		const streams = connection.getRepository(MiTwitchStream);
		await streams.update(id, { isLive: false, endedAt: new Date(), ...patch });
		await connection.destroy();
	}

	beforeAll(async () => {
		broadcaster = await signup({ username: 'archcommbc' });
		viewer = await signup({ username: 'archcommviewer' });

		const connection = await initTestDb(true);
		const streams = connection.getRepository(MiTwitchStream);
		await streams.save(new MiTwitchStream({
			id: passwordArchiveStreamId,
			userId: broadcaster.id,
			twitchUserId: null,
			twitchStreamId: null,
			twitchLogin: null,
			source: 'ome',
			isLive: true,
			title: 'archive comments e2e test (password)',
			viewerCount: 0,
			startedAt: new Date(),
		}));
		await streams.save(new MiTwitchStream({
			id: liveOmeStreamId,
			userId: broadcaster.id,
			twitchUserId: null,
			twitchStreamId: null,
			twitchLogin: null,
			source: 'ome',
			isLive: true,
			title: 'archive comments e2e test (still live)',
			viewerCount: 0,
			startedAt: new Date(),
		}));
		await streams.save(new MiTwitchStream({
			id: endedTwitchStreamId,
			userId: broadcaster.id,
			twitchUserId: '900000099',
			twitchStreamId: 'e2e-archive-comm-tw-session',
			twitchLogin: 'archcommbctv',
			source: 'twitch',
			isLive: true,
			title: 'archive comments e2e test (twitch source)',
			viewerCount: 0,
			startedAt: new Date(),
		}));
		await connection.destroy();

		// 3セッションとも isLive:true の間にコメントを1件ずつ投稿しておく (comments/create は
		// isLive:false だと STREAM_ENDED になるため、投稿は必ず配信終了前に済ませる)。
		for (const id of [passwordArchiveStreamId, liveOmeStreamId, endedTwitchStreamId]) {
			const posted = await api('twitch/streams/comments/create', { streamId: id, text: `comment for ${id}` }, viewer);
			assert.strictEqual(posted.status, 200);
		}
	}, 1000 * 60 * 2);

	test('password で archiveViewToken 無しは ARCHIVE_RESTRICTED エラー', async () => {
		await endStream(passwordArchiveStreamId, { archiveViewVisibility: 'password', archiveViewPassword: 'comments-secret' });

		const res = await api('twitch/streams/comments', { streamId: passwordArchiveStreamId });
		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body as any).error.code, 'ARCHIVE_RESTRICTED');
	});

	test('正しい archiveViewToken があればコメント取得できる', async () => {
		const verified = await api('twitch/streams/verify-archive-view-password', { streamId: passwordArchiveStreamId, password: 'comments-secret' });
		assert.strictEqual(verified.status, 200);
		const viewToken = (verified.body as any).viewToken;

		const res = await api('twitch/streams/comments', { streamId: passwordArchiveStreamId, archiveViewToken: viewToken });
		assert.strictEqual(res.status, 200);
		const comments = res.body as any[];
		assert.strictEqual(comments.length, 1);
		assert.strictEqual(comments[0].text, `comment for ${passwordArchiveStreamId}`);
	});

	test('重要な回帰テスト: ライブ配信中 (isLive:true) は archiveViewVisibility が password でも常に無制限で取得できる (OBSオーバーレイ互換)', async () => {
		// isLive:true のまま (endStream は呼ばない) archiveViewVisibility だけ password へ直接書き換える。
		// 本来このスナップショットは配信終了時にしか発生しないが、comments.ts の isLive ガード自体を
		// 狙って検証するための状態遷移。
		const connection = await initTestDb(true);
		const streams = connection.getRepository(MiTwitchStream);
		await streams.update(liveOmeStreamId, { archiveViewVisibility: 'password', archiveViewPassword: 'irrelevant-while-live' });
		await connection.destroy();

		const res = await api('twitch/streams/comments', { streamId: liveOmeStreamId });
		assert.strictEqual(res.status, 200);
		const comments = res.body as any[];
		assert.strictEqual(comments.length, 1);
		assert.strictEqual(comments[0].text, `comment for ${liveOmeStreamId}`);
	});

	test('重要な回帰テスト: source:\'twitch\' のセッションは配信終了済みでも常に無制限で取得できる', async () => {
		await endStream(endedTwitchStreamId, { archiveViewVisibility: 'password', archiveViewPassword: 'irrelevant-for-twitch-source' });

		const res = await api('twitch/streams/comments', { streamId: endedTwitchStreamId });
		assert.strictEqual(res.status, 200);
		const comments = res.body as any[];
		assert.strictEqual(comments.length, 1);
		assert.strictEqual(comments[0].text, `comment for ${endedTwitchStreamId}`);
	});
});
