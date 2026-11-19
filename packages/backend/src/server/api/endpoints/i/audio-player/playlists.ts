/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { RegistryApiService } from '@/core/RegistryApiService.js';

// fork 独自: 音声秘書など外部アプリが、常駐オーディオプレイヤーのプレイリスト一覧を読むためのエンドポイント。
// プレイリストは Web クライアントが registry の domain = null (scope: client/audioPlayer) に保存している。
// アクセストークンで i/registry/get を呼ぶと domain がトークン ID になり読めないので、ここでは意図的に domain = null を読む。
const REGISTRY_SCOPE = ['client', 'audioPlayer'];
const INDEX_KEY = 'playlists';
const MAX_PLAYLISTS = 100;

export const meta = {
	tags: ['account'],

	requireCredential: true,
	kind: 'read:audio-player',

	limit: {
		duration: 1000 * 60,
		max: 60,
	},

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				id: { type: 'string', optional: false, nullable: false },
				name: { type: 'string', optional: false, nullable: false },
				trackCount: { type: 'number', optional: false, nullable: false },
				updatedAt: { type: 'number', optional: false, nullable: false },
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
		private registryApiService: RegistryApiService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const item = await this.registryApiService.getItem(me.id, null, REGISTRY_SCOPE, INDEX_KEY);
			if (item == null || !Array.isArray(item.value)) return [];

			const playlists: { id: string; name: string; trackCount: number; updatedAt: number }[] = [];
			for (const entry of item.value as unknown[]) {
				if (playlists.length >= MAX_PLAYLISTS) break;
				if (entry == null || typeof entry !== 'object') continue;
				const { id, name, trackCount, updatedAt } = entry as Record<string, unknown>;
				if (typeof id !== 'string' || typeof name !== 'string') continue;
				if (typeof trackCount !== 'number' || !Number.isFinite(trackCount)) continue;
				if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) continue;
				playlists.push({ id, name, trackCount, updatedAt });
			}
			return playlists;
		});
	}
}
