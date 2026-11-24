/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { RemoteUserNotesService } from '@/core/RemoteUserNotesService.js';

const uri = 'https://remote.example/users/alice';
const publicAudience = 'https://www.w3.org/ns/activitystreams#Public';
function fixture(items: unknown[] = []) {
	const user = { id: 'alice', host: 'remote.example', uri, isSuspended: false };
	const redis = { set: vi.fn().mockResolvedValue('OK') };
	const users = { findOneBy: vi.fn().mockResolvedValue(user) };
	const objects = new Map<string, unknown>([[uri, { id: uri, type: 'Person', outbox: `${uri}/outbox` }]]);
	const resolver = {
		resolve: vi.fn(async (value: unknown) => typeof value === 'string' ? objects.get(value) : value),
		resolveCollection: vi.fn().mockResolvedValue({ type: 'OrderedCollection', orderedItems: items }),
	};
	const apResolver = { createResolver: vi.fn().mockResolvedValue(resolver) };
	const notes = { resolveNote: vi.fn().mockResolvedValue(null) };
	const utility = { isFederationAllowedUri: vi.fn().mockReturnValue(true) };
	const args = [redis, users, apResolver, notes, utility] as unknown as ConstructorParameters<typeof RemoteUserNotesService>;
	return { service: new RemoteUserNotesService(...args), redis, users, objects, resolver, notes, utility, user };
}
function post(id = '1', overrides = {}) {
	return { type: 'Note', id: `https://remote.example/notes/${id}`, attributedTo: uri, to: [publicAudience], ...overrides };
}

afterEach(() => vi.useRealTimers());

describe('RemoteUserNotesService', () => {
	test('imports public posts by URI, skipping private posts and other authors', async () => {
		const f = fixture([post(), post('2', { to: [uri] }), post('3', { attributedTo: 'https://other.example/user' })]);
		await f.service.fetch('alice');
		expect(f.notes.resolveNote.mock.calls).toEqual([[post().id]]);
	});

	test('reads a first page and dereferences Create objects', async () => {
		const f = fixture();
		f.resolver.resolveCollection.mockResolvedValue({ type: 'OrderedCollection', first: 'https://remote.example/page' } as never);
		f.objects.set('https://remote.example/page', { type: 'OrderedCollectionPage', orderedItems: [{ type: 'Create', object: post() }] });
		f.objects.set(post().id, post());
		await f.service.fetch('alice');
		expect(f.notes.resolveNote).toHaveBeenCalledWith(post().id);
	});

	test('caps entries and continues after a deleted post', async () => {
		const f = fixture(Array.from({ length: 30 }, (_, i) => post(String(i))));
		f.notes.resolveNote.mockRejectedValueOnce(new Error('deleted'));
		await f.service.fetch('alice');
		expect(f.notes.resolveNote).toHaveBeenCalledTimes(20);
	});

	test('does not contact local, suspended or blocked users', async () => {
		for (const override of [{ host: null }, { isSuspended: true }]) {
			const f = fixture([post()]);
			f.users.findOneBy.mockResolvedValue({ ...f.user, ...override });
			await f.service.fetch('alice');
			expect(f.resolver.resolve).not.toHaveBeenCalled();
		}
		const f = fixture();
		f.utility.isFederationAllowedUri.mockReturnValue(false);
		await f.service.fetch('alice');
		expect(f.resolver.resolve).not.toHaveBeenCalled();
	});

	test('honors the shared cooldown and fails open on remote errors', async () => {
		const f = fixture();
		f.redis.set.mockResolvedValue(null);
		await f.service.fetch('alice');
		expect(f.resolver.resolve).not.toHaveBeenCalled();
		f.redis.set.mockResolvedValue('OK');
		f.resolver.resolve.mockRejectedValue(new Error('offline'));
		await expect(f.service.fetch('alice')).resolves.toBeUndefined();
	});

	test('coalesces requests and stops waiting after three seconds', async () => {
		vi.useFakeTimers();
		const f = fixture();
		let finish!: (value: never) => void;
		f.resolver.resolve.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
		const requests = [f.service.fetch('alice'), f.service.fetch('alice')];
		await vi.advanceTimersByTimeAsync(3000);
		await Promise.all(requests);
		expect(f.resolver.resolve).toHaveBeenCalledTimes(1);
		finish({ type: 'Person', id: 'wrong' } as never);
	});
});
