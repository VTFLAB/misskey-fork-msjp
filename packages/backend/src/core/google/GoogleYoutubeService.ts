/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs';
import { Injectable } from '@nestjs/common';
import { auth as googleAuth, youtube, youtube_v3 } from '@googleapis/youtube';
import type { MiUser } from '@/models/User.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { GoogleOAuthService } from './GoogleOAuthService.js';
import { GoogleLoggerService } from './GoogleLoggerService.js';

const YOUTUBE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';

export type UploadVideoParams = {
	title: string;
	description: string;
	privacyStatus: 'public' | 'unlisted' | 'private';
};

export type UploadVideoResult = {
	videoId: string;
	thumbnailUrl: string | null;
};

export class GoogleYoutubeNotAuthorizedError extends Error {
	constructor(userId: string) {
		super(`No valid Google access token with youtube.upload scope for user ${userId}.`);
		this.name = 'GoogleYoutubeNotAuthorizedError';
	}
}

export class GoogleYoutubeQuotaExceededError extends Error {
	constructor(userId: string) {
		super(`YouTube Data API quota exceeded for user ${userId}.`);
		this.name = 'GoogleYoutubeQuotaExceededError';
	}
}

/**
 * @googleapis/drive の GaxiosError (googleapis-common 経由の再エクスポート) を backend の
 * 直接 dependency にはせずダックタイピングで判定する。YouTube Data API のクォータ超過は
 * HTTP 403 + response body に reason: "quotaExceeded" を含む形で返る。
 */
function isQuotaExceededError(err: unknown): boolean {
	if (err == null || typeof err !== 'object') return false;
	const status = (err as { status?: number; response?: { status?: number; data?: unknown } }).status
		?? (err as { response?: { status?: number } }).response?.status;
	if (status !== 403) return false;

	const data = (err as { response?: { data?: unknown } }).response?.data;
	let body: string;
	try {
		body = typeof data === 'string' ? data : JSON.stringify(data ?? '');
	} catch {
		body = '';
	}
	return body.includes('quotaExceeded');
}

/**
 * 配信アーカイブの YouTube アップロード/状態照会 (bsky-fork 独自)。
 * granular consent で drive.file のみ許可され youtube.upload が拒否されているケースがあるため、
 * アクセストークンの有効性だけでなく実際に許可された scopes も都度確認する。
 */
@Injectable()
export class GoogleYoutubeService {
	private logger: Logger;

	constructor(
		private googleOAuthService: GoogleOAuthService,
		private googleLoggerService: GoogleLoggerService,
	) {
		this.logger = this.googleLoggerService.child('youtube');
	}

	/**
	 * リンク済み Google アカウントが YouTube 側の連携 (youtube.upload スコープの独立した OAuth グラント)
	 * を完了しているかどうか。Drive 用トークンとは別カラムで管理されているため、
	 * youtubeRefreshToken の有無 + youtubeScopes を確認する。
	 */
	@bindThis
	public async isAuthorizedForUpload(userId: MiUser['id']): Promise<boolean> {
		const account = await this.googleOAuthService.getLinkedAccount(userId);
		return account?.youtubeRefreshToken != null && (account?.youtubeScopes.includes(YOUTUBE_UPLOAD_SCOPE) ?? false);
	}

	/**
	 * 録画ファイルを YouTube にアップロードする。ファイルサイズが大きいため media.body に
	 * ReadStream を渡し、googleapis-common に resumable upload を自動選択させる
	 * (GoogleDriveService.uploadRecording と同じ方針)。
	 */
	@bindThis
	public async uploadVideo(userId: MiUser['id'], filePath: string, params: UploadVideoParams): Promise<UploadVideoResult> {
		if (!await this.isAuthorizedForUpload(userId)) {
			throw new GoogleYoutubeNotAuthorizedError(userId);
		}

		const youtubeClient = await this.buildClient(userId);

		try {
			const created = await youtubeClient.videos.insert({
				part: ['snippet', 'status'],
				requestBody: {
					snippet: {
						title: params.title,
						description: params.description,
						categoryId: '24',
					},
					status: {
						privacyStatus: params.privacyStatus,
						selfDeclaredMadeForKids: false,
						embeddable: true, // bsky-fork 独自: MSJP内埋め込み再生のため明示的に許可
					},
				},
				media: {
					body: fs.createReadStream(filePath),
				},
			});

			const videoId = created.data.id;
			if (videoId == null) {
				throw new Error('YouTube did not return a video id after upload.');
			}

			const thumbnails = created.data.snippet?.thumbnails;
			const thumbnailUrl = thumbnails?.high?.url ?? thumbnails?.medium?.url ?? thumbnails?.default?.url ?? null;

			this.logger.info(`uploaded video: user=${userId} videoId=${videoId}`);

			return { videoId, thumbnailUrl };
		} catch (err) {
			if (isQuotaExceededError(err)) {
				this.logger.warn(`quota exceeded: user=${userId}`);
				throw new GoogleYoutubeQuotaExceededError(userId);
			}
			throw err;
		}
	}

	@bindThis
	private async buildClient(userId: MiUser['id']): Promise<youtube_v3.Youtube> {
		const accessToken = await this.googleOAuthService.getValidAccessToken(userId, 'youtube');
		if (accessToken == null) {
			throw new GoogleYoutubeNotAuthorizedError(userId);
		}
		// google-auth-library を直接 backend の dependency にせず、@googleapis/youtube が
		// re-export する AuthPlus.OAuth2 (= OAuth2Client) を使う。
		const oauth2Client = new googleAuth.OAuth2();
		oauth2Client.setCredentials({ access_token: accessToken });
		return youtube({ version: 'v3', auth: oauth2Client });
	}
}
