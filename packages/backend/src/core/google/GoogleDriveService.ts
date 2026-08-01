/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Injectable } from '@nestjs/common';
import { auth as googleAuth, drive, drive_v3 } from '@googleapis/drive';
import type { MiUser } from '@/models/User.js';
import { retryOnTransientGoogleApiError } from '@/misc/google-api-error.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { GoogleOAuthService } from './GoogleOAuthService.js';
import { GoogleLoggerService } from './GoogleLoggerService.js';

export type UploadRecordingResult = {
	fileId: string;
	thumbnailLink: string | null;
	webViewLink: string | null;
};

export class GoogleDriveNotAuthorizedError extends Error {
	constructor(userId: string) {
		super(`No valid Google access token for user ${userId}.`);
		this.name = 'GoogleDriveNotAuthorizedError';
	}
}

/**
 * @googleapis/drive の GaxiosError (googleapis-common 経由の再エクスポート) を backend の
 * 直接 dependency にはせずダックタイピングで判定する (GoogleYoutubeService.isQuotaExceededError と同方針)。
 */
function isNotFoundError(err: unknown): boolean {
	if (err == null || typeof err !== 'object') return false;
	const status = (err as { status?: number; response?: { status?: number } }).status
		?? (err as { response?: { status?: number } }).response?.status;
	return status === 404;
}

/**
 * 配信アーカイブの Google Drive アップロード/状態照会 (bsky-fork 独自)。
 * アクセストークンは呼び出しごとに GoogleOAuthService から取得する (失効時は自動 refresh 済み)。
 */
@Injectable()
export class GoogleDriveService {
	private logger: Logger;

	constructor(
		private googleOAuthService: GoogleOAuthService,
		private googleLoggerService: GoogleLoggerService,
	) {
		this.logger = this.googleLoggerService.child('drive');
	}

	/**
	 * 録画ファイルを Google Drive にアップロードし、リンクを知っている全員が閲覧できるよう
	 * anyone/reader 権限を付与する (allowFileDiscovery: false でリンク未共有者からは検索不可にする)。
	 * ファイルサイズが大きいため media.body に ReadStream を渡し、googleapis-common に resumable
	 * upload を自動選択させる。
	 */
	@bindThis
	public async uploadRecording(userId: MiUser['id'], filePath: string, fileName: string): Promise<UploadRecordingResult> {
		const driveClient = await this.buildClient(userId);
		const account = await this.googleOAuthService.getLinkedAccount(userId);

		// Google 側の一時エラー (408/429/5xx 等) はリトライする。消費済み ReadStream は再利用
		// できないため、試行ごとにストリームを作り直す (クロージャ内で createReadStream する理由)
		const created = await retryOnTransientGoogleApiError(() => driveClient.files.create({
			requestBody: {
				name: fileName,
				mimeType: 'video/mp4',
				...(account?.folderId ? { parents: [account.folderId] } : {}),
			},
			media: {
				mimeType: 'video/mp4',
				body: fs.createReadStream(filePath),
			},
			fields: 'id, thumbnailLink, webViewLink',
		}), { label: `drive upload (user=${userId})`, logger: this.logger });

		const fileId = created.data.id;
		if (fileId == null) {
			throw new Error('Google Drive did not return a file id after upload.');
		}

		// 権限付与はアップロード成功後の小さな POST だが、ここで一時エラーに当たると
		// アップロード済みファイルごと失敗扱いになるため同様にリトライする (二重付与は無害)
		await retryOnTransientGoogleApiError(() => driveClient.permissions.create({
			fileId,
			requestBody: {
				type: 'anyone',
				role: 'reader',
				allowFileDiscovery: false,
			},
			fields: 'id',
		}), { label: `drive permission (user=${userId})`, logger: this.logger });

		this.logger.info(`uploaded recording: user=${userId} fileId=${fileId}`);

		return {
			fileId,
			thumbnailLink: created.data.thumbnailLink ?? null,
			webViewLink: created.data.webViewLink ?? null,
		};
	}

	/**
	 * Drive 側のサムネイル生成完了を確認する (アップロード直後は未生成のことが多く、
	 * `google-drive/recording-status` エンドポイントからのポーリングで呼ばれる想定)。
	 */
	@bindThis
	public async checkProcessingStatus(userId: MiUser['id'], fileId: string): Promise<{ thumbnailLink: string | null }> {
		const driveClient = await this.buildClient(userId);
		const res = await driveClient.files.get({
			fileId,
			fields: 'thumbnailLink, videoMediaMetadata',
		});
		return { thumbnailLink: res.data.thumbnailLink ?? null };
	}

	/**
	 * Drive 上のファイルをローカルパスへダウンロードする (bsky-fork 独自)。
	 * YouTube アップロードリトライキュー (YoutubeUploadRetryProcessorService) が、クォータ超過時に
	 * 一時退避した Drive ファイルを再度 YouTube へアップロードする前段として使う。
	 */
	@bindThis
	public async downloadFile(userId: MiUser['id'], fileId: string, destPath: string): Promise<void> {
		const driveClient = await this.buildClient(userId);
		const res = await driveClient.files.get(
			{ fileId, alt: 'media' },
			{ responseType: 'stream' },
		);

		await pipeline(res.data, fs.createWriteStream(destPath));
		this.logger.info(`downloaded file: user=${userId} fileId=${fileId}`);
	}

	/**
	 * Drive 上のファイルを削除する (bsky-fork 独自)。YouTube アップロードリトライキューが
	 * クォータ超過時の一時退避ファイルを、YouTube への再アップロード成功後に掃除するために使う。
	 * 既に削除済み (404) の場合はエラーにしない (二重実行や手動削除に対して冪等)。
	 */
	@bindThis
	public async deleteFile(userId: MiUser['id'], fileId: string): Promise<void> {
		const driveClient = await this.buildClient(userId);
		try {
			await driveClient.files.delete({ fileId });
			this.logger.info(`deleted file: user=${userId} fileId=${fileId}`);
		} catch (err) {
			if (isNotFoundError(err)) {
				this.logger.info(`deleteFile: already gone (fileId=${fileId})`);
				return;
			}
			throw err;
		}
	}

	@bindThis
	private async buildClient(userId: MiUser['id']): Promise<drive_v3.Drive> {
		const accessToken = await this.googleOAuthService.getValidAccessToken(userId);
		if (accessToken == null) {
			throw new GoogleDriveNotAuthorizedError(userId);
		}
		// google-auth-library を直接 backend の dependency にせず、@googleapis/drive が
		// re-export する AuthPlus.OAuth2 (= OAuth2Client) を使う。
		const oauth2Client = new googleAuth.OAuth2();
		oauth2Client.setCredentials({ access_token: accessToken });
		return drive({ version: 'v3', auth: oauth2Client });
	}
}
