/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { AtpPersonService } from '@/core/atproto/AtpPersonService.js';
import { AtpJetstreamService } from '@/core/atproto/AtpJetstreamService.js';
import { AtpLoggerService } from '@/core/atproto/AtpLoggerService.js';
import { AtpNoteService } from '@/core/atproto/AtpNoteService.js';
import { UserFollowingService } from '@/core/UserFollowingService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';

export const meta = {
	tags: ['atproto', 'following'],

	requireCredential: true,
	kind: 'write:following',

	description: 'Bluesky DID で識別される pseudo-user を upsert し follow する。新規 follow 完了後、Jetstream subscription を即時 refresh する。',

	limit: {
		duration: 60 * 1000,
		max: 30,
	},

	errors: {
		invalidDid: {
			message: 'did must look like did:plc:... or did:web:...',
			code: 'INVALID_DID',
			id: 'a7e222ec-a71c-4079-9e4d-0ed24d17f275',
		},
		appviewUnavailable: {
			message: 'Bluesky AppView is unavailable while resolving DID.',
			code: 'APPVIEW_UNAVAILABLE',
			id: '914e7b96-f1fd-498e-8e44-fe2fd0a6effe',
		},
		alreadyFollowing: {
			message: 'You are already following this Bluesky account.',
			code: 'ALREADY_FOLLOWING',
			id: '6ed26322-3581-436d-9bd9-13e8656517df',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'UserDetailedNotMe',
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		did: { type: 'string', minLength: 5, maxLength: 256 },
	},
	required: ['did'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private atpPersonService: AtpPersonService,
		private atpJetstreamService: AtpJetstreamService,
		private atpNoteService: AtpNoteService,
		atpLoggerService: AtpLoggerService,
		private userFollowingService: UserFollowingService,
		private userEntityService: UserEntityService,
	) {
		const logger = atpLoggerService.child('api/follow');
		super(meta, paramDef, async (ps, me) => {
			logger.info(`/api/atproto/follow enter: me=${me.id} did=${ps.did}`);

			if (!ps.did.startsWith('did:plc:') && !ps.did.startsWith('did:web:')) {
				throw new ApiError(meta.errors.invalidDid);
			}

			const pseudoUser = await this.atpPersonService.resolveByDid(ps.did).catch(err => {
				logger.error(`resolveByDid failed: did=${ps.did} err=${err instanceof Error ? err.message : String(err)}`);
				throw new ApiError(meta.errors.appviewUnavailable, { reason: err instanceof Error ? err.message : String(err) });
			});

			let isNewFollow = false;
			try {
				await this.userFollowingService.follow(me, pseudoUser);
				isNewFollow = true;
				logger.info(`follow ok: me=${me.id} → userId=${pseudoUser.id} (@${pseudoUser.username})`);
			} catch (e) {
				if (e instanceof IdentifiableError && e.id === 'ec3f65c0-a9d1-47d9-8791-b2e7b9dcdced') {
					logger.info(`already following: me=${me.id} → userId=${pseudoUser.id}`);
					throw new ApiError(meta.errors.alreadyFollowing);
				}
				throw e;
			}

			// 新規 DID は Jetstream の wantedDids に加える。次の subscription refresh で反映。
			this.atpJetstreamService.refreshSubscription().catch(err => {
				logger.warn(`refreshSubscription failed (will retry next tick): ${err instanceof Error ? err.message : String(err)}`);
			});

			// 新規 follow なら直近 30 日分の post を backfill (background)。API は待たない。
			// 既存 follow 時は alreadyFollowing で throw 済なのでここには来ない。
			if (isNewFollow) {
				this.atpNoteService.backfillAuthorFeed(ps.did).catch(err => {
					logger.warn(`backfill failed: did=${ps.did} err=${err instanceof Error ? err.message : String(err)}`);
				});
			}

			return await this.userEntityService.pack(pseudoUser.id, me, { schema: 'UserDetailedNotMe' });
		});
	}
}
