/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import type { UsersRepository } from '@/models/_.js';
import { ApResolverService } from '@/core/activitypub/ApResolverService.js';
import { ApNoteService } from '@/core/activitypub/models/ApNoteService.js';
import { isActor, isCreate, isPost, getApId, getOneApId } from '@/core/activitypub/type.js';
import type { IObject } from '@/core/activitypub/type.js';
import { UtilityService } from '@/core/UtilityService.js';

/** Bounded, best-effort backfill of public profile posts. */
@Injectable()
export class RemoteUserNotesService {
	private readonly pending = new Map<string, Promise<void>>();

	constructor(
		@Inject(DI.redis) private redisClient: Redis.Redis,
		@Inject(DI.usersRepository) private usersRepository: UsersRepository,
		private apResolverService: ApResolverService,
		private apNoteService: ApNoteService,
		private utilityService: UtilityService,
	) {}

	public async fetch(userId: string): Promise<void> {
		let pending = this.pending.get(userId);
		if (!pending) {
			// Bound concurrent remote work even when many profiles are visited at once.
			if (this.pending.size >= 4) return;
			pending = this.backfill(userId).catch(() => {}).finally(() => this.pending.delete(userId));
			this.pending.set(userId, pending);
		}
		// An unavailable remote must not prevent reading already received posts.
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([pending, new Promise<void>(resolve => {
				timer = setTimeout(resolve, 3000);
			})]);
		} finally {
			clearTimeout(timer);
		}
	}

	private async backfill(userId: string): Promise<void> {
		const user = await this.usersRepository.findOneBy({ id: userId });
		if (!user?.host || !user.uri || user.isSuspended || !this.utilityService.isFederationAllowedUri(user.uri)) return;
		// Shared across workers; failures are also cached to avoid hammering small servers.
		if (!await this.redisClient.set(`remoteUserNotes:${user.id}`, '1', 'EX', 600, 'NX')) return;

		const resolver = await this.apResolverService.createResolver();
		const actor = await resolver.resolve(user.uri);
		if (!isActor(actor) || actor.id !== user.uri || !actor.outbox) return;
		const collection = await resolver.resolveCollection(actor.outbox);
		const page = collection.first ? await resolver.resolve(collection.first) : collection;
		const items = (page as IObject & { orderedItems?: unknown; items?: unknown }).orderedItems
			?? (page as IObject & { items?: unknown }).items;
		if (!Array.isArray(items)) return;

		const deadline = Date.now() + 30_000;
		for (const item of items.slice(0, 20)) {
			if (Date.now() > deadline) break;
			try {
				if (typeof item !== 'string' && (!item || typeof item !== 'object')) continue;
				const activity = await resolver.resolve(item);
				const object = isCreate(activity) ? await resolver.resolve(getApId(activity.object)) : activity;
				if (!isPost(object) || !object.id || !object.attributedTo || getOneApId(object.attributedTo) !== user.uri) continue;
				const audience = [...(Array.isArray(object.to) ? object.to : [object.to]), ...(Array.isArray(object.cc) ? object.cc : [object.cc])];
				if (!audience.includes('https://www.w3.org/ns/activitystreams#Public')) continue;
				// Resolve by URI with a fresh resolver: never trust embedded outbox objects.
				// resolveNote preserves validation, deduplication and silent historical import.
				await this.apNoteService.resolveNote(object.id);
			} catch {
				// One deleted or unsupported entry must not discard the rest of the page.
			}
		}
	}
}
