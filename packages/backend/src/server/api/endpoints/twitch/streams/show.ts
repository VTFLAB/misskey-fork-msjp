/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import type { TwitchAccountsRepository } from '@/models/_.js';
import type { Config } from '@/config.js';
import { TwitchStreamService } from '@/core/twitch/TwitchStreamService.js';

export const meta = {
	tags: ['twitch'],

	requireCredential: false,

	description: '指定ユーザーの Twitch 配信状態を返す。連携済みなら twitchLogin は常に返り、配信中なら stream が非 null。' +
		'視聴ページ (/live/:acct) が未ログイン・リモートゲストからも到達可能なため認証不要 (副作用のない読み取り専用エンドポイント)。',

	errors: {
		notLinked: {
			message: 'The user has not linked a Twitch account.',
			code: 'TWITCH_NOT_LINKED',
			id: '1669e0fa-787e-49fa-8612-6a04cb6cf98d',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			twitchLogin: { type: 'string', optional: false, nullable: false },
			twitchDisplayName: { type: 'string', optional: false, nullable: false },
			stream: {
				type: 'object',
				optional: false, nullable: true,
				properties: {
					id: { type: 'string', format: 'misskey:id', optional: false, nullable: false },
					title: { type: 'string', optional: false, nullable: false },
					gameName: { type: 'string', optional: false, nullable: true },
					viewerCount: { type: 'number', optional: false, nullable: false },
					thumbnailUrl: { type: 'string', optional: false, nullable: true },
					startedAt: { type: 'string', format: 'date-time', optional: false, nullable: false },
				},
			},
			sessions: {
				type: 'array',
				optional: false, nullable: false,
				items: {
					type: 'object',
					optional: false, nullable: false,
					properties: {
						source: { type: 'string', optional: false, nullable: false, enum: ['twitch', 'ome'] },
						streamId: { type: 'string', format: 'misskey:id', optional: false, nullable: false },
						isLive: { type: 'boolean', optional: false, nullable: false },
						playbackUrl: { type: 'string', optional: true, nullable: false },
						twitchLogin: { type: 'string', optional: true, nullable: false },
					},
				},
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
	},
	required: ['userId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.twitchAccountsRepository)
		private twitchAccountsRepository: TwitchAccountsRepository,

		@Inject(DI.config)
		private config: Config,

		private twitchStreamService: TwitchStreamService,
	) {
		super(meta, paramDef, async (ps) => {
			const account = await this.twitchAccountsRepository.findOneBy({ userId: ps.userId });
			if (account == null) throw new ApiError(meta.errors.notLinked);

			const stream = await this.twitchStreamService.getLiveStreamByUserId(ps.userId);
			const allSessions = await this.twitchStreamService.getAllLiveStreamsByUserId(ps.userId);

			const sessions = allSessions.map(s => {
				if (s.source === 'ome') {
					const ome = this.config.ome;
					return {
						source: 'ome' as const,
						streamId: s.id,
						isLive: s.isLive,
						playbackUrl: (ome != null && s.twitchStreamId != null)
							? (() => {
								const hostPort = ome.publicWhipUrl.replace(/^https?:\/\//, '');
								return `ws://${hostPort}/${ome.app}/${s.twitchStreamId}`;
							})()
							: undefined,
					};
				}
				return {
					source: 'twitch' as const,
					streamId: s.id,
					isLive: s.isLive,
					twitchLogin: s.twitchLogin ?? undefined,
				};
			});

			return {
				twitchLogin: account.twitchLogin,
				twitchDisplayName: account.twitchDisplayName,
				stream: stream == null ? null : {
					id: stream.id,
					title: stream.title,
					gameName: stream.gameName,
					viewerCount: stream.viewerCount,
					thumbnailUrl: stream.thumbnailUrl,
					startedAt: stream.startedAt.toISOString(),
				},
				sessions,
			};
		});
	}
}
