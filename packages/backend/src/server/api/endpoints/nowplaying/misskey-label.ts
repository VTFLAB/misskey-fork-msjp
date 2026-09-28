/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { MiMeta } from '@/models/_.js';

export const meta = {
	tags: ['nowplaying'],

	requireCredential: true,
	kind: 'read:account',

	description: 'Misskey にホストされている (このインスタンス自体が音源の) トラックの "from" 表示用ラベルを返す。',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			serviceLabel: { type: 'string', optional: false, nullable: false },
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
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta_: MiMeta,
	) {
		super(meta, paramDef, async () => {
			return {
				serviceLabel: this.meta_.name ?? this.config.host,
			};
		});
	}
}
