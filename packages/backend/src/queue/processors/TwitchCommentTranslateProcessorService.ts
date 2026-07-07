/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type * as Bull from 'bullmq';
import { DI } from '@/di-symbols.js';
import type { TwitchStreamCommentsRepository } from '@/models/_.js';
import { TwitchTranslationService } from '@/core/twitch/TwitchTranslationService.js';
import { TwitchCommentService } from '@/core/twitch/TwitchCommentService.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { QueueLoggerService } from '../QueueLoggerService.js';
import type { TwitchCommentTranslateJobData } from '../types.js';

@Injectable()
export class TwitchCommentTranslateProcessorService {
	private logger: Logger;

	constructor(
		@Inject(DI.twitchStreamCommentsRepository)
		private twitchStreamCommentsRepository: TwitchStreamCommentsRepository,

		private twitchTranslationService: TwitchTranslationService,
		private twitchCommentService: TwitchCommentService,
		private queueLoggerService: QueueLoggerService,
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('twitch-comment-translate');
	}

	@bindThis
	public async process(job: Bull.Job<TwitchCommentTranslateJobData>): Promise<void> {
		const { commentId, streamId, targetLang } = job.data;

		const comment = await this.twitchStreamCommentsRepository.findOneBy({ id: commentId });
		if (comment == null) return;

		let translatedText: string;
		try {
			translatedText = await this.twitchTranslationService.translate(comment.text, targetLang);
		} catch (err) {
			// 翻訳失敗時はログのみで正常終了する (コメント自体は既に配信済みのため、翻訳無しのまま残す)
			this.logger.warn(`translation failed (comment=${commentId}): ${err instanceof Error ? err.message : err}`);
			return;
		}

		await this.twitchStreamCommentsRepository.update(commentId, {
			translatedText,
			translatedLang: targetLang,
		});

		await this.twitchCommentService.publishTranslation(streamId, commentId, translatedText, targetLang);
	}
}
