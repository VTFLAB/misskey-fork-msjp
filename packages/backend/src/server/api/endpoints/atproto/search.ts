/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import type { FollowingsRepository, UsersRepository } from '@/models/_.js';
import { AtpSearchService } from '@/core/atproto/AtpSearchService.js';

export const meta = {
	tags: ['atproto', 'users'],

	requireCredential: true,
	kind: 'read:account',

	description: 'Bluesky の actor を AppView 検索する (匿名アクセス、自前 PDS を持たない)。各結果には、現在のユーザーが該当 Bluesky pseudo-user を既に follow しているかが付く。',

	limit: {
		duration: 60 * 1000,
		max: 60,
	},

	errors: {
		emptyQuery: {
			message: 'q must be a non-empty string.',
			code: 'EMPTY_QUERY',
			id: '7159a115-f536-4a3b-828b-05f1ec8d51eb',
		},
		appviewUnavailable: {
			message: 'Bluesky AppView is unavailable.',
			code: 'APPVIEW_UNAVAILABLE',
			id: 'df128dc5-42df-461c-ad88-30e233b9639a',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			actors: {
				type: 'array',
				optional: false, nullable: false,
				items: {
					type: 'object',
					optional: false, nullable: false,
					properties: {
						did: { type: 'string', optional: false, nullable: false },
						handle: { type: 'string', optional: false, nullable: false },
						displayName: { type: 'string', optional: false, nullable: true },
						description: { type: 'string', optional: false, nullable: true },
						avatar: { type: 'string', optional: false, nullable: true },
						indexedAt: { type: 'string', optional: false, nullable: true },
						isFollowedByMe: { type: 'boolean', optional: false, nullable: false },
					},
				},
			},
			cursor: { type: 'string', optional: false, nullable: true },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		q: { type: 'string', minLength: 1, maxLength: 256 },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
		cursor: { type: 'string', nullable: true },
	},
	required: ['q'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.followingsRepository)
		private followingsRepository: FollowingsRepository,

		private atpSearchService: AtpSearchService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const q = ps.q.trim();
			if (q.length === 0) throw new ApiError(meta.errors.emptyQuery);

			const result = await this.atpSearchService.searchActors(q, {
				limit: ps.limit,
				cursor: ps.cursor ?? undefined,
			}).catch(err => {
				throw new ApiError(meta.errors.appviewUnavailable, { reason: err instanceof Error ? err.message : String(err) });
			});

			const dids = result.actors.map(a => a.did);
			const followedDids = await this.lookupFollowedDids(me.id, dids);

			return {
				actors: result.actors.map(a => ({
					did: a.did,
					handle: a.handle,
					displayName: a.displayName ?? null,
					description: a.description ?? null,
					avatar: a.avatar ?? null,
					indexedAt: a.indexedAt ?? null,
					isFollowedByMe: followedDids.has(a.did),
				})),
				cursor: result.cursor,
			};
		});
	}

	private async lookupFollowedDids(meId: string, dids: string[]): Promise<Set<string>> {
		if (dids.length === 0) return new Set();

		// 1. DID から local pseudo-user の id を引く
		const users = await this.usersRepository.find({
			where: { atDid: In(dids) },
			select: { id: true, atDid: true },
		});
		if (users.length === 0) return new Set();

		const userIdToDid = new Map(users.map(u => [u.id, u.atDid as string]));

		// 2. 自分が followee として持つものを bulk 検索
		const followings = await this.followingsRepository.find({
			where: {
				followerId: meId,
				followeeId: In(users.map(u => u.id)),
			},
			select: { followeeId: true },
		});

		const result = new Set<string>();
		for (const f of followings) {
			const did = userIdToDid.get(f.followeeId);
			if (did != null) result.add(did);
		}
		return result;
	}
}
