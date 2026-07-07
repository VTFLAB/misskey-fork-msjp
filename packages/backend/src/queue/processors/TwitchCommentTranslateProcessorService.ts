/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type * as Bull from 'bullmq';
import { DI } from '@/di-symbols.js';
import type { TwitchStreamCommentsRepository, TwitchStreamsRepository, UsersRepository } from '@/models/_.js';
import { TwitchTranslationService } from '@/core/twitch/TwitchTranslationService.js';
import { TwitchCommentService } from '@/core/twitch/TwitchCommentService.js';
import { TwitchChatRelayService } from '@/core/twitch/TwitchChatRelayService.js';
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

		@Inject(DI.twitchStreamsRepository)
		private twitchStreamsRepository: TwitchStreamsRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private twitchTranslationService: TwitchTranslationService,
		private twitchCommentService: TwitchCommentService,
		private twitchChatRelayService: TwitchChatRelayService,
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
			// キューは順次処理のため長文の推論時間 (CPU で数十秒) を許容する。
			// 短い config timeout のままだと長文コメントが常に翻訳失敗になる
			translatedText = await this.twitchTranslationService.translate(comment.text, targetLang, 60_000);
		} catch (err) {
			// 翻訳失敗時はログのみで正常終了する (コメント自体は既に配信済みのため、翻訳無しのまま残す)。
			// Twitch 中継を待たせている場合はコメントを取りこぼさないよう原文をそのまま中継する
			this.logger.warn(`translation failed (comment=${commentId}): ${err instanceof Error ? err.message : err}`);
			if (job.data.relayToTwitch) await this.relay(streamId, comment.userId, comment.text);
			return;
		}

		await this.twitchStreamCommentsRepository.update(commentId, {
			translatedText,
			translatedLang: targetLang,
		});

		await this.twitchCommentService.publishTranslation(streamId, commentId, translatedText, targetLang);

		if (job.data.relayToTwitch) await this.relay(streamId, comment.userId, translatedText);
	}

	/** 投稿翻訳 (日本語入力) の Twitch 中継。投稿時ではなく翻訳完了後にここから送る */
	@bindThis
	private async relay(streamId: string, userId: string | null, text: string): Promise<void> {
		if (userId == null || text.length === 0) return;
		const [stream, user] = await Promise.all([
			this.twitchStreamsRepository.findOneBy({ id: streamId }),
			this.usersRepository.findOneBy({ id: userId }),
		]);
		if (stream == null || user == null) return;
		this.twitchChatRelayService.relayToTwitch(stream, user, text);
	}
}
