/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, Inject } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { TwitchStreamBlocksRepository } from '@/models/_.js';
import { MiTwitchStreamBlock } from '@/models/TwitchStreamBlock.js';
import type { MiTwitchStreamComment } from '@/models/TwitchStreamComment.js';
import type { MiUser } from '@/models/User.js';
import type { Packed } from '@/misc/json-schema.js';
import { IdService } from '@/core/IdService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { bindThis } from '@/decorators.js';

export type PackedTwitchStreamBlock = {
	id: string;
	createdAt: string;
	targetType: 'misskey' | 'remote-guest' | 'twitch';
	targetUser: Packed<'UserLite'> | null;
	targetRemoteGuest: { username: string; host: string } | null;
	targetTwitch: { userName: string; displayName: string | null } | null;
};

// 配信ページ単位のブロック (fork 独自)。配信者が自分の配信チャットから特定の投稿者を
// 締め出す。Misskey 本体の blocking とは独立し、配信チャンネル (配信者) 単位で永続する。
@Injectable()
export class TwitchStreamBlockService {
	constructor(
		@Inject(DI.twitchStreamBlocksRepository)
		private twitchStreamBlocksRepository: TwitchStreamBlocksRepository,

		private idService: IdService,
		private userEntityService: UserEntityService,
	) {
	}

	/**
	 * コメントからブロック対象を導出して作成する。対象の同定はクライアントに任せず、
	 * コメント行そのものから行う (source ごとの識別子の混同・偽装を防ぐ)。
	 * 既にブロック済みなら既存行を返す。
	 * @returns 作成 (または既存) のブロック行。対象を導出できないコメント (退会済み
	 * ユーザーのコメント等) は null
	 */
	@bindThis
	public async blockFromComment(broadcasterId: MiUser['id'], comment: MiTwitchStreamComment): Promise<MiTwitchStreamBlock | null> {
		if (comment.source === 'misskey') {
			if (comment.userId == null || comment.userId === broadcasterId) return null;
			const existing = await this.twitchStreamBlocksRepository.findOneBy({
				userId: broadcasterId,
				targetUserId: comment.userId,
			});
			if (existing != null) return existing;
			return await this.twitchStreamBlocksRepository.insertOne(new MiTwitchStreamBlock({
				id: this.idService.gen(),
				userId: broadcasterId,
				targetType: 'misskey',
				targetUserId: comment.userId,
			}));
		}

		if (comment.source === 'remote-guest') {
			if (comment.remoteGuestUsername == null || comment.remoteGuestHost == null) return null;
			const existing = await this.twitchStreamBlocksRepository.findOneBy({
				userId: broadcasterId,
				targetRemoteGuestUsername: comment.remoteGuestUsername,
				targetRemoteGuestHost: comment.remoteGuestHost,
			});
			if (existing != null) return existing;
			return await this.twitchStreamBlocksRepository.insertOne(new MiTwitchStreamBlock({
				id: this.idService.gen(),
				userId: broadcasterId,
				targetType: 'remote-guest',
				targetRemoteGuestUsername: comment.remoteGuestUsername,
				targetRemoteGuestHost: comment.remoteGuestHost,
			}));
		}

		// source === 'twitch'
		if (comment.twitchUserName == null) return null;
		const existing = await this.twitchStreamBlocksRepository.findOneBy({
			userId: broadcasterId,
			targetTwitchUserName: comment.twitchUserName,
		});
		if (existing != null) {
			// 旧データからのブロックで chatter ID が取れていなかった場合、後から補完する
			if (existing.targetTwitchUserId == null && comment.twitchChatterUserId != null) {
				await this.twitchStreamBlocksRepository.update(existing.id, { targetTwitchUserId: comment.twitchChatterUserId });
				existing.targetTwitchUserId = comment.twitchChatterUserId;
			}
			return existing;
		}
		return await this.twitchStreamBlocksRepository.insertOne(new MiTwitchStreamBlock({
			id: this.idService.gen(),
			userId: broadcasterId,
			targetType: 'twitch',
			targetTwitchUserId: comment.twitchChatterUserId,
			targetTwitchUserName: comment.twitchUserName,
			targetTwitchDisplayName: comment.twitchDisplayName,
		}));
	}

	@bindThis
	public async isBlockedMisskeyUser(broadcasterId: MiUser['id'], userId: MiUser['id']): Promise<boolean> {
		return await this.twitchStreamBlocksRepository.existsBy({
			userId: broadcasterId,
			targetUserId: userId,
		});
	}

	@bindThis
	public async isBlockedRemoteGuest(broadcasterId: MiUser['id'], username: string, host: string): Promise<boolean> {
		return await this.twitchStreamBlocksRepository.existsBy({
			userId: broadcasterId,
			targetRemoteGuestUsername: username,
			targetRemoteGuestHost: host,
		});
	}

	/**
	 * Twitch チャッターのブロック判定。安定 ID (chatter_user_id) を優先しつつ、
	 * ID を保存できていない旧ブロック行にも login 名でマッチさせる
	 */
	@bindThis
	public async isBlockedTwitchChatter(broadcasterId: MiUser['id'], chatterUserId: string, chatterLogin: string): Promise<boolean> {
		return await this.twitchStreamBlocksRepository.createQueryBuilder('block')
			.where('block.userId = :broadcasterId', { broadcasterId })
			.andWhere('block.targetType = :targetType', { targetType: 'twitch' })
			.andWhere('(block.targetTwitchUserId = :chatterUserId OR block.targetTwitchUserName = :chatterLogin)', { chatterUserId, chatterLogin })
			.getExists();
	}

	@bindThis
	public async packMany(blocks: MiTwitchStreamBlock[]): Promise<PackedTwitchStreamBlock[]> {
		const targetUserIds = [...new Set(blocks.flatMap(b => b.targetUserId != null ? [b.targetUserId] : []))];
		const targetUsers = targetUserIds.length > 0 ? await this.userEntityService.packMany(targetUserIds) : [];
		const userById = new Map(targetUsers.map(u => [u.id, u]));
		return blocks.map(b => ({
			id: b.id,
			createdAt: this.idService.parse(b.id).date.toISOString(),
			targetType: b.targetType,
			targetUser: b.targetUserId != null ? (userById.get(b.targetUserId) ?? null) : null,
			targetRemoteGuest: (b.targetRemoteGuestUsername != null && b.targetRemoteGuestHost != null)
				? { username: b.targetRemoteGuestUsername, host: b.targetRemoteGuestHost }
				: null,
			targetTwitch: b.targetTwitchUserName != null
				? { userName: b.targetTwitchUserName, displayName: b.targetTwitchDisplayName }
				: null,
		}));
	}
}
