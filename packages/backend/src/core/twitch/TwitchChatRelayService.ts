/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, Inject } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { TwitchStreamsRepository } from '@/models/_.js';
import type { MiTwitchStream } from '@/models/TwitchStream.js';
import type { MiUser } from '@/models/User.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { TwitchApiService } from './TwitchApiService.js';
import { TwitchOAuthService } from './TwitchOAuthService.js';
import { TwitchCommentService } from './TwitchCommentService.js';
import { TwitchLoggerService } from './TwitchLoggerService.js';

// Twitch チャットの上限は 500 文字。「名前: 本文」の接頭辞込みで収める
const TWITCH_CHAT_MAX_LENGTH = 500;

type ChatMessageEvent = {
	broadcaster_user_id: string;
	chatter_user_id: string;
	chatter_user_login: string;
	chatter_user_name: string;
	message_id: string;
	message: { text: string };
};

@Injectable()
export class TwitchChatRelayService {
	private logger: Logger;

	constructor(
		@Inject(DI.twitchStreamsRepository)
		private twitchStreamsRepository: TwitchStreamsRepository,

		private twitchApiService: TwitchApiService,
		private twitchOAuthService: TwitchOAuthService,
		private twitchCommentService: TwitchCommentService,
		private twitchLoggerService: TwitchLoggerService,
	) {
		this.logger = this.twitchLoggerService.child('chat-relay');
	}

	/**
	 * Misskey 側コメントを bot 経由で Twitch チャットへ送信する (fire-and-forget)。
	 * Twitch 未連携ユーザーのコメントも bot が代理発言することで全コメントが中継される。
	 * bot 未設定・失効時は静かにスキップ (Misskey 側の投稿は既に成立している)。
	 */
	@bindThis
	public relayToTwitch(stream: MiTwitchStream, user: MiUser, text: string): void {
		(async () => {
			const bot = await this.twitchOAuthService.getBotAccount();
			if (bot == null) return;
			const token = await this.twitchOAuthService.getValidAccessToken(bot);
			if (token == null) return;

			const prefix = `${user.name ?? user.username}: `;
			const message = (prefix + text).slice(0, TWITCH_CHAT_MAX_LENGTH);

			const res = await this.twitchApiService.helixPost<{ data: { is_sent: boolean; drop_reason?: { code: string; message: string } }[] }>('/helix/chat/messages', {
				broadcaster_id: stream.twitchUserId,
				sender_id: bot.twitchUserId,
				message,
			}, token);

			const result = res.data[0];
			if (result != null && !result.is_sent) {
				this.logger.warn(`chat message dropped by Twitch: ${result.drop_reason?.code} ${result.drop_reason?.message}`);
			}
		})().catch(err => {
			this.logger.warn(`relay to Twitch failed (stream=${stream.id}): ${err instanceof Error ? err.message : err}`);
		});
	}

	/**
	 * EventSub channel.chat.message の取り込み。
	 * bot 自身の発言 (= Misskey からの中継エコー) はループ防止のためスキップする。
	 */
	@bindThis
	public async handleChatMessageEvent(event: ChatMessageEvent): Promise<void> {
		const bot = await this.twitchOAuthService.getBotAccount();
		if (bot != null && event.chatter_user_id === bot.twitchUserId) return;

		const stream = await this.twitchStreamsRepository.findOneBy({
			twitchUserId: event.broadcaster_user_id,
			isLive: true,
		});
		if (stream == null) return;

		await this.twitchCommentService.createTwitchComment(stream, {
			twitchMessageId: event.message_id,
			twitchUserName: event.chatter_user_login,
			twitchDisplayName: event.chatter_user_name,
			text: event.message.text,
		});
	}
}
