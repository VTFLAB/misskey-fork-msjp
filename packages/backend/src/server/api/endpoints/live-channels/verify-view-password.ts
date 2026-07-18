/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { LiveChannelService } from '@/core/live/LiveChannelService.js';

export const meta = {
	tags: ['live-channel'],

	requireCredential: false,

	description: 'password モードの視聴制限があるライブチャンネルのパスワードを検証し、成功時に視聴トークンを発行する。' +
		'匿名視聴者もパスワードで視聴可能にするため認証不要。',

	limit: {
		duration: 1000 * 60 * 60,
		max: 10,
	},

	errors: {
		noSuchChannel: {
			message: 'The user has no password-restricted live channel.',
			code: 'NO_SUCH_CHANNEL',
			id: '9c08821e-6b58-4a41-9645-fa6d2dd6118a',
		},
		invalidPassword: {
			message: 'Invalid password.',
			code: 'INVALID_PASSWORD',
			id: '11c44ceb-7249-4f51-b222-fa5cc9c33a58',
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
		userId: { type: 'string', format: 'misskey:id' },
		password: { type: 'string', minLength: 1, maxLength: 128 },
	},
	required: ['userId', 'password'],
} as const;

// OmeServerService.verifySignature と同型のタイミング差を作らない比較。
function timingSafeEqualStrings(a: string, b: string): boolean {
	const aBuf = Buffer.from(a, 'utf8');
	const bBuf = Buffer.from(b, 'utf8');
	if (aBuf.length !== bBuf.length) return false;
	return timingSafeEqual(aBuf, bBuf);
}

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private liveChannelService: LiveChannelService,
	) {
		super(meta, paramDef, async (ps) => {
			const channel = await this.liveChannelService.show(ps.userId);
			if (channel == null || channel.visibility !== 'password' || channel.viewPassword == null) {
				throw new ApiError(meta.errors.noSuchChannel);
			}

			if (!timingSafeEqualStrings(channel.viewPassword, ps.password)) {
				throw new ApiError(meta.errors.invalidPassword);
			}

			const viewToken = await this.liveChannelService.issueViewToken(channel.streamKey);
			return { viewToken };
		});
	}
}
