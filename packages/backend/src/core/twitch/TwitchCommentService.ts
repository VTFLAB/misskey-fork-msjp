/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, Inject } from '@nestjs/common';
import { In } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { TwitchStreamCommentsRepository, RemoteGuestAccountsRepository } from '@/models/_.js';
import { MiTwitchStreamComment } from '@/models/TwitchStreamComment.js';
import type { TwitchChatFragment } from '@/models/TwitchStreamComment.js';
import type { MiTwitchStream } from '@/models/TwitchStream.js';
import type { MiUser } from '@/models/User.js';
import type { MiRemoteGuestAccount } from '@/models/RemoteGuestAccount.js';
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

		@Inject(DI.remoteGuestAccountsRepository)
		private remoteGuestAccountsRepository: RemoteGuestAccountsRepository,

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
	 * リモートMisskeyインスタンスのゲストユーザーのコメントを投稿する。
	 * ノートとは完全分離、fileIds/fragments は使わない (misskey/twitch 専用の機能のため)。
	 */
	@bindThis
	public async createRemoteGuestComment(stream: MiTwitchStream, guest: MiRemoteGuestAccount, text: string): Promise<MiTwitchStreamComment> {
		const comment = await this.twitchStreamCommentsRepository.insertOne(new MiTwitchStreamComment({
			id: this.idService.gen(),
			streamId: stream.id,
			source: 'remote-guest',
			remoteGuestAccountId: guest.id,
			remoteGuestUsername: guest.username,
			remoteGuestHost: guest.host,
			text,
			fileIds: [],
		}));

		await this.publishComment(stream.id, comment, null, guest);
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
		twitchChatterUserId?: string | null;
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
			twitchChatterUserId: data.twitchChatterUserId ?? null,
			text: data.text.slice(0, 1024),
			fragments: data.fragments ?? null,
		}));

		await this.publishComment(stream.id, comment, null);
		return comment;
	}

	@bindThis
	public async pack(comment: MiTwitchStreamComment, user: MiUser | null, guest?: MiRemoteGuestAccount | null): Promise<PackedTwitchStreamComment> {
		// guest が明示的に渡されなかった場合のみ都度引く (投稿直後の publish は呼び出し側が既に持っているインスタンスを渡すため引き直さない)
		const remoteGuestAccount = guest !== undefined
			? guest
			: (comment.remoteGuestAccountId != null ? await this.remoteGuestAccountsRepository.findOneBy({ id: comment.remoteGuestAccountId }) : null);

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
			remoteGuest: (comment.remoteGuestUsername != null && comment.remoteGuestHost != null)
				? { username: comment.remoteGuestUsername, host: comment.remoteGuestHost, avatarUrl: remoteGuestAccount?.avatarUrl ?? null }
				: null,
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
		const remoteGuestAccountIds = [...new Set(comments.flatMap(c => c.remoteGuestAccountId != null ? [c.remoteGuestAccountId] : []))];
		const remoteGuestAccounts = remoteGuestAccountIds.length > 0
			? await this.remoteGuestAccountsRepository.findBy({ id: In(remoteGuestAccountIds) })
			: [];
		const avatarUrlByRemoteGuestAccountId = new Map(remoteGuestAccounts.map(a => [a.id, a.avatarUrl]));
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
			remoteGuest: (c.remoteGuestUsername != null && c.remoteGuestHost != null)
				? { username: c.remoteGuestUsername, host: c.remoteGuestHost, avatarUrl: (c.remoteGuestAccountId != null ? avatarUrlByRemoteGuestAccountId.get(c.remoteGuestAccountId) : null) ?? null }
				: null,
		}));
	}

	@bindThis
	private async publishComment(streamId: string, comment: MiTwitchStreamComment, user: MiUser | null, guest: MiRemoteGuestAccount | null = null): Promise<void> {
		const packed = await this.pack(comment, user, guest);
		this.globalEventService.publishTwitchLiveStream(streamId, 'comment', packed);
	}
}
