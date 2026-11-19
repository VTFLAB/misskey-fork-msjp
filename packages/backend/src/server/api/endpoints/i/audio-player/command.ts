/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { RegistryApiService } from '@/core/RegistryApiService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';

// fork 独自: 音声秘書など外部アプリが、ユーザーが開いている Web クライアントの常駐オーディオプレイヤーを操作するためのエンドポイント。
// コマンドはメインストリーム (audioPlayerCommand) で Web クライアントへ中継する。実際に受けて動かすかどうかは
// Web クライアント側の端末ごとの設定 (既定オフ) が決める。
// プレイリストの存在確認は Web クライアントの保存先 (registry の domain = null) を読む。
// アクセストークンでの i/registry/get は domain がトークン ID になり読めないため。
const REGISTRY_SCOPE = ['client', 'audioPlayer'];

export const meta = {
	tags: ['account'],

	requireCredential: true,
	kind: 'write:audio-player',

	limit: {
		duration: 1000 * 60,
		max: 60,
	},

	errors: {
		playlistIdRequired: {
			message: 'playlistId is required when action is playPlaylist.',
			code: 'PLAYLIST_ID_REQUIRED',
			id: '39a923fa-c53c-48e0-bbd3-6601135fe341',
		},
		noSuchPlaylist: {
			message: 'No such playlist.',
			code: 'NO_SUCH_PLAYLIST',
			id: '6ccf8b57-514f-493b-9b4f-6203d2706fc2',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		action: { type: 'string', enum: ['play', 'pause', 'toggle', 'next', 'prev', 'playPlaylist'] },
		playlistId: { type: 'string', pattern: /^[a-zA-Z0-9]+$/.toString().slice(1, -1), maxLength: 64 },
		shuffle: { type: 'boolean', default: false },
	},
	required: ['action'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private registryApiService: RegistryApiService,
		private globalEventService: GlobalEventService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (ps.action === 'playPlaylist') {
				if (ps.playlistId == null) throw new ApiError(meta.errors.playlistIdRequired);

				const playlist = await this.registryApiService.getItem(me.id, null, REGISTRY_SCOPE, `playlist:${ps.playlistId}`);
				if (playlist == null) throw new ApiError(meta.errors.noSuchPlaylist);
			}

			this.globalEventService.publishMainStream(me.id, 'audioPlayerCommand', {
				action: ps.action,
				playlistId: ps.playlistId ?? null,
				shuffle: ps.shuffle,
			});
		});
	}
}
