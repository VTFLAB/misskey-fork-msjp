/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { LiveChannelsRepository, TwitchStreamsRepository } from '@/models/_.js';
import { GoogleDriveService } from '@/core/google/GoogleDriveService.js';
import { GoogleYoutubeService, GoogleYoutubeQuotaExceededError } from '@/core/google/GoogleYoutubeService.js';
import { LiveRecordingService } from '@/core/live/LiveRecordingService.js';
import { GoogleLoggerService } from '@/core/google/GoogleLoggerService.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';

const ERROR_MESSAGE_MAX_LENGTH = 512;

/**
 * YouTube アップロードのクォータ超過リトライキュー (bsky-fork 独自)。
 * QueueService の repeatable job (`youtubeUploadRetry`, 1時間ごと) から呼ばれる。
 * youtubeUploadStatus='queued' (LiveRecordingService.tryYoutubeThenFallback がクォータ超過時に
 * Drive へ一時退避したストリーム) のうち最も古い1件だけを対象に、Drive からダウンロードし直して
 * YouTube への再アップロードを試みる。まだクォータが回復していない場合は何もせず次回に委ねる
 * (youtubeUploadStatus は 'queued' のまま)。
 */
@Injectable()
export class YoutubeUploadRetryProcessorService {
	private logger: Logger;

	constructor(
		@Inject(DI.twitchStreamsRepository)
		private twitchStreamsRepository: TwitchStreamsRepository,

		@Inject(DI.liveChannelsRepository)
		private liveChannelsRepository: LiveChannelsRepository,

		private googleDriveService: GoogleDriveService,
		private googleYoutubeService: GoogleYoutubeService,
		private liveRecordingService: LiveRecordingService,
		private googleLoggerService: GoogleLoggerService,
	) {
		this.logger = this.googleLoggerService.child('youtube-upload-retry');
	}

	@bindThis
	public async process(): Promise<void> {
		const stream = await this.twitchStreamsRepository.findOne({
			where: { youtubeUploadStatus: 'queued' },
			order: { id: 'ASC' },
		});
		if (stream == null) return;

		if (stream.recordingGoogleDriveFileId == null) {
			this.logger.error(`queued stream has no recordingGoogleDriveFileId (streamId=${stream.id}), marking failed`);
			await this.twitchStreamsRepository.update(stream.id, {
				youtubeUploadStatus: 'failed',
				youtubeUploadError: 'リトライ用のDriveファイルが見つかりませんでした。',
			});
			return;
		}

		const liveChannel = await this.liveChannelsRepository.findOneBy({ userId: stream.userId });
		if (liveChannel == null) {
			this.logger.error(`live channel not found for queued stream (streamId=${stream.id}), marking failed`);
			await this.twitchStreamsRepository.update(stream.id, {
				youtubeUploadStatus: 'failed',
				youtubeUploadError: '配信チャンネル設定が見つかりませんでした。',
			});
			return;
		}

		const tmpPath = path.join(os.tmpdir(), `youtube-upload-retry-${stream.id}-${randomUUID()}.mp4`);

		try {
			await this.googleDriveService.downloadFile(stream.userId, stream.recordingGoogleDriveFileId, tmpPath);

			const title = this.liveRecordingService.buildYoutubeTitle(stream, liveChannel);
			const description = this.liveRecordingService.buildYoutubeDescription(stream, liveChannel);

			const result = await this.googleYoutubeService.uploadVideo(stream.userId, tmpPath, {
				title,
				description,
				privacyStatus: liveChannel.youtubePrivacyStatus,
			});

			await this.twitchStreamsRepository.update(stream.id, {
				youtubeUploadStatus: 'ready',
				youtubeVideoId: result.videoId,
			});
			this.logger.info(`retry upload complete: streamId=${stream.id} videoId=${result.videoId}`);

			// Drive 側の一時退避ファイルはもう不要 (YouTube側が正になったため掃除する)
			await this.googleDriveService.deleteFile(stream.userId, stream.recordingGoogleDriveFileId);
			await this.twitchStreamsRepository.update(stream.id, {
				recordingGoogleDriveFileId: null,
				recordingGoogleDriveThumbnailLink: null,
			});
		} catch (err) {
			if (err instanceof GoogleYoutubeQuotaExceededError) {
				this.logger.info(`quota still exceeded, will retry next hour: streamId=${stream.id}`);
				return;
			}
			const message = (err instanceof Error ? err.message : String(err)).slice(0, ERROR_MESSAGE_MAX_LENGTH);
			this.logger.error(`retry upload failed: streamId=${stream.id}: ${message}`);
			await this.twitchStreamsRepository.update(stream.id, {
				youtubeUploadStatus: 'failed',
				youtubeUploadError: message,
			});
		} finally {
			await fs.unlink(tmpPath).catch(() => {});
		}
	}
}
