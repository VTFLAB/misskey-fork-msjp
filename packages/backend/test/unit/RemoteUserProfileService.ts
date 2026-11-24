/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { RemoteUserProfileService } from '@/core/RemoteUserProfileService.js';
import UsersShow from '@/server/api/endpoints/users/show.js';

function fixture(mastodon = true) {
	const user = { id: 'alice', uri: mastodon ? 'https://remote.example/users/alice' : 'https://remote.example/users/abc123', host: 'remote.example', username: 'alice', isSuspended: false };
	const data = mastodon
		? { username: 'alice', acct: 'alice', url: 'https://remote.example/@alice', followers_count: 139, following_count: 149, statuses_count: 32087, created_at: '2022-11-09T00:00:00Z' }
		: { username: 'alice', host: null, followersCount: 139, followingCount: 149, notesCount: 32087, createdAt: '2022-11-09T00:00:00Z' };
	const redis = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK') };
	const http = { send: vi.fn().mockResolvedValue({ json: async () => data }) };
	const utility = { isSelfHost: vi.fn().mockReturnValue(false), isFederationAllowedUri: vi.fn().mockReturnValue(true) };
	const resolver = { resolve: vi.fn().mockRejectedValue(new Error('unsupported')), resolveCollection: vi.fn() };
	const ap = { createResolver: vi.fn().mockResolvedValue(resolver) };
	const args = [redis, http, utility, ap] as unknown as ConstructorParameters<typeof RemoteUserProfileService>;
	return { service: new RemoteUserProfileService(...args), user, data, redis, http, utility, resolver };
}

afterEach(() => vi.useRealTimers());

describe('remote profile display information', () => {
	test.each([true, false])('fetches origin counts and registration date (Mastodon=%s)', async mastodon => {
		const f = fixture(mastodon);
		expect(await f.service.get(f.user)).toEqual({ followersCount: 139, followingCount: 149, notesCount: 32087, createdAt: '2022-11-09T00:00:00.000Z' });
		expect(f.http.send.mock.calls[0][1].method).toBe(mastodon ? 'GET' : 'POST');
	});

	test('does not present Misskey hidden-count placeholders as public totals', async () => {
		const f = fixture(false);
		f.http.send.mockResolvedValue({ json: async () => ({ ...f.data, followersVisibility: 'private', followersCount: 0 }) });
		const result = await f.service.get(f.user);
		expect(result?.followersCount).toBeUndefined();
		expect(result?.followingCount).toBe(149);
	});

	test('uses cached counts and avoids local, suspended and blocked users', async () => {
		const f = fixture();
		f.redis.get.mockResolvedValue(JSON.stringify({ followersCount: 0 }));
		expect(await f.service.get(f.user)).toEqual({ followersCount: 0 });
		await f.service.get({ ...f.user, host: null });
		await f.service.get({ ...f.user, isSuspended: true });
		f.utility.isFederationAllowedUri.mockReturnValue(false);
		await f.service.get(f.user);
		expect(f.http.send).not.toHaveBeenCalled();
	});

	test('rejects a different account and invalid numeric values', async () => {
		const f = fixture();
		f.http.send.mockResolvedValue({ json: async () => ({ ...f.data, acct: 'alice@other.example' }) });
		expect(await f.service.get(f.user)).toBeNull();
		f.http.send.mockResolvedValue({ json: async () => ({ ...f.data, followers_count: -1, following_count: '149', statuses_count: 0, created_at: 'invalid' }) });
		expect(await f.service.get(f.user)).toEqual({ notesCount: 0 });
	});

	test('falls back to public ActivityPub totals without treating a hidden collection as zero', async () => {
		const f = fixture();
		f.http.send.mockRejectedValue(new Error('unsupported'));
		f.resolver.resolve.mockResolvedValue({ type: 'Person', id: f.user.uri, followers: 'https://remote.example/followers', following: 'https://remote.example/following', outbox: 'https://remote.example/outbox' });
		f.resolver.resolveCollection.mockImplementation(async url => {
			if (url.endsWith('/following')) throw new Error('private');
			return { totalItems: url.endsWith('/followers') ? 139 : 32087 };
		});
		expect(await f.service.get(f.user)).toEqual({ followersCount: 139, notesCount: 32087 });
	});

	test('coalesces requests and limits waiting for an unavailable server', async () => {
		vi.useFakeTimers();
		const f = fixture();
		f.http.send.mockImplementation(() => new Promise(() => {}));
		const calls = [f.service.get(f.user), f.service.get(f.user)];
		await vi.advanceTimersByTimeAsync(6000);
		expect(await Promise.all(calls)).toEqual([null, null]);
		expect(f.http.send).toHaveBeenCalledTimes(1);
	});

	test('users/show returns remote display counts without modifying stored federation counters', async () => {
		const f = fixture();
		const user = { ...f.user, followersCount: 1, followingCount: 1, notesCount: 3068 };
		const packed = { ...user, followersVisibility: 'public', followingVisibility: 'private', createdAt: '2026-05-04T00:00:00Z' };
		const args = [
			{}, { findOneBy: vi.fn().mockResolvedValue(user) }, { pack: vi.fn().mockResolvedValue(packed) }, {}, f.service,
			{ isModerator: vi.fn().mockResolvedValue(false) }, {}, {},
		] as unknown as ConstructorParameters<typeof UsersShow>;
		const result = await new UsersShow(...args).exec({ userId: 'alice' }, null, null);
		expect(result.followersCount).toBe(139);
		expect(result.remoteProfile.followingCount).toBe(149);
		expect(result.followingVisibility).toBe('private');
		expect(result.followingCount).toBe(1); // Preserve the existing visibility decision.
		expect(result.notesCount).toBe(32087);
		expect(result.createdAt).toBe('2022-11-09T00:00:00.000Z');
		expect(user.followersCount).toBe(1);
		expect(user.notesCount).toBe(3068);
	});
});
