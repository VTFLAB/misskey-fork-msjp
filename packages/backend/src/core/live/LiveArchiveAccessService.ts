/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import type { FollowingsRepository, TwitchStreamsRepository } from '@/models/_.js';
import type { MiTwitchStream } from '@/models/TwitchStream.js';
import { bindThis } from '@/decorators.js';

// アーカイブ視聴トークン (archive:viewtoken:<token> -> streamId) の TTL。ライブ用
// (LiveChannelService の ome:viewtoken:、TTL12h、streamKey 単位) とは別の Redis key 空間にする。
// アーカイブは OME AdmissionWebhooks を経由せず API 層のみが消費するため、TTL はライブより長く 30 日とする。
const ARCHIVE_VIEW_TOKEN_TTL_SEC = 60 * 60 * 24 * 30; // 30日

@Injectable()
export class LiveArchiveAccessService {
	constructor(
		@Inject(DI.twitchStreamsRepository)
		private twitchStreamsRepository: TwitchStreamsRepository,

		@Inject(DI.followingsRepository)
		private followingsRepository: FollowingsRepository,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,
	) {
	}

	@bindThis
	private archiveViewTokenKey(token: string): string {
		return `archive:viewtoken:${token}`;
	}

	// password モード検証成功時のみ発行する (followers/users は me から毎回再計算可能なため発行不要)。
	@bindThis
	public async issueArchiveViewToken(streamId: MiTwitchStream['id']): Promise<string> {
		const token = randomBytes(32).toString('base64url');
		await this.redisClient.set(this.archiveViewTokenKey(token), streamId, 'EX', ARCHIVE_VIEW_TOKEN_TTL_SEC);
		return token;
	}

	@bindThis
	public async resolveArchiveViewToken(token: string): Promise<string | null> {
		return await this.redisClient.get(this.archiveViewTokenKey(token));
	}

	// アーカイブの視聴可否判定 (show.ts の canWatch と対称構造、enforcement 設計確定済み)。
	// owner は archiveUnpublishedAt の有無に関わらず常に許可する。
	@bindThis
	public async canWatchArchive(
		stream: MiTwitchStream,
		me: { id: string } | null,
		archiveViewToken: string | undefined,
	): Promise<{ authorized: boolean; viewRestriction?: 'followers' | 'password' | 'users' }> {
		// 公開取り消し済みは、オーナー以外には「存在しない」扱い (viewRestriction は付けない)。
		if (stream.archiveUnpublishedAt != null && me?.id !== stream.userId) {
			return { authorized: false };
		}

		if (me != null && me.id === stream.userId) {
			return { authorized: true };
		}

		if (stream.archiveViewVisibility === 'public') {
			return { authorized: true };
		}

		if (stream.archiveViewVisibility === 'followers') {
			const isFollowing = me != null && await this.followingsRepository.exists({
				where: { followerId: me.id, followeeId: stream.userId },
			});
			if (!isFollowing) return { authorized: false, viewRestriction: 'followers' };
			return { authorized: true };
		}

		if (stream.archiveViewVisibility === 'users') {
			const isAllowed = me != null && stream.archiveVisibleUserIds.includes(me.id);
			if (!isAllowed) return { authorized: false, viewRestriction: 'users' };
			return { authorized: true };
		}

		// この時点で archiveViewVisibility は 'password' のみ (union を上の分岐で使い切っている)。
		const resolvedStreamId = archiveViewToken != null ? await this.resolveArchiveViewToken(archiveViewToken) : null;
		if (resolvedStreamId !== stream.id) return { authorized: false, viewRestriction: 'password' };
		return { authorized: true };
	}

	// オーナー向けアーカイブ視聴制限の部分更新 (LiveChannelService.update と同型、undefined のフィールドは変更しない)。
	@bindThis
	public async updateArchiveSettings(stream: MiTwitchStream, params: {
		visibility?: 'public' | 'followers' | 'password' | 'users';
		viewPassword?: string | null;
		visibleUserIds?: string[];
	}): Promise<MiTwitchStream> {
		const update: Partial<MiTwitchStream> = {};
		if (params.visibility !== undefined) update.archiveViewVisibility = params.visibility;
		if (params.viewPassword !== undefined) update.archiveViewPassword = params.viewPassword;
		if (params.visibleUserIds !== undefined) update.archiveVisibleUserIds = params.visibleUserIds;

		if (Object.keys(update).length > 0) {
			await this.twitchStreamsRepository.update(stream.id, update);
		}

		return await this.twitchStreamsRepository.findOneByOrFail({ id: stream.id });
	}

	// アーカイブの公開取り消し (冪等)。実ファイル (Google Drive/YouTube) は削除しない。再公開 endpoint は無い (一方向のみ)。
	@bindThis
	public async unpublishArchive(stream: MiTwitchStream): Promise<MiTwitchStream> {
		if (stream.archiveUnpublishedAt != null) return stream;

		await this.twitchStreamsRepository.update(stream.id, { archiveUnpublishedAt: new Date() });
		return await this.twitchStreamsRepository.findOneByOrFail({ id: stream.id });
	}
}
