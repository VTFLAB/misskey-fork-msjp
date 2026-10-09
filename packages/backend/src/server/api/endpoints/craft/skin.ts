/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CraftService } from '@/core/CraftService.js';

export const meta = {
	tags: ['craft'],

	requireCredential: true,

	kind: 'read:account',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			skinUrl: {
				type: 'string',
				optional: false, nullable: true,
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private craftService: CraftService,
	) {
		super(meta, paramDef, async (_ps, me) => {
			return { skinUrl: await this.craftService.getSkinUrl(me.id) };
		});
	}
}
