/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Not, IsNull } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { TwitchStreamsRepository } from '@/models/_.js';
import { GoogleYoutubeService, GoogleYoutubeNotAuthorizedError } from '@/core/google/GoogleYoutubeService.js';
import { GoogleLoggerService } from '@/core/google/GoogleLoggerService.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';

/**
 * YouTube アップロード済みアーカイブの事後存在確認 (bsky-fork 独自、YouTube 12時間アーカイブ上限対策)。
 * QueueService の repeatable job (`youtubeHealthCheck`, 6時間ごと) から呼ばれる。
 * youtubeUploadStatus='ready' かつ youtubeVideoId が非 null のストリームを最大200件取得し、
 * ユーザー単位で videos.list (50件バッチ) を使って YouTube 側にまだ動画が存在するか確認する。
 * YouTube 側で削除/消失していた場合は youtubeUploadStatus='unavailable' に設定し、
 * youtubeVideoId / youtubeThumbnailUrl を null にする (プレイヤーやカードが Drive または
 * unavailable 表示へフォールバックするため)。recordingGoogleDriveFileId は残す (Drive コピーが
 * まだ再生可能ならそちらを優先するため)。recordingStatus は変更しない。
 * トークン失効 (GoogleYoutubeNotAuthorizedError 含む) でユーザー単位の確認ができない場合は
 * 何も更新せず warn してスキップする (GoogleOAuthService 側でアカウント無効化済みの可能性があるため)。
 */
@Injectable()
export class YoutubeHealthCheckProcessorService {
	private logger: Logger;

	constructor(
		@Inject(DI.twitchStreamsRepository)
		private twitchStreamsRepository: TwitchStreamsRepository,

		private googleYoutubeService: GoogleYoutubeService,
		private googleLoggerService: GoogleLoggerService,
	) {
		this.logger = this.googleLoggerService.child('youtube-health-check');
	}

	@bindThis
	public async process(): Promise<void> {
		const streams = await this.twitchStreamsRepository.find({
			where: { youtubeUploadStatus: 'ready', youtubeVideoId: Not(IsNull()) },
			order: { id: 'ASC' },
			take: 200,
		});
		if (streams.length === 0) return;

		// ユーザー単位にグループ化 (1ユーザーの videos.list は50件バッチで1コール単位なので
		// クォータ消費を最小化するため)。
		const byUser = new Map<string, typeof streams>();
		for (const s of streams) {
			let bucket = byUser.get(s.userId);
			if (bucket == null) {
				bucket = [];
				byUser.set(s.userId, bucket);
			}
			bucket.push(s);
		}

		for (const [userId, userStreams] of byUser) {
			const videoIds = userStreams
				.map(s => s.youtubeVideoId)
				.filter((v): v is string => v != null);
			if (videoIds.length === 0) continue;

			let existing: Set<string>;
			try {
				existing = await this.googleYoutubeService.listExistingVideoIds(userId, videoIds);
			} catch (err) {
				// トークン失効/未連携等で確認不能。ユーザー単位でスキップし、何もマークしない
				// (GoogleOAuthService 側でアカウント無効化済みの可能性があるため、ここでは
				// 'failed' 等には落とさない)。次回の health check で連携が復旧していれば再検証される。
				const note = err instanceof GoogleYoutubeNotAuthorizedError ? 'not authorized' : (err instanceof Error ? err.message : String(err));
				this.logger.warn(`skipping user ${userId} (token error: ${note})`);
				continue;
			}

			for (const s of userStreams) {
				const vid = s.youtubeVideoId;
				if (vid == null) continue; // 型上 non-null だが念のため
				if (existing.has(vid)) continue;

				const hasDrive = s.recordingGoogleDriveFileId != null;
				await this.twitchStreamsRepository.update(s.id, {
					youtubeUploadStatus: 'unavailable',
					youtubeVideoId: null,
					youtubeThumbnailUrl: null,
				});
				this.logger.warn(`youtube archive no longer exists, marked unavailable: streamId=${s.id} videoId=${vid} driveFallback=${hasDrive}`);
			}
		}
	}
}
