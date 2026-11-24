/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import type { MiUser } from '@/models/User.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { UtilityService } from '@/core/UtilityService.js';
import { ApResolverService } from '@/core/activitypub/ApResolverService.js';
import { isActor } from '@/core/activitypub/type.js';

export type RemoteUserProfile = {
	followersCount?: number;
	followingCount?: number;
	notesCount?: number;
	createdAt?: string;
};

type RemoteUser = Pick<MiUser, 'id' | 'uri' | 'host' | 'username' | 'isSuspended'>;

/** Public display statistics only; never overwrite federation relationship counters. */
@Injectable()
export class RemoteUserProfileService {
	private readonly pending = new Map<string, Promise<RemoteUserProfile | null>>();

	constructor(
		@Inject(DI.redis) private redisClient: Redis.Redis,
		private httpRequestService: HttpRequestService,
		private utilityService: UtilityService,
		private apResolverService: ApResolverService,
	) {}

	public async get(user: RemoteUser): Promise<RemoteUserProfile | null> {
		if (!user.host || !user.uri || user.isSuspended) return null;
		try {
			const uri = new URL(user.uri);
			if (uri.protocol !== 'https:' || uri.username || uri.password || uri.port
				|| !this.utilityService.isFederationAllowedUri(user.uri)
				|| this.utilityService.isSelfHost(uri.hostname)) return null;
			const key = `remoteUserProfile:${user.id}`;
			const cached = await this.redisClient.get(key);
			if (cached) return JSON.parse(cached) as RemoteUserProfile;
			const pending = this.pending.get(user.id);
			if (pending) return await this.wait(pending);
			if (this.pending.size >= 8) return null;
			const task = (async () => {
				// Share a retry cooldown across processes, including failed requests.
				if (!await this.redisClient.set(`${key}:fetch`, '1', 'EX', 60, 'NX')) return null;
				const result = await this.fetch(user, uri);
				await this.redisClient.set(key, JSON.stringify(result), 'EX', 600);
				return result;
			})().catch(() => null).finally(() => this.pending.delete(user.id));
			this.pending.set(user.id, task);
			return await this.wait(task);
		} catch {
			return null;
		}
	}

	private async wait(task: Promise<RemoteUserProfile | null>): Promise<RemoteUserProfile | null> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([task, new Promise<null>(resolve => {
				timer = setTimeout(() => resolve(null), 6000);
			})]);
		} finally {
			clearTimeout(timer);
		}
	}

	private async fetch(user: RemoteUser, uri: URL): Promise<RemoteUserProfile> {
		// Mastodon/Fedibird expose totals even when relationship lists are hidden.
		const mastodon = uri.pathname === `/users/${user.username}`;
		try {
			const response = await this.httpRequestService.send(mastodon
				? `${uri.origin}/api/v1/accounts/lookup?acct=${encodeURIComponent(user.username)}`
				: `${uri.origin}/api/users/show`, {
				method: mastodon ? 'GET' : 'POST',
				headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
				...(mastodon ? {} : { body: JSON.stringify({ username: user.username, host: null }) }),
				timeout: 5000,
				size: 1024 * 1024,
			});
			const data = await response.json() as Record<string, unknown>;
			if (typeof data.username !== 'string' || data.username.toLowerCase() !== user.username.toLowerCase()) throw new Error('Account mismatch');
			if (mastodon) {
				if (typeof data.acct !== 'string' || ![user.username.toLowerCase(), `${user.username}@${uri.hostname}`.toLowerCase()].includes(data.acct.toLowerCase())) throw new Error('Remote account alias');
				if (typeof data.url !== 'string' || new URL(data.url).origin !== uri.origin) throw new Error('Account origin mismatch');
			} else if (data.host != null) {
				throw new Error('Not an origin account');
			}
			const profile = this.parseCounts(data, mastodon);
			if (Object.keys(profile).length > 0) return profile;
		} catch {
			// Other ActivityPub software may not offer either public REST API.
		}

		const resolver = await this.apResolverService.createResolver();
		const actor = await resolver.resolve(uri.href);
		if (!isActor(actor) || actor.id !== user.uri) return {};
		const result: RemoteUserProfile = {};
		const date = this.date(actor.published);
		if (date) result.createdAt = date;
		await Promise.all((['followers', 'following', 'outbox'] as const).map(async name => {
			try {
				const collection = actor[name];
				if (!collection) return;
				// Separate resolvers allow servers to reuse collection URLs.
				const collectionResolver = await this.apResolverService.createResolver();
				const count = this.count((await collectionResolver.resolveCollection(collection)).totalItems);
				if (count !== undefined) result[name === 'outbox' ? 'notesCount' : name === 'followers' ? 'followersCount' : 'followingCount'] = count;
			} catch {
				// A hidden collection is not a zero count; retain the local fallback.
			}
		}));
		return result;
	}

	private parseCounts(data: Record<string, unknown>, mastodon: boolean): RemoteUserProfile {
		const result: RemoteUserProfile = {};
		for (const [key, remoteKey] of [
			['followersCount', 'followers_count'],
			['followingCount', 'following_count'],
			['notesCount', 'statuses_count'],
		] as const) {
			if (!mastodon && key !== 'notesCount') {
				const visibility = data[key === 'followersCount' ? 'followersVisibility' : 'followingVisibility'];
				if (visibility != null && visibility !== 'public') continue;
			}
			const count = this.count(data[mastodon ? remoteKey : key]);
			if (count !== undefined) result[key] = count;
		}
		const date = this.date(data[mastodon ? 'created_at' : 'createdAt']);
		if (date) result.createdAt = date;
		return result;
	}

	private count(value: unknown): number | undefined {
		return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
	}

	private date(value: unknown): string | undefined {
		if (typeof value !== 'string') return undefined;
		const time = Date.parse(value);
		return Number.isFinite(time) && time > 0 && time <= Date.now() ? new Date(time).toISOString() : undefined;
	}
}
