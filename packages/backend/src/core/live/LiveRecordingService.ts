/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import FFmpeg from 'fluent-ffmpeg';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { LiveChannelsRepository, TwitchStreamsRepository } from '@/models/_.js';
import { MiTwitchStream } from '@/models/TwitchStream.js';
import type { MiLiveChannel } from '@/models/LiveChannel.js';
import { GoogleOAuthService } from '@/core/google/GoogleOAuthService.js';
import { GoogleDriveService } from '@/core/google/GoogleDriveService.js';
import { GoogleYoutubeService, GoogleYoutubeQuotaExceededError } from '@/core/google/GoogleYoutubeService.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { LiveLoggerService } from './LiveLoggerService.js';

// OME がファイル (.ts) を閉じる (finalize) のを待つ猶予
const FILE_WAIT_MS = 10 * 1000;
// 録画ファイル特定の mtime 許容幅 (配信の開始/終了と録画ファイルの生成/更新タイミングのずれを吸収)
const FILE_MTIME_MARGIN_MS = 5 * 60 * 1000;
const ERROR_MESSAGE_MAX_LENGTH = 512;

/**
 * 配信終了後の録画アーカイブパイプライン (bsky-fork 独自)。
 * TwitchStreamService.markOmeStreamEnded から fire-and-forget で起動される。
 * 循環依存を避けるため TwitchStreamService には依存しない (recordingStatus 等は
 * twitchStreamsRepository を直接叩いて更新する)。
 *
 * ステータス遷移: none → pending → remuxing → uploading → processing/ready / failed
 *
 * YouTube (youtubeUploadStatus): liveChannel.youtubeUploadEnabled === false なら Drive-only
 * (recordingStatus のみで完結)。true なら「YouTube優先+Driveフォールバック+リトライキュー」方式
 * (tryYoutubeThenFallback 参照): none → uploading → ready / failed / queued
 * (queued はクォータ超過で Drive へ一時退避済み、YoutubeUploadRetryProcessorService の
 * 1時間ごとの自動リトライ対象。ユーザーが明示キャンセルすると cancelled)。
 */
