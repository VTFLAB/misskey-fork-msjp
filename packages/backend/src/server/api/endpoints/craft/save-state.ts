/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { CraftService } from '@/core/CraftService.js';

export const meta = {
	tags: ['craft'],

	requireCredential: true,

	kind: 'write:account',

	prohibitMoved: true,

	limit: {
		duration: 1000 * 60,
		max: 30,
	},

	errors: {
		noSuchWorld: {
			message: 'No such world.',
			code: 'NO_SUCH_WORLD',
			id: 'd2bae51e-42c8-4f9a-9c2f-45f1678427ad',
		},
		tooLarge: {
			message: 'The state is too large.',
			code: 'STATE_TOO_LARGE',
			id: 'fad97a4f-435f-4b1e-96a2-d7b037931881',
		},
		tooMany: {
			message: 'You have too many saved states.',
			code: 'TOO_MANY_STATES',
			id: '3b1d06e3-4a16-46b8-8d9f-97d8a2fd3b00',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		worldId: { type: 'string', format: 'misskey:id' },
		state: { type: 'object', additionalProperties: true },
	},
	required: ['worldId', 'state'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private craftService: CraftService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// 観戦者もセーブデータを持つので canBuild は見ない。ワールドの存在だけ確認する
			const result = await this.craftService.savePlayerState(ps.worldId, me.id, ps.state);
			if (result === 'tooLarge') throw new ApiError(meta.errors.tooLarge);
			if (result === 'tooMany') throw new ApiError(meta.errors.tooMany);
			if (result === 'noSuchWorld') throw new ApiError(meta.errors.noSuchWorld);
		});
	}
}
