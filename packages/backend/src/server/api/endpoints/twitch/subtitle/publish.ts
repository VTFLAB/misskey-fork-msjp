/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';

// ライブ字幕 (bsky-fork 独自): 配信者の字幕スタジオ (クライアントサイド音声認識+翻訳) から
// バッチで送られてきたイベントを、自分の userId チャンネルへそのまま中継する。
// サーバー側では翻訳・認識処理は一切行わず、DB にも何も保存しない (transport only)。
export const meta = {
	tags: ['twitch'],

	requireCredential: true,
	kind: 'write:account',
	prohibitMoved: true,

	description: 'ライブ字幕イベント (caption/translation/clear) を自分の字幕チャンネルへ中継する。サーバーは中継のみ行い、DB への保存や翻訳処理は行わない。',

	limit: {
		duration: 60 * 1000,
		max: 600,
	},

	errors: {
		invalidEvent: {
			message: 'Invalid subtitle event.',
			code: 'INVALID_EVENT',
			id: '7a12886c-fcb5-4d46-80b6-19a933132b62',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		events: {
			type: 'array',
			minItems: 1,
			maxItems: 30,
			items: {
				type: 'object',
				properties: {
					type: { type: 'string', enum: ['caption', 'translation', 'clear'] },
					id: { type: 'string', minLength: 1, maxLength: 64 },
					text: { type: 'string', maxLength: 1000 },
					isFinal: { type: 'boolean' },
					lang: { type: 'string', minLength: 1, maxLength: 35 },
				},
				required: ['type'],
			},
		},
	},
	required: ['events'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private globalEventService: GlobalEventService,
	) {
		super(meta, paramDef, async (ps, me) => {
			for (const event of ps.events) {
				switch (event.type) {
					case 'caption': {
						if (typeof event.id !== 'string' || typeof event.text !== 'string' || typeof event.isFinal !== 'boolean') {
							throw new ApiError(meta.errors.invalidEvent);
						}
						this.globalEventService.publishLiveSubtitleStream(me.id, 'caption', {
							id: event.id,
							text: event.text,
							isFinal: event.isFinal,
						});
						break;
					}
					case 'translation': {
						if (typeof event.id !== 'string' || typeof event.text !== 'string' || typeof event.lang !== 'string') {
							throw new ApiError(meta.errors.invalidEvent);
						}
						this.globalEventService.publishLiveSubtitleStream(me.id, 'translation', {
							id: event.id,
							text: event.text,
							lang: event.lang,
						});
						break;
					}
					case 'clear': {
						this.globalEventService.publishLiveSubtitleStream(me.id, 'clear', {});
						break;
					}
					default:
						throw new ApiError(meta.errors.invalidEvent);
				}
			}

			return {};
		});
	}
}
