/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, Inject } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { TwitchStreamCommentsRepository } from '@/models/_.js';
import { MiTwitchStreamComment } from '@/models/TwitchStreamComment.js';
import type { TwitchChatFragment } from '@/models/TwitchStreamComment.js';
import type { MiTwitchStream } from '@/models/TwitchStream.js';
import type { MiUser } from '@/models/User.js';
import { IdService } from '@/core/IdService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import type { TwitchLiveStreamEventTypes } from '@/core/GlobalEventService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { DriveFileEntityService } from '@/core/entities/DriveFileEntityService.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { TwitchLoggerService } from './TwitchLoggerService.js';

export const MAX_COMMENT_LENGTH = 500;

export type PackedTwitchStreamComment = TwitchLiveStreamEventTypes['comment'];

@Injectable()
export class TwitchCommentService {
	private logger: Logger;

	constructor(
		@Inject(DI.twitchStreamCommentsRepository)
		private twitchStreamCommentsRepository: TwitchStreamCommentsRepository,

		private idService: IdService,
		private globalEventService: GlobalEventService,
		private userEntityService: UserEntityService,
		private driveFileEntityService: DriveFileEntityService,
		private twitchLoggerService: TwitchLoggerService,
	) {
		this.logger = this.twitchLoggerService.child('comment');
	}

	/**
	 * Misskey ユーザーのコメントを投稿する。永続化 → 視聴ページへリアルタイム配信。
	 * Twitch への中継は呼び出し側 (TwitchChatRelayService) が行う。
	 */
	@bindThis
	public async createMisskeyComment(stream: MiTwitchStream, user: MiUser, text: string, fileIds: string[] = []): Promise<MiTwitchStreamComment> {
		const comment = await this.twitchStreamCommentsRepository.insertOne(new MiTwitchStreamComment({
			id: this.idService.gen(),
			streamId: stream.id,
			source: 'misskey',
			userId: user.id,
			text,
			fileIds,
		}));

		await this.publishComment(stream.id, comment, user);
		return comment;
	}

	/**
	 * Twitch チャット由来のコメントを取り込む。twitchMessageId で重複排除する。
	 */
	@bindThis
	public async createTwitchComment(stream: MiTwitchStream, data: {
		twitchMessageId: string;
		twitchUserName: string;
		twitchDisplayName: string;
		text: string;
		fragments?: TwitchChatFragment[] | null;
	}): Promise<MiTwitchStreamComment | null> {
		const existing = await this.twitchStreamCommentsRepository.findOneBy({ twitchMessageId: data.twitchMessageId });
		if (existing != null) return null;

		const comment = await this.twitchStreamCommentsRepository.insertOne(new MiTwitchStreamComment({
			id: this.idService.gen(),
			streamId: stream.id,
			source: 'twitch',
			twitchMessageId: data.twitchMessageId,
			twitchUserName: data.twitchUserName,
			twitchDisplayName: data.twitchDisplayName,
			text: data.text.slice(0, 1024),
			fragments: data.fragments ?? null,
		}));

		await this.publishComment(stream.id, comment, null);
		return comment;
	}

	@bindThis
	public async pack(comment: MiTwitchStreamComment, user: MiUser | null): Promise<PackedTwitchStreamComment> {
		return {
			id: comment.id,
			createdAt: this.idService.parse(comment.id).date.toISOString(),
			source: comment.source,
			text: comment.text,
			user: (comment.userId != null && user != null)
				? await this.userEntityService.pack(user)
				: null,
			files: await this.driveFileEntityService.packManyByIds(comment.fileIds),
			twitchUserName: comment.twitchUserName,
			twitchDisplayName: comment.twitchDisplayName,
			fragments: comment.fragments,
		};
	}

	/**
	 * 履歴取得用の一括 pack。ユーザー・ファイルはまとめて解決する (N+1 回避)。
	 * 退会済みユーザーのコメントは user: null で返る。削除済みファイルは除外される。
	 */
	@bindThis
	public async packMany(comments: MiTwitchStreamComment[]): Promise<PackedTwitchStreamComment[]> {
		const userIds = [...new Set(comments.flatMap(c => c.userId != null ? [c.userId] : []))];
		const users = userIds.length > 0 ? await this.userEntityService.packMany(userIds) : [];
		const userById = new Map(users.map(u => [u.id, u]));
		const fileById = await this.driveFileEntityService.packManyByIdsMap([...new Set(comments.flatMap(c => c.fileIds))]);
		return comments.map(c => ({
			id: c.id,
			createdAt: this.idService.parse(c.id).date.toISOString(),
			source: c.source,
			text: c.text,
			user: c.userId != null ? (userById.get(c.userId) ?? null) : null,
			files: c.fileIds.map(fileId => fileById.get(fileId)).filter(f => f != null),
			twitchUserName: c.twitchUserName,
			twitchDisplayName: c.twitchDisplayName,
			fragments: c.fragments,
		}));
	}

	@bindThis
	private async publishComment(streamId: string, comment: MiTwitchStreamComment, user: MiUser | null): Promise<void> {
		const packed = await this.pack(comment, user);
		this.globalEventService.publishTwitchLiveStream(streamId, 'comment', packed);
	}
}
