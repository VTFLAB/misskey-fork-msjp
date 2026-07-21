/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import type { TwitchStreamsRepository } from '@/models/_.js';
import { LiveArchiveAccessService } from '@/core/live/LiveArchiveAccessService.js';

export const meta = {
	tags: ['twitch'],

	requireCredential: false,

	description: 'password モードの視聴制限がある配信アーカイブのパスワードを検証し、成功時に視聴トークンを発行する。' +
		'匿名視聴者もパスワードで視聴可能にするため認証不要。',

	limit: {
		duration: 1000 * 60 * 60,
		max: 10,
	},

	errors: {
		noSuchArchive: {
			message: 'No such password-restricted archive.',
			code: 'NO_SUCH_ARCHIVE',
			id: '72d764b5-e89f-4853-944b-66a1e8d38843',
		},
		invalidPassword: {
			message: 'Invalid password.',
			code: 'INVALID_PASSWORD',
			id: '0779885d-62eb-4484-875e-354fb4a95566',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			viewToken: { type: 'string', optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		streamId: { type: 'string', format: 'misskey:id' },
		password: { type: 'string', minLength: 1, maxLength: 128 },
	},
	required: ['streamId', 'password'],
} as const;

// OmeServerService.verifySignature / live-channels/verify-view-password.ts と同型のタイミング差を作らない比較。
// 共通化はしない (bsky-fork の既存踏襲パターン)。
function timingSafeEqualStrings(a: string, b: string): boolean {
	const aBuf = Buffer.from(a, 'utf8');
	const bBuf = Buffer.from(b, 'utf8');
	if (aBuf.length !== bBuf.length) return false;
	return timingSafeEqual(aBuf, bBuf);
}

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.twitchStreamsRepository)
		private twitchStreamsRepository: TwitchStreamsRepository,

		private liveArchiveAccessService: LiveArchiveAccessService,
	) {
		super(meta, paramDef, async (ps) => {
			const stream = await this.twitchStreamsRepository.findOneBy({ id: ps.streamId });
			if (
				stream == null ||
				stream.source !== 'ome' ||
				stream.isLive ||
				stream.archiveUnpublishedAt != null ||
				stream.archiveViewVisibility !== 'password' ||
				stream.archiveViewPassword == null
			) {
				throw new ApiError(meta.errors.noSuchArchive);
			}

			if (!timingSafeEqualStrings(stream.archiveViewPassword, ps.password)) {
				throw new ApiError(meta.errors.invalidPassword);
			}

			const viewToken = await this.liveArchiveAccessService.issueArchiveViewToken(stream.id);
			return { viewToken };
		});
	}
}