@Injectable()
export class LiveRecordingService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.twitchStreamsRepository)
		private twitchStreamsRepository: TwitchStreamsRepository,

		@Inject(DI.liveChannelsRepository)
		private liveChannelsRepository: LiveChannelsRepository,

		private googleOAuthService: GoogleOAuthService,
		private googleDriveService: GoogleDriveService,
		private googleYoutubeService: GoogleYoutubeService,
		private liveLoggerService: LiveLoggerService,
	) {
		this.logger = this.liveLoggerService.child('recording');
	}

	/**
	 * 配信終了フックから呼ばれるエントリポイント。条件を満たさない場合は何もしない
	 * (recordingStatus は 'none' のまま、掃除は行わない)。
	 */
	@bindThis
	public triggerRecording(stream: MiTwitchStream): void {
		this.checkAndStart(stream).catch(err => {
			this.logger.error(`triggerRecording failed unexpectedly (streamId=${stream.id}): ${err instanceof Error ? err.message : err}`);
		});
	}

	@bindThis
	private async checkAndStart(stream: MiTwitchStream): Promise<void> {
		if (stream.source !== 'ome') return;
		if (stream.recordingStatus !== 'none') return;
		if (this.config.google == null) return;

		const recordingsDir = this.config.ome?.recordingsDir;
		if (recordingsDir == null) return;

		// Drive/YouTube いずれも無効ならこのフックは何もしない (bsky-fork 独自)。
		const liveChannel = await this.liveChannelsRepository.findOneBy({ userId: stream.userId });
		const account = await this.googleOAuthService.getLinkedAccount(stream.userId);
		const driveEnabled = account != null;
		const youtubeEnabled = liveChannel?.youtubeUploadEnabled ?? false;
		if (!driveEnabled && !youtubeEnabled) return;

		await this.twitchStreamsRepository.update(stream.id, { recordingStatus: 'pending' });
		this.logger.info(`recording pending: streamId=${stream.id} user=${stream.userId}`);

		this.processRecording(stream.id, recordingsDir).catch(err => {
			// processRecording 内の catch を抜けてきた想定外エラーの二重防御
			this.logger.error(`processRecording failed unexpectedly (streamId=${stream.id}): ${err instanceof Error ? err.message : err}`);
		});
	}

	@bindThis
	private async processRecording(streamId: MiTwitchStream['id'], recordingsDir: string): Promise<void> {
		let tsPath: string | undefined;
		let mp4Path: string | undefined;

		try {
			const stream = await this.twitchStreamsRepository.findOneBy({ id: streamId });
			if (stream == null) return;

			await new Promise(resolve => setTimeout(resolve, FILE_WAIT_MS));

			const liveChannel = await this.liveChannelsRepository.findOneBy({ userId: stream.userId });
			if (liveChannel == null) {
				throw new Error('live channel not found (streamKey unavailable)');
			}

			tsPath = (await this.findRecordingFile(recordingsDir, liveChannel.streamKey, stream.startedAt, stream.endedAt ?? new Date())) ?? undefined;
			if (tsPath == null) {
				throw new Error(`recording file not found (streamKey=${liveChannel.streamKey})`);
			}

			await this.twitchStreamsRepository.update(streamId, { recordingStatus: 'remuxing' });
			mp4Path = tsPath.replace(/\.ts$/, '.mp4');
			await this.remux(tsPath, mp4Path);

			const fileStat = await fs.stat(mp4Path);
			await this.twitchStreamsRepository.update(streamId, {
				recordingFilePath: mp4Path,
				recordingFileSize: String(fileStat.size),
			});

			const fileName = this.buildFileName(stream);

			// YouTube優先+Driveフォールバック方式 (bsky-fork 独自)。youtubeUploadEnabled が無効なら
			// 従来通り Drive-only。有効なら YouTube への優先アップロードを試み、クォータ超過時のみ
			// Drive へ一時退避し、1時間ごとのリトライキュー (YoutubeUploadRetryProcessorService) に委ねる。
			if (!liveChannel.youtubeUploadEnabled) {
				await this.uploadToDrive(streamId, stream.userId, mp4Path, fileName);
			} else {
				await this.tryYoutubeThenFallback(streamId, stream, liveChannel, mp4Path, fileName);
			}

			await this.cleanupFiles(tsPath, mp4Path);
		} catch (err) {
			const message = (err instanceof Error ? err.message : String(err)).slice(0, ERROR_MESSAGE_MAX_LENGTH);
			this.logger.error(`recording failed: streamId=${streamId}: ${message}`);
			await this.twitchStreamsRepository.update(streamId, {
				recordingStatus: 'failed',
				recordingError: message,
			});
			// 失敗時もローカルファイルは残さない (容量保護)
			await this.cleanupFiles(tsPath, mp4Path);
		}
	}

	/**
	 * `*_${streamKey}.ts` に一致するファイルのうち、配信期間 (±5分マージン) の mtime を持つ
	 * 最新の1つを返す。readdir の結果しか path.join しないため path traversal の余地は無いが、
	 * recordingsDir 配下であることを念のため確認する。
	 */
	@bindThis
	private async findRecordingFile(recordingsDir: string, streamKey: string, startedAt: Date, endedAt: Date): Promise<string | null> {
		const resolvedDir = path.resolve(recordingsDir);
		let entries: string[];
		try {
			entries = await fs.readdir(resolvedDir);
		} catch (err) {
			throw new Error(`failed to read recordings dir: ${err instanceof Error ? err.message : err}`);
		}

		const suffix = `_${streamKey}.ts`;
		const candidates = entries.filter(name => name.endsWith(suffix));

		const minMtime = startedAt.getTime() - FILE_MTIME_MARGIN_MS;
		const maxMtime = endedAt.getTime() + FILE_MTIME_MARGIN_MS;

		let best: { path: string; mtimeMs: number } | null = null;
		for (const name of candidates) {
			const candidatePath = path.join(resolvedDir, name);
			if (!candidatePath.startsWith(resolvedDir + path.sep)) continue;

			const stat = await fs.stat(candidatePath).catch(() => null);
			if (stat == null) continue;
			if (stat.mtimeMs < minMtime || stat.mtimeMs > maxMtime) continue;

			if (best == null || stat.mtimeMs > best.mtimeMs) {
				best = { path: candidatePath, mtimeMs: stat.mtimeMs };
			}
		}

		return best?.path ?? null;
	}

	@bindThis
	private async remux(inputPath: string, outputPath: string): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			FFmpeg(inputPath)
				.outputOptions(['-c', 'copy'])
				.on('end', () => resolve())
				.on('error', err => reject(err))
				.save(outputPath);
		});
	}

	/**
	 * Google Drive へのアップロード (bsky-fork 独自)。連携済みアカウントがある場合のみ実行する
	 * (Drive 側には ON/OFF トグルが無いため、連携済みなら常にアップロードする既存挙動を維持)。
	 * 成功/失敗の記録は recordingStatus/recordingError に反映する (既存ロジックのまま)。
	 */
	@bindThis
	private async uploadToDrive(streamId: MiTwitchStream['id'], userId: MiTwitchStream['userId'], mp4Path: string, fileName: string): Promise<void> {
		const account = await this.googleOAuthService.getLinkedAccount(userId);
		if (account == null) {
			// Drive 未連携 (YouTube のみ有効なケース)。recordingStatus は L115 で 'remuxing' のまま
			// 止まっているので、ここで 'ready' に進めておかないとフロントの archives 判定・ポーリングが
			// 永久に "処理中" のまま止まってしまう (recordingGoogleDriveFileId は null のまま = Drive分は無し)。
			await this.twitchStreamsRepository.update(streamId, { recordingStatus: 'ready' });
			return;
		}

		try {
			await this.twitchStreamsRepository.update(streamId, { recordingStatus: 'uploading' });
			const uploaded = await this.googleDriveService.uploadRecording(userId, mp4Path, fileName);

			await this.twitchStreamsRepository.update(streamId, {
				recordingStatus: uploaded.thumbnailLink != null ? 'ready' : 'processing',
				recordingGoogleDriveFileId: uploaded.fileId,
				recordingGoogleDriveThumbnailLink: uploaded.thumbnailLink,
			});
			this.logger.info(`recording archived: streamId=${streamId} fileId=${uploaded.fileId}`);
		} catch (err) {
			const message = (err instanceof Error ? err.message : String(err)).slice(0, ERROR_MESSAGE_MAX_LENGTH);
			this.logger.error(`drive upload failed: streamId=${streamId}: ${message}`);
			await this.twitchStreamsRepository.update(streamId, {
				recordingStatus: 'failed',
				recordingError: message,
			});
		}
	}

	/**
	 * YouTube 優先アップロード + クォータ超過時の Drive フォールバック (bsky-fork 独自)。
	 * liveChannel.youtubeUploadEnabled が有効なケースの唯一の入口 (processRecording から呼ばれる)。
	 *
	 * 1. youtube.upload スコープの許可を確認 (未許可なら failed、Drive未使用のままスピナー固着を防ぐため
	 *    recordingStatus は 'ready' に進める)
	 * 2. YouTube へのアップロードを試行
	 *    - 成功: youtubeUploadStatus='ready' + recordingStatus='ready'
	 *    - クォータ超過 (GoogleYoutubeQuotaExceededError): Drive へのフォールバックを試みる
	 *      - Drive 未連携 / フォールバック自体が失敗: youtubeUploadStatus='failed' + recordingStatus='failed'
	 *      - フォールバック成功: youtubeUploadStatus='queued' (1時間ごとの YoutubeUploadRetryProcessorService
	 *        がこの状態を拾って再試行する) + recordingStatus='ready' (Drive側で一時視聴可能なため)
	 *    - その他のエラー: youtubeUploadStatus='failed' + recordingStatus='ready'
	 */
	@bindThis
	private async tryYoutubeThenFallback(
		streamId: MiTwitchStream['id'],
		stream: MiTwitchStream,
		liveChannel: MiLiveChannel,
		mp4Path: string,
		fileName: string,
	): Promise<void> {
		await this.twitchStreamsRepository.update(streamId, { youtubeUploadStatus: 'uploading' });

		if (!await this.googleYoutubeService.isAuthorizedForUpload(stream.userId)) {
			await this.twitchStreamsRepository.update(streamId, {
				youtubeUploadStatus: 'failed',
				youtubeUploadError: 'YouTubeアップロード権限がありません。設定画面から再連携してください。',
				recordingStatus: 'ready',
			});
			return;
		}

		const title = this.buildYoutubeTitle(stream, liveChannel);
		const description = this.buildYoutubeDescription(stream, liveChannel);

		try {
			const result = await this.googleYoutubeService.uploadVideo(stream.userId, mp4Path, {
				title,
				description,
				privacyStatus: liveChannel.youtubePrivacyStatus,
			});

			await this.twitchStreamsRepository.update(streamId, {
				youtubeUploadStatus: 'ready',
				youtubeVideoId: result.videoId,
				recordingStatus: 'ready',
			});
			this.logger.info(`youtube upload complete: streamId=${streamId} videoId=${result.videoId}`);
			return;
		} catch (err) {
			if (!(err instanceof GoogleYoutubeQuotaExceededError)) {
				const message = (err instanceof Error ? err.message : String(err)).slice(0, ERROR_MESSAGE_MAX_LENGTH);
				this.logger.error(`youtube upload failed: streamId=${streamId}: ${message}`);
				await this.twitchStreamsRepository.update(streamId, {
					youtubeUploadStatus: 'failed',
					youtubeUploadError: message,
					recordingStatus: 'ready',
				});
				return;
			}
			this.logger.warn(`youtube quota exceeded, falling back to Drive: streamId=${streamId}`);
		}

		const account = await this.googleOAuthService.getLinkedAccount(stream.userId);
		if (account == null) {
			await this.twitchStreamsRepository.update(streamId, {
				youtubeUploadStatus: 'failed',
				youtubeUploadError: 'YouTubeのアップロード上限に達し、Driveへの一時保存にも失敗しました。',
				recordingStatus: 'failed',
				recordingError: 'Google Drive未連携のためフォールバック保存できませんでした。',
			});
			return;
		}

		try {
			const uploaded = await this.googleDriveService.uploadRecording(stream.userId, mp4Path, fileName);
			await this.twitchStreamsRepository.update(streamId, {
				youtubeUploadStatus: 'queued',
				recordingStatus: 'ready',
				recordingGoogleDriveFileId: uploaded.fileId,
				recordingGoogleDriveThumbnailLink: uploaded.thumbnailLink,
			});
			this.logger.info(`youtube upload queued (drive fallback): streamId=${streamId} fileId=${uploaded.fileId}`);
		} catch (err) {
			const message = (err instanceof Error ? err.message : String(err)).slice(0, ERROR_MESSAGE_MAX_LENGTH);
			this.logger.error(`drive fallback upload failed: streamId=${streamId}: ${message}`);
			await this.twitchStreamsRepository.update(streamId, {
				youtubeUploadStatus: 'failed',
				youtubeUploadError: 'YouTubeのアップロード上限に達し、Driveへの一時保存にも失敗しました。',
				recordingStatus: 'failed',
				recordingError: message,
			});
		}
	}

	@bindThis
	private buildFileName(stream: MiTwitchStream): string {
		const label = stream.title.trim().length > 0 ? stream.title.trim() : 'Live';
		const dateStr = this.formatDateTime(stream.startedAt);
		// Drive 上のファイル名として問題になりうる文字 (パス区切り等) を除去
		const sanitizedLabel = label.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100);
		return `${sanitizedLabel} ${dateStr}.mp4`;
	}

	@bindThis
	private formatDateTime(date: Date): string {
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
	}

	/**
	 * YouTube 動画タイトルをテンプレートから生成する (bsky-fork 独自)。
	 * TwitchStreamService.postAutoStartNote の replaceAll パターンを踏襲。
	 * YouTube Data API の title 制限 (100文字) を超えないよう最終的に切り詰める。
	 * YoutubeUploadRetryProcessorService からも呼べるよう public にしている。
	 */
	@bindThis
	public buildYoutubeTitle(stream: MiTwitchStream, liveChannel: MiLiveChannel): string {
		const template = liveChannel.youtubeTitleTemplate ?? '{title} ({date})';
		const label = stream.title.trim().length > 0 ? stream.title.trim() : 'Live';
		const built = template
			.replaceAll('{title}', label)
			.replaceAll('{date}', this.formatDateTime(stream.startedAt))
			.replaceAll('{channelName}', liveChannel.name ?? '')
			.trim();
		return (built.length > 0 ? built : 'Live').slice(0, 100);
	}

	/**
	 * YouTube 動画概要欄をテンプレートから生成する (bsky-fork 独自)。
	 * YouTube Data API の description 制限 (5000文字) を超えないよう最終的に切り詰める。
	 * YoutubeUploadRetryProcessorService からも呼べるよう public にしている。
	 */
	@bindThis
	public buildYoutubeDescription(stream: MiTwitchStream, liveChannel: MiLiveChannel): string {
		const template = liveChannel.youtubeDescriptionTemplate ?? '配信アーカイブ: {channelName}';
		const label = stream.title.trim().length > 0 ? stream.title.trim() : 'Live';
		const built = template
			.replaceAll('{title}', label)
			.replaceAll('{date}', this.formatDateTime(stream.startedAt))
			.replaceAll('{channelName}', liveChannel.name ?? '');
		return built.slice(0, 5000);
	}

	@bindThis
	private async cleanupFiles(...paths: (string | undefined)[]): Promise<void> {
		for (const p of paths) {
			if (p == null) continue;
			await fs.unlink(p).catch(() => {});
		}
	}
}
