/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import type { TwitchStreamCommentsRepository, TwitchStreamsRepository } from '@/models/_.js';
import { QueryService } from '@/core/QueryService.js';
import { TwitchCommentService } from '@/core/twitch/TwitchCommentService.js';
import { LiveArchiveAccessService } from '@/core/live/LiveArchiveAccessService.js';

export const meta = {
	tags: ['twitch'],

	// OBS 用オーバーレイページ (認証不能なブラウザソース) から参照するため認証不要。
	// コメントは公開の配信ページに表示される情報であり、秘匿性はない
	requireCredential: false,

	description: '配信セッションのコメント履歴を返す (Misskey ユーザー投稿 + Twitch チャット由来)。OBS オーバーレイ等から匿名でも取得できる。',

	// 匿名開放に伴う保険。リアルタイム分は streaming チャンネルで受ける前提なので、
	// 履歴のポーリングとしては十分緩い値
	limit: {
		duration: 60 * 1000,
		max: 120,
	},

	// アーカイブ (source==='ome' && !isLive) にのみ視聴制限を適用する (bsky-fork 独自)。
	// ライブ配信中はこのエラーを一切返さない (OBS オーバーレイ互換のため無制限のまま)。
	errors: {
		archiveRestricted: {
			message: 'This archive is not accessible.',
			code: 'ARCHIVE_RESTRICTED',
			id: 'd05e1680-d4c0-4055-ab35-1f8e3a211ec5',
		},
	},

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				id: { type: 'string', format: 'misskey:id', optional: false, nullable: false },
				createdAt: { type: 'string', format: 'date-time', optional: false, nullable: false },
				source: { type: 'string', enum: ['misskey', 'twitch', 'remote-guest'], optional: false, nullable: false },
				text: { type: 'string', optional: false, nullable: false },
				user: { type: 'object', ref: 'UserLite', optional: false, nullable: true },
				files: {
					type: 'array',
					optional: false, nullable: false,
					items: { type: 'object', ref: 'DriveFile', optional: false, nullable: false },
				},
				twitchUserName: { type: 'string', optional: false, nullable: true },
				twitchDisplayName: { type: 'string', optional: false, nullable: true },
				translatedText: { type: 'string', optional: false, nullable: true },
				translatedLang: { type: 'string', optional: false, nullable: true },
				fragments: {
					type: 'array',
					optional: false, nullable: true,
					items: {
						type: 'object',
						optional: false, nullable: false,
						properties: {
							type: { type: 'string', enum: ['text', 'emote'], optional: false, nullable: false },
							text: { type: 'string', optional: false, nullable: false },
							emoteId: { type: 'string', optional: true, nullable: false },
							animated: { type: 'boolean', optional: true, nullable: false },
						},
					},
				},
				remoteGuest: {
					type: 'object',
					optional: false, nullable: true,
					properties: {
						username: { type: 'string', optional: false, nullable: false },
						host: { type: 'string', optional: false, nullable: false },
						avatarUrl: { type: 'string', optional: false, nullable: true },
					},
				},
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		streamId: { type: 'string', format: 'misskey:id' },
		// アーカイブ視聴制限 (password モード) 用トークン。ライブ配信中のコメント取得では無視される
		// (bsky-fork 独自、show.ts の archiveViewToken と同じ Redis key 空間を参照)。
		archiveViewToken: { type: 'string', minLength: 1 },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
	},
	required: ['streamId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.twitchStreamCommentsRepository)
		private twitchStreamCommentsRepository: TwitchStreamCommentsRepository,

		@Inject(DI.twitchStreamsRepository)
		private twitchStreamsRepository: TwitchStreamsRepository,

		private queryService: QueryService,
		private twitchCommentService: TwitchCommentService,
		private liveArchiveAccessService: LiveArchiveAccessService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// アーカイブ (source==='ome' && !isLive) のみ視聴制限を適用する。ライブ配信中
			// (isLive:true) は OBS オーバーレイの匿名アクセス要件により意図的に無制限のまま
			// 変更しない (bsky-fork 独自、視聴制限のアーカイブ引き継ぎ)。
			const stream = await this.twitchStreamsRepository.findOneBy({ id: ps.streamId });
			if (stream != null && stream.source === 'ome' && !stream.isLive) {
				const { authorized } = await this.liveArchiveAccessService.canWatchArchive(stream, me, ps.archiveViewToken);
				if (!authorized) throw new ApiError(meta.errors.archiveRestricted);
			}

			const query = this.queryService.makePaginationQuery(
				this.twitchStreamCommentsRepository.createQueryBuilder('comment'),
				ps.sinceId,
				ps.untilId,
			).andWhere('comment.streamId = :streamId', { streamId: ps.streamId });

			const comments = await query.limit(ps.limit).getMany();

			return await this.twitchCommentService.packMany(comments);
		});
	}
}
