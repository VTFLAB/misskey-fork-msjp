/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { AtpNoteService } from '@/core/atproto/AtpNoteService.js';
import { AtpPersonService } from '@/core/atproto/AtpPersonService.js';
import { AtpLoggerService } from '@/core/atproto/AtpLoggerService.js';

export const meta = {
	tags: ['atproto'],

	requireCredential: true,
	kind: 'write:account',

	description: 'Bluesky pseudo-user の直近 N 日分の post を AppView (getAuthorFeed) から取り込む。既存 note は uri 重複で skip される。新規 follow 時は /api/atproto/follow が自動で呼ぶので、これは既存 follow 済アカウントを後から取り込むときや、cutoff を伸ばしたいときに使う。長時間 (~数分) かかる場合があるので背景実行に向く。',

	limit: {
		duration: 60 * 1000,
		max: 10,
	},

	errors: {
		invalidDid: {
			message: 'did must look like did:plc:... or did:web:...',
			code: 'INVALID_DID',
			id: '9d6fdb20-f88a-4cb5-85b2-06a56128acd0',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			did: { type: 'string', optional: false, nullable: false },
			scanned: { type: 'number', optional: false, nullable: false },
			ingested: { type: 'number', optional: false, nullable: false },
			pagesRequested: { type: 'number', optional: false, nullable: false },
			reachedCutoff: { type: 'boolean', optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		did: { type: 'string', minLength: 5, maxLength: 256 },
		days: { type: 'integer', minimum: 1, maximum: 365, default: 30 },
	},
	required: ['did'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private atpNoteService: AtpNoteService,
		private atpPersonService: AtpPersonService,
		atpLoggerService: AtpLoggerService,
	) {
		const logger = atpLoggerService.child('api/backfill');
		super(meta, paramDef, async (ps, me) => {
			if (!ps.did.startsWith('did:plc:') && !ps.did.startsWith('did:web:')) {
				throw new ApiError(meta.errors.invalidDid);
			}

			logger.info(`/api/atproto/backfill enter: me=${me.id} did=${ps.did} days=${ps.days}`);

			// avatar/banner の取り込みも兼ねて profile を強制再取得。
			await this.atpPersonService.resolveByDid(ps.did, { forceRefresh: true }).catch(err => {
				logger.warn(`force refresh failed (continuing to backfill): ${err instanceof Error ? err.message : String(err)}`);
			});

			const cutoffMs = ps.days * 24 * 60 * 60 * 1000;
			const result = await this.atpNoteService.backfillAuthorFeed(ps.did, { cutoffMs });

			return {
				did: ps.did,
				scanned: result.scanned,
				ingested: result.ingested,
				pagesRequested: result.pagesRequested,
				reachedCutoff: result.reachedCutoff,
			};
		});
	}
}
