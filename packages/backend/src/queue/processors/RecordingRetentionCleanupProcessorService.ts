/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs/promises';
import { Inject, Injectable } from '@nestjs/common';
import { LessThan } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { TwitchStreamsRepository } from '@/models/_.js';
import { LiveLoggerService } from '@/core/live/LiveLoggerService.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';

/**
 * 保持期限切れのローカル mp4 を削除する (bsky-fork 独自、YouTube 12時間アーカイブ上限対策)。
 * QueueService の repeatable job (`recordingRetentionCleanup`, 毎日03:30) から呼ばれる。
 * recordingRetentionExpiresAt < now のストリームを最大50件取得し、recordingFilePath が
 * 指されていればファイルを削除 (ENOENT 等も含め失敗は無視)、その後 recordingFilePath /
 * recordingFileSize / recordingRetentionExpiresAt を null に戻す。
 * recordingStatus / recordingError は触らない (UI で failed/expired の表示を維持するため)。
 */
@Injectable()
export class RecordingRetentionCleanupProcessorService {
	private logger: Logger;

	constructor(
		@Inject(DI.twitchStreamsRepository)
		private twitchStreamsRepository: TwitchStreamsRepository,

		private liveLoggerService: LiveLoggerService,
	) {
		this.logger = this.liveLoggerService.child('retention-cleanup');
	}

	@bindThis
	public async process(): Promise<void> {
		// LessThan(new Date()) は recordingRetentionExpiresAt < now かつ非 NULL の行だけを
		// 返す (NULL は比較結果が NULL となり WHERE から除外される)。これで期限切れのストリーム
		// だけを取り出せる。
		const streams = await this.twitchStreamsRepository.find({
			where: { recordingRetentionExpiresAt: LessThan(new Date()) },
			order: { id: 'ASC' },
			take: 50,
		});
		if (streams.length === 0) return;

		for (const s of streams) {
			const p = s.recordingFilePath;
			if (p != null) {
				await fs.unlink(p).catch(() => {});
			}
			await this.twitchStreamsRepository.update(s.id, {
				recordingFilePath: null,
				recordingFileSize: null,
				recordingRetentionExpiresAt: null,
			});
			this.logger.info(`purged expired retention file: streamId=${s.id} path=${p ?? '(none)'}`);
		}
	}
}
