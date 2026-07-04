/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { RemoteGuestHostAllowlistService } from '@/core/remote-guest/RemoteGuestHostAllowlistService.js';
import { RemoteGuestMiAuthClientService, RemoteGuestLoginError } from '@/core/remote-guest/RemoteGuestMiAuthClientService.js';

export const meta = {
	tags: ['remote-guest'],

	requireCredential: false,

	description: 'リモート Misskey インスタンスのアカウントで視聴+コメント用のゲストログインを開始する。相手インスタンスの MiAuth へリダイレクトする URL を返す。',

	limit: {
		duration: 1000 * 60 * 10,
		max: 10,
	},

	errors: {
		invalidAcct: {
			message: 'acct must be in the "username@host" form.',
			code: 'INVALID_ACCT',
			id: 'fdf80d3e-3bf8-47df-ad55-e92727e1d68d',
		},
		hostNotAllowed: {
			message: 'This host is not allowed for remote guest login.',
			code: 'HOST_NOT_ALLOWED',
			id: '75b28f56-e014-4907-b05b-0478533a5f06',
			httpStatusCode: 403,
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			url: { type: 'string', optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		acct: { type: 'string', minLength: 1, maxLength: 512 },
		returnTo: { type: 'string', minLength: 1, maxLength: 512 },
	},
	required: ['acct', 'returnTo'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private remoteGuestHostAllowlistService: RemoteGuestHostAllowlistService,
		private remoteGuestMiAuthClientService: RemoteGuestMiAuthClientService,
	) {
		super(meta, paramDef, async (ps) => {
			const atIndex = ps.acct.lastIndexOf('@');
			if (atIndex <= 0 || atIndex === ps.acct.length - 1) {
				throw new ApiError(meta.errors.invalidAcct);
			}
			const username = ps.acct.slice(0, atIndex);
			const host = ps.acct.slice(atIndex + 1);

			if (!ps.returnTo.startsWith('/live/')) {
				throw new ApiError(meta.errors.invalidAcct);
			}

			if (!this.remoteGuestHostAllowlistService.isAllowed(host)) {
				throw new ApiError(meta.errors.hostNotAllowed);
			}

			try {
				const url = await this.remoteGuestMiAuthClientService.generateLoginUrl(host, username, ps.returnTo);
				return { url };
			} catch (err) {
				if (err instanceof RemoteGuestLoginError) {
					throw new ApiError(meta.errors.hostNotAllowed);
				}
				throw err;
			}
		});
	}
}
