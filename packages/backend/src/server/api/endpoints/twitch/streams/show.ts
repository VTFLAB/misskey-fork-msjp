/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';
import type { FollowingsRepository, TwitchAccountsRepository } from '@/models/_.js';
import type { Config } from '@/config.js';
import { TwitchStreamService } from '@/core/twitch/TwitchStreamService.js';
import { LiveChannelService } from '@/core/live/LiveChannelService.js';
import { LiveArchiveAccessService } from '@/core/live/LiveArchiveAccessService.js';
import type { MiLiveChannel } from '@/models/LiveChannel.js';

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
						authorized: { type: 'boolean', optional: false, nullable: false },
						viewRestriction: { type: 'string', optional: true, nullable: false, enum: ['followers', 'password', 'users'] },
						// 配信アーカイブ (Google Drive、bsky-fork 独自)。過去 (isLive=false) の ome セッションのみ設定される
						title: { type: 'string', optional: true, nullable: true },
						startedAt: { type: 'string', format: 'date-time', optional: true, nullable: true },
						endedAt: { type: 'string', format: 'date-time', optional: true, nullable: true },
						recordingStatus: {
							type: 'string', optional: true, nullable: false,
							enum: ['none', 'pending', 'remuxing', 'uploading', 'processing', 'ready', 'failed'],
						},
						recordingGoogleDriveFileId: { type: 'string', optional: true, nullable: true },
						recordingGoogleDriveThumbnailLink: { type: 'string', optional: true, nullable: true },
						// オーナー本人のリクエストのみ値が入る (他人には常に省略/undefined)
						recordingError: { type: 'string', optional: true, nullable: true },
						// YouTube アップロード (bsky-fork 独自)。過去 (isLive=false) の ome セッションのみ設定される
						youtubeUploadStatus: {
							type: 'string', optional: true, nullable: false,
							enum: ['none', 'pending', 'uploading', 'ready', 'failed', 'queued', 'cancelled'],
						},
						youtubeVideoId: { type: 'string', optional: true, nullable: true },
						// オーナー本人のリクエストのみ値が入る (他人には常に省略/undefined)
						youtubeUploadError: { type: 'string', optional: true, nullable: true },
						// アーカイブ公開取り消し (bsky-fork 独自)。recordingError 等と同じくオーナー本人のみ値が入る
						archiveUnpublished: { type: 'boolean', optional: true, nullable: false },
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
		viewToken: { type: 'string', minLength: 1 },
		// アーカイブ視聴制限 (password モード) 用トークン。専用視聴ページが 1 アーカイブ = 1 ページで
		// 扱う設計のため、ライブ用 viewToken と異なり単数のみ (bsky-fork 独自)。
		archiveViewToken: { type: 'string', minLength: 1 },
	},
	required: ['userId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.twitchAccountsRepository)
		private twitchAccountsRepository: TwitchAccountsRepository,

		@Inject(DI.followingsRepository)
		private followingsRepository: FollowingsRepository,

		@Inject(DI.config)
		private config: Config,

		private twitchStreamService: TwitchStreamService,

		private liveChannelService: LiveChannelService,

		private liveArchiveAccessService: LiveArchiveAccessService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const account = await this.twitchAccountsRepository.findOneBy({ userId: ps.userId });
			const liveChannel = await this.liveChannelService.show(ps.userId);
			if (account == null && liveChannel == null) {
				throw new ApiError(meta.errors.notLinked);
			}

			// ome セッションの視聴可否判定 (canWatch)。liveChannel は 1 ユーザーにつき最大 1 行なので、
			// このリクエスト内では一度だけ判定すれば全 ome セッションに使い回せる。
			const { authorized, viewRestriction, viewToken } = await this.canWatch(liveChannel, me, ps.viewToken);

			const stream = await this.twitchStreamService.getLiveStreamByUserId(ps.userId);
			const allSessions = await this.twitchStreamService.getAllLiveStreamsByUserId(ps.userId);

			// 配信アーカイブ (Google Drive、bsky-fork 独自)。オーナー本人には failed も含めて見せる
			// (recordingStatus='none' は getRecentEndedOmeStreamsByUserId 側で常に除外済み)。
			const isOwner = me != null && me.id === ps.userId;
			const pastOmeSessions = await this.twitchStreamService.getRecentEndedOmeStreamsByUserId(ps.userId);
			const visiblePastOmeSessions = isOwner
				? pastOmeSessions
				: pastOmeSessions.filter(s => s.recordingStatus !== 'failed' && s.archiveUnpublishedAt == null);

			const sessions = allSessions.map(s => {
				if (s.source === 'ome') {
					// 認可判定 (canWatch) は config.ome の有無に関わらず成立する (viewRestriction はモード名であって
					// 秘匿情報ではないため、OME 未設定でも視聴可否・理由は正しく返す)。playbackUrl だけは
					// config.ome が無ければ組み立てようがないので省略する。
					if (!authorized) {
						return {
							source: 'ome' as const,
							streamId: s.id,
							isLive: s.isLive,
							authorized: false,
							viewRestriction,
						};
					}

					const ome = this.config.ome;
					if (ome == null || liveChannel == null) {
						return {
							source: 'ome' as const,
							streamId: s.id,
							isLive: s.isLive,
							authorized: true as const,
						};
					}

					const scheme = ome.publicWhipUrl.startsWith('https://') ? 'wss' : 'ws';
					const hostPort = ome.publicWhipUrl.replace(/^https?:\/\//, '');
					return {
						source: 'ome' as const,
						streamId: s.id,
						isLive: s.isLive,
						authorized: true as const,
						playbackUrl: `${scheme}://${hostPort}/${ome.app}/${liveChannel.streamKey}?vt=${viewToken}`,
					};
				}
				return {
					source: 'twitch' as const,
					streamId: s.id,
					isLive: s.isLive,
					authorized: true as const,
					twitchLogin: s.twitchLogin ?? undefined,
				};
			});

			// 過去セッション (アーカイブ) は配信終了時点の視聴制限スナップショットに基づき canWatchArchive で判定する
			// (bsky-fork 独自、視聴制限のアーカイブ引き継ぎ)。非認可でも title/startedAt/endedAt/recordingStatus 等の
			// 非機微情報は返すが、recordingGoogleDriveFileId/recordingGoogleDriveThumbnailLink/youtubeVideoId は省略する。
			const pastSessions = await Promise.all(visiblePastOmeSessions.map(async s => {
				const { authorized, viewRestriction } = await this.liveArchiveAccessService.canWatchArchive(s, me, ps.archiveViewToken);

				return {
					source: 'ome' as const,
					streamId: s.id,
					isLive: false as const,
					authorized,
					viewRestriction,
					title: s.title,
					startedAt: s.startedAt.toISOString(),
					endedAt: s.endedAt?.toISOString() ?? null,
					recordingStatus: s.recordingStatus,
					recordingGoogleDriveFileId: authorized ? s.recordingGoogleDriveFileId : undefined,
					recordingGoogleDriveThumbnailLink: authorized ? s.recordingGoogleDriveThumbnailLink : undefined,
					recordingError: isOwner ? s.recordingError : undefined,
					youtubeUploadStatus: s.youtubeUploadStatus,
					youtubeVideoId: authorized ? s.youtubeVideoId : undefined,
					youtubeUploadError: isOwner ? s.youtubeUploadError : undefined,
					// アーカイブ公開取り消しフラグ。オーナー本人のみ値が入る (recordingError と同じ owner-only 扱い)。
					archiveUnpublished: isOwner ? s.archiveUnpublishedAt != null : undefined,
				};
			}));

			return {
				twitchLogin: account?.twitchLogin ?? '',
				twitchDisplayName: account?.twitchDisplayName ?? '',
				stream: stream == null ? null : {
					id: stream.id,
					title: stream.title,
					gameName: stream.gameName,
					viewerCount: stream.viewerCount,
					thumbnailUrl: stream.thumbnailUrl,
					startedAt: stream.startedAt.toISOString(),
				},
				sessions: [...sessions, ...pastSessions],
			};
		});
	}

	// ome セッションの視聴可否判定 (enforcement 設計、確定済み)。owner は常に許可。
	// public 以外の視聴制限モードでは、認可された場合のみ playbackUrl に載せる視聴トークンを発行する
	// (password モードで有効な viewToken が渡された場合はそれを再利用し、Redis の TTL を延長させない)。
	private async canWatch(
		liveChannel: MiLiveChannel | null,
		me: { id: string } | null,
		viewToken: string | undefined,
	): Promise<{ authorized: boolean; viewRestriction?: 'followers' | 'password' | 'users'; viewToken?: string }> {
		if (liveChannel == null) {
			return { authorized: false };
		}

		if (liveChannel.visibility === 'public' || (me != null && me.id === liveChannel.userId)) {
			return { authorized: true, viewToken: await this.liveChannelService.issueViewToken(liveChannel.streamKey) };
		}

		if (liveChannel.visibility === 'followers') {
			const isFollowing = me != null && await this.followingsRepository.exists({
				where: { followerId: me.id, followeeId: liveChannel.userId },
			});
			if (!isFollowing) return { authorized: false, viewRestriction: 'followers' };
			return { authorized: true, viewToken: await this.liveChannelService.issueViewToken(liveChannel.streamKey) };
		}

		if (liveChannel.visibility === 'users') {
			const isAllowed = me != null && liveChannel.visibleUserIds.includes(me.id);
			if (!isAllowed) return { authorized: false, viewRestriction: 'users' };
			return { authorized: true, viewToken: await this.liveChannelService.issueViewToken(liveChannel.streamKey) };
		}

		// この時点で visibility は 'password' のみ (union を上の分岐で使い切っている)。
		const validToken = viewToken != null && await this.liveChannelService.verifyViewToken(liveChannel.streamKey, viewToken);
		if (!validToken) return { authorized: false, viewRestriction: 'password' };
		return { authorized: true, viewToken };
	}
}
