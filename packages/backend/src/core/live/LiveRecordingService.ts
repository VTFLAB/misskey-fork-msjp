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
import type { MiUser } from '@/models/User.js';
import { GoogleOAuthService } from '@/core/google/GoogleOAuthService.js';
import { GoogleDriveService } from '@/core/google/GoogleDriveService.js';
import { GoogleYoutubeService, GoogleYoutubeQuotaExceededError } from '@/core/google/GoogleYoutubeService.js';
import { summarizeGoogleApiError } from '@/misc/google-api-error.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { LiveLoggerService } from './LiveLoggerService.js';

// OME がファイル (.ts) を閉じる (finalize) のを待つ猶予
const FILE_WAIT_MS = 10 * 1000;
// 録画ファイル特定の mtime 許容幅 (配信の開始/終了と録画ファイルの生成/更新タイミングのずれを吸収)
const FILE_MTIME_MARGIN_MS = 5 * 60 * 1000;
const ERROR_MESSAGE_MAX_LENGTH = 512;
// YouTube は12時間超の動画を削除するため、上限以上の録画は YouTube へ送らず Drive-only とする (bsky-fork 独自)
const YOUTUBE_MAX_DURATION_SEC = 12 * 60 * 60;
// 永続保存先 (Drive/YouTube) を確保できなかった録画のローカル mp4 保持日数 (bsky-fork 独自)
const RETENTION_DAYS = 7;
// retention 既定のエラーメッセージ (uploadToDrive 側で設定された詳細エラーを上書きしないための sentinel)
const RETENTION_DEFAULT_ERROR = 'アーカイブの保存先(Drive/YouTube)を確保できませんでした。録画ファイルは7日間保持されます。';

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
 * クォータ超過以外の失敗 (権限なし・一時エラー等) でも Drive 連携があれば必ず Drive への
 * フォールバック保存を試みる (youtubeUploadStatus='failed' のまま、アーカイブ自体は Drive で存続)。
 * skipped は録画時間が YouTube の12時間上限以上のため YouTube へ送らず Drive-only とした
 * (bsky-fork 独自、YouTube 12時間アーカイブ上限対策)。
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

	/**
	 * 指定ユーザーの配信アーカイブ (Drive/YouTube) が有効かどうかを判定する (bsky-fork 独自)。
	 * stream インスタンス固有の情報 (endedAt 等) に依存しないため、録画開始時点
	 * (TwitchStreamService.markOmeStreamLive) と終了時点 (checkAndStart 経由) の両方で
	 * 同じ判定として使い回せる。
	 */
	@bindThis
	public async isRecordingEnabledForUser(userId: MiUser['id']): Promise<boolean> {
		if (this.config.google == null) return false;
		if (this.config.ome?.recordingsDir == null) return false;

		const liveChannel = await this.liveChannelsRepository.findOneBy({ userId });
		const account = await this.googleOAuthService.getLinkedAccount(userId);
		const youtubeEnabled = liveChannel?.youtubeUploadEnabled ?? false;
		return account != null || youtubeEnabled;
	}

	@bindThis
	private async checkAndStart(stream: MiTwitchStream): Promise<void> {
		if (stream.source !== 'ome') return;
		if (stream.recordingStatus !== 'none') return;
		if (!await this.isRecordingEnabledForUser(stream.userId)) return;

		// isRecordingEnabledForUser が true を返した時点で recordingsDir は non-null 確定だが、
		// TypeScript の型を絞り込むためにここでも参照する。
		const recordingsDir = this.config.ome?.recordingsDir;
		if (recordingsDir == null) return;

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

			// 録画時間を計測 (ffprobe)。失敗時は配信期間 (startedAt〜endedAt) で近似する (bsky-fork 独自)。
			// YouTube は12時間超の動画を削除するため、長時間録画は YouTube へ送らず Drive-only とする。
			let durationSec = await this.probeDurationSec(mp4Path);
			if (durationSec == null) {
				durationSec = Math.max(0, ((stream.endedAt?.getTime() ?? Date.now()) - stream.startedAt.getTime()) / 1000);
			}

			const fileName = this.buildFileName(stream);

			// YouTube優先+Driveフォールバック方式 (bsky-fork 独自)。youtubeUploadEnabled が無効なら
			// 従来通り Drive-only。有効かつ録画時間が YouTube 12時間上限以上なら YouTube へは送らず
			// Drive-only (skipped)。有効かつ12時間未満なら YouTube への優先アップロードを試み、
			// クォータ超過時のみ Drive へ一時退避し、1時間ごとのリトライキューに委ねる。
			const tooLong = durationSec >= YOUTUBE_MAX_DURATION_SEC;
			if (liveChannel.youtubeUploadEnabled && tooLong) {
				this.logger.warn(`recording exceeds YouTube 12h limit, routing to Drive-only: streamId=${streamId} durationSec=${Math.round(durationSec)}`);
				await this.twitchStreamsRepository.update(streamId, { youtubeUploadStatus: 'skipped' });
				await this.uploadToDrive(streamId, stream.userId, mp4Path, fileName);
			} else if (liveChannel.youtubeUploadEnabled) {
				await this.tryYoutubeThenFallback(streamId, stream, liveChannel, mp4Path, fileName);
			} else {
				await this.uploadToDrive(streamId, stream.userId, mp4Path, fileName);
			}

			// retention-aware 後始末 (bsky-fork 独自)。永続保存先 (Drive/YouTube) が1つでも確保されて
			// いれば .ts/.mp4 とも削除。1つも無ければ .ts のみ削除し .mp4 は7日間保持する
			// (RecordingRetentionCleanupProcessorService が期限超過で削除)。
			const after = await this.twitchStreamsRepository.findOneBy({ id: streamId });
			const durable = after != null && (after.recordingGoogleDriveFileId != null || after.youtubeVideoId != null);
			await this.cleanupFiles(tsPath);
			if (durable) {
				await this.cleanupFiles(mp4Path);
			} else {
				await this.retainForRecovery(streamId, mp4Path);
			}
		} catch (err) {
			const message = summarizeGoogleApiError(err, ERROR_MESSAGE_MAX_LENGTH);
			this.logger.error(`recording failed: streamId=${streamId}: ${message}`);
			// 例外発生時も recordingError を先に設定し、その後 retention で上書きしないよう guard する。
			// .ts は常に削除 (容量保護)。.mp4 は retainForRecovery で7日間保持する。
			await this.twitchStreamsRepository.update(streamId, {
				recordingStatus: 'failed',
				recordingError: message,
			});
			await this.cleanupFiles(tsPath);
			if (mp4Path != null) {
				await this.retainForRecovery(streamId, mp4Path);
			}
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
	 * ffprobe で mp4 の再生時間 (秒) を取得する (bsky-fork 独自)。
	 * エラー時または非正の duration を検出した場合は null を返す (呼び出し元で配信期間から近似する)。
	 * 非正の duration を null 扱いにするのは、壊れた/ゼロ秒のメタデータを正当と誤認して
	 * 12時間未満と判定されると YouTube へ送信後に削除されるため (本機能が防ぐべき失敗)。
	 * 30秒のタイムアウトを設け、ffprobe が hung してもパイプラインを止めない。
	 */
	@bindThis
	private async probeDurationSec(mp4Path: string): Promise<number | null> {
		return await new Promise<number | null>(resolve => {
			let settled = false;
			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				resolve(null);
			}, 30 * 1000);

			const finish = (value: number | null): void => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(value);
			};

			try {
				FFmpeg.ffprobe(mp4Path, (err, metadata) => {
					if (err != null) {
						finish(null);
						return;
					}
					// fluent-ffmpeg の型定義上は metadata.format は必須だが、 corrupt な mp4 では
					// undefined になりうる実行時挙動を念のため optional chaining で吸収する。
					const d = (metadata as { format?: { duration?: unknown } } | undefined)?.format?.duration;
					// 0 や NaN/Infinity 等の非正・非有限値は null 扱いにし、呼び出し元で
					// startedAt→endedAt の近似値へフォールバックさせる。
					finish(typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : null);
				});
			} catch {
				finish(null);
			}
		});
	}

	/**
	 * 永続保存先 (Drive/YouTube) を確保できなかった録画の mp4 を7日間ローカルに保持する (bsky-fork 独自)。
	 * recordingRetentionExpiresAt を設定し、recordingFilePath を再確認する。
	 * recordingStatus が既に 'failed' でなければ 'failed' に設定し、recordingError が未設定の場合のみ
	 * 既定のエラーメッセージを入れる (uploadToDrive / catch 側で設定された詳細エラーを上書きしない)。
	 * RecordingRetentionCleanupProcessorService が期限超過でローカルファイルを削除する。
	 */
	@bindThis
	private async retainForRecovery(streamId: MiTwitchStream['id'], mp4Path: string): Promise<void> {
		const current = await this.twitchStreamsRepository.findOneBy({ id: streamId });
		const patch: Partial<MiTwitchStream> = {
			recordingRetentionExpiresAt: new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
			recordingFilePath: mp4Path,
		};
		if (current != null && current.recordingStatus !== 'failed') {
			patch.recordingStatus = 'failed';
		}
		if (current != null && (current.recordingError == null || current.recordingError.length === 0)) {
			patch.recordingError = RETENTION_DEFAULT_ERROR;
		}
		await this.twitchStreamsRepository.update(streamId, patch);
		this.logger.warn(`recording retained for ${RETENTION_DAYS}d (no durable copy): streamId=${streamId} path=${mp4Path}`);
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
			// Drive 未連携 (YouTube のみ有効なケース、または12時間超で YouTube スキップしたケース)。
			// 永続保存先が1つも無い状態なので failed とし、recordingRetentionExpiresAt の設定は
			// 呼び出し元 (processRecording 末尾の retention-aware cleanup) に委ねる。
			// 以前は 'ready' に進めていたが、これは Drive ファイルが無いのに再生可能と誤表示する原因となる。
			await this.twitchStreamsRepository.update(streamId, {
				recordingStatus: 'failed',
				recordingError: 'Google Drive未連携のためアーカイブを保存できませんでした。',
			});
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
			const message = summarizeGoogleApiError(err, ERROR_MESSAGE_MAX_LENGTH);
			this.logger.error(`drive upload failed: streamId=${streamId}: ${message}`);
			await this.twitchStreamsRepository.update(streamId, {
				recordingStatus: 'failed',
				recordingError: message,
			});
		}
	}

	/**
	 * YouTube 優先アップロード + Drive フォールバック (bsky-fork 独自)。
	 * liveChannel.youtubeUploadEnabled が有効なケースの唯一の入口 (processRecording から呼ばれる)。
	 *
	 * YouTube 側がどの種別で失敗しても (権限なし・クォータ超過・一時エラーのリトライ枯渇等)、
	 * Drive 連携があれば必ず Drive へのフォールバック保存を試みる。
	 * 従来はクォータ超過のみフォールバックし、それ以外の失敗では Drive 連携済みでも永続コピー
	 * ゼロのまま retention 行きになっていた (2026-08-01 に Google の一時 408 で実際に発生)。
	 *
	 * - YouTube 成功: youtubeUploadStatus='ready' + recordingStatus='ready'
	 * - クォータ超過: Drive 退避成功なら youtubeUploadStatus='queued' (1時間ごとの
	 *   YoutubeUploadRetryProcessorService が再試行)、Drive も失敗なら 'failed'
	 * - その他の失敗: youtubeUploadStatus='failed' (自動再試行なし)。Drive 保存が成功すれば
	 *   アーカイブ自体は recordingStatus='ready' で存続する
	 * - Drive 未連携 / Drive も失敗: recordingStatus='failed' → processRecording 末尾の
	 *   retention-aware cleanup が mp4 を7日間保持する (retainForRecovery 参照)
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

		// クォータ超過だけは Drive 退避成功時に 'queued' (1時間ごとの自動リトライ対象) へ進める。
		// それ以外の失敗は 'failed' のまま Drive フォールバックのみ行う
		let quotaExceeded = false;

		if (!await this.googleYoutubeService.isAuthorizedForUpload(stream.userId)) {
			await this.twitchStreamsRepository.update(streamId, {
				youtubeUploadStatus: 'failed',
				youtubeUploadError: 'YouTubeアップロード権限がありません。設定画面から再連携してください。',
			});
			this.logger.warn(`youtube not authorized, falling back to Drive: streamId=${streamId}`);
		} else {
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
					youtubeThumbnailUrl: result.thumbnailUrl,
					recordingStatus: 'ready',
				});
				this.logger.info(`youtube upload complete: streamId=${streamId} videoId=${result.videoId}`);
				return;
			} catch (err) {
				if (err instanceof GoogleYoutubeQuotaExceededError) {
					quotaExceeded = true;
					this.logger.warn(`youtube quota exceeded, falling back to Drive: streamId=${streamId}`);
				} else {
					const message = summarizeGoogleApiError(err, ERROR_MESSAGE_MAX_LENGTH);
					this.logger.error(`youtube upload failed, falling back to Drive: streamId=${streamId}: ${message}`);
					await this.twitchStreamsRepository.update(streamId, {
						youtubeUploadStatus: 'failed',
						youtubeUploadError: message,
					});
				}
			}
		}

		// Drive フォールバック (YouTube 側の失敗種別を問わず必ず試みる)
		const account = await this.googleOAuthService.getLinkedAccount(stream.userId);
		if (account == null) {
			const patch: Partial<MiTwitchStream> = {
				recordingStatus: 'failed',
				recordingError: 'Google Drive未連携のためフォールバック保存できませんでした。',
			};
			if (quotaExceeded) {
				patch.youtubeUploadStatus = 'failed';
				patch.youtubeUploadError = 'YouTubeのアップロード上限に達し、Driveへの一時保存にも失敗しました。';
			}
			await this.twitchStreamsRepository.update(streamId, patch);
			return;
		}

		try {
			const uploaded = await this.googleDriveService.uploadRecording(stream.userId, mp4Path, fileName);
			const patch: Partial<MiTwitchStream> = {
				recordingStatus: 'ready',
				recordingGoogleDriveFileId: uploaded.fileId,
				recordingGoogleDriveThumbnailLink: uploaded.thumbnailLink,
			};
			if (quotaExceeded) {
				patch.youtubeUploadStatus = 'queued';
			}
			await this.twitchStreamsRepository.update(streamId, patch);
			this.logger.info(`drive fallback upload complete: streamId=${streamId} fileId=${uploaded.fileId}${quotaExceeded ? ' (youtube queued)' : ''}`);
		} catch (err) {
			const message = summarizeGoogleApiError(err, ERROR_MESSAGE_MAX_LENGTH);
			this.logger.error(`drive fallback upload failed: streamId=${streamId}: ${message}`);
			const patch: Partial<MiTwitchStream> = {
				recordingStatus: 'failed',
				recordingError: message,
			};
			if (quotaExceeded) {
				patch.youtubeUploadStatus = 'failed';
				patch.youtubeUploadError = 'YouTubeのアップロード上限に達し、Driveへの一時保存にも失敗しました。';
			}
			await this.twitchStreamsRepository.update(streamId, patch);
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

	/**
	 * retention 期間中の録画 mp4 を Google Drive へ再アップロードする (bsky-fork 独自、YouTube 12時間
	 * アーカイブ上限対策の owner action)。「永続保存先が無いまま failed になったがローカル mp4 はまだ
	 * 残っている」状態 (recordingRetentionExpiresAt != null && recordingFilePath != null) から、
	 * 配信者本人が手動で Drive への保存を再試行するために呼ぶ。成功時は通常の uploadToDrive と同様に
	 * retention を解除 (recordingRetentionExpiresAt/Path/Size/Error をクリア) し、失敗時は retention を
	 * 7日延長して再度の再試行を許す。uploadToDrive と異なり Google Drive 未連携の場合は呼び出し元で
	 * 事前チェックするのではなく、ここで Error を throw する (このメソッドは endpoint からのみ呼ばれ、
	 * endpoint が ApiError に変換するため)。
	 */
	@bindThis
	public async retryDriveUploadFromRetention(
		streamId: MiTwitchStream['id'],
		userId: MiUser['id'],
	): Promise<{ fileId: string; thumbnailLink: string | null }> {
		const stream = await this.twitchStreamsRepository.findOneBy({ id: streamId });
		if (stream == null) throw new Error('stream not found');
		if (stream.recordingFilePath == null || stream.recordingRetentionExpiresAt == null) {
			throw new Error('not under retention');
		}

		// ファイルが retention cleanup 等で既に削除されている可能性があるので stat で確認する。
		let stat;
		try {
			stat = await fs.stat(stream.recordingFilePath);
		} catch {
			throw new Error('retained file not found (already purged?)');
		}
		if (!stat.isFile()) {
			throw new Error('retained file not found (already purged?)');
		}

		const account = await this.googleOAuthService.getLinkedAccount(userId);
		if (account == null) {
			throw new Error('Google Drive not linked');
		}

		const fileName = this.buildFileName(stream);

		await this.twitchStreamsRepository.update(streamId, { recordingStatus: 'uploading' });

		try {
			const uploaded = await this.googleDriveService.uploadRecording(userId, stream.recordingFilePath, fileName);
			await this.twitchStreamsRepository.update(streamId, {
				recordingStatus: uploaded.thumbnailLink != null ? 'ready' : 'processing',
				recordingGoogleDriveFileId: uploaded.fileId,
				recordingGoogleDriveThumbnailLink: uploaded.thumbnailLink,
				recordingRetentionExpiresAt: null,
				recordingFilePath: null,
				recordingFileSize: null,
				recordingError: null,
			});
			this.logger.info(`recording retry-uploaded from retention: streamId=${streamId} fileId=${uploaded.fileId}`);
			return uploaded;
		} catch (err) {
			const message = summarizeGoogleApiError(err, ERROR_MESSAGE_MAX_LENGTH);
			this.logger.error(`retry drive upload from retention failed: streamId=${streamId}: ${message}`);
			// retention を延長して再度の再試行を許す。ローカル mp4 はそのまま残す。
			await this.twitchStreamsRepository.update(streamId, {
				recordingStatus: 'failed',
				recordingError: message,
				recordingRetentionExpiresAt: new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
			});
			throw err;
		}
	}

	@bindThis
	private async cleanupFiles(...paths: (string | undefined)[]): Promise<void> {
		for (const p of paths) {
			if (p == null) continue;
			await fs.unlink(p).catch(() => {});
		}
	}
}
