/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, Inject } from '@nestjs/common';
import * as mfm from 'mfm-js';
import { DI } from '@/di-symbols.js';
import type { TwitchStreamsRepository } from '@/models/_.js';
import type { MiTwitchStream } from '@/models/TwitchStream.js';
import type { TwitchChatFragment } from '@/models/TwitchStreamComment.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { TwitchApiService } from './TwitchApiService.js';
import { TwitchOAuthService } from './TwitchOAuthService.js';
import { TwitchCommentService } from './TwitchCommentService.js';
import { TwitchLoggerService } from './TwitchLoggerService.js';

// Twitch チャットの上限は 500 文字。「名前: 本文」の接頭辞込みで収める
const TWITCH_CHAT_MAX_LENGTH = 500;

// Twitch EventSub の message.fragments 生データ。cheermote / mention はこの fork では
// 特別扱いせず text 相当として扱う (絵文字表示のみサポートする)
type TwitchRawFragment = {
	type: 'text' | 'cheermote' | 'emote' | 'mention';
	text: string;
	// format: Twitch が絵文字の対応フォーマットを返す (例: ['static'] または ['static', 'animated'])
	emote?: { id: string; format?: string[] | null } | null;
};

type ChatMessageEvent = {
	broadcaster_user_id: string;
	chatter_user_id: string;
	chatter_user_login: string;
	chatter_user_name: string;
	message_id: string;
	message: { text: string; fragments?: TwitchRawFragment[] };
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
	 * @param user 表示名の代わりに username (不変・一意) だけを使う。ローカルユーザーの
	 * MiUser、またはリモートゲストの "username@host" 表記など、username 文字列のみで足りる
	 */
	@bindThis
	public relayToTwitch(
		stream: MiTwitchStream,
		user: { username: string },
		text: string,
	): void {
		(async () => {
			const bot = await this.twitchOAuthService.getBotAccount();
			if (bot == null) return;
			const token = await this.twitchOAuthService.getValidAccessToken(bot);
			if (token == null) return;

			// username (不変・一意) を使うことで表示名による他ユーザーの発言偽装を防ぐ。
			// MFM 装飾は Twitch チャットで意味を持たないため平文に変換する
			const plain = this.mfmToPlainText(text);
			if (plain.length === 0) return;

			// 改行・制御文字は Twitch チャットに送れないため空白に潰す。
			// 絵文字除去で生じた連続空白・前後の空白も畳んでおく
			const sanitized = plain.replace(/[\u0000-\u001f\u007f]/g, ' ')
				.replace(/ {2,}/g, ' ')
				.trim();
			if (sanitized.length === 0) return;
			const message = `${user.username}: ${sanitized}`.slice(
				0,
				TWITCH_CHAT_MAX_LENGTH,
			);

			const res = await this.twitchApiService.helixPost<{
				data: {
					is_sent: boolean;
					drop_reason?: { code: string; message: string };
				}[];
			}>(
				'/helix/chat/messages',
				{
					broadcaster_id: stream.twitchUserId,
					sender_id: bot.twitchUserId,
					message,
				},
				token,
			);

			const result = res.data[0];
			if (result != null && !result.is_sent) {
				this.logger.warn(
					`chat message dropped by Twitch: ${result.drop_reason?.code} ${result.drop_reason?.message}`,
				);
			}
		})().catch((err) => {
			this.logger.warn(
				`relay to Twitch failed (stream=${stream.id}): ${err instanceof Error ? err.message : err}`,
			);
		});
	}

	/**
	 * MFM ソースを平文に変換する (Twitch チャット向け)。
	 * 装飾や構文は取り除き、ユーザーが入力した文字列としての意図を残す。
	 */
	@bindThis
	private mfmToPlainText(text: string): string {
		const nodes = mfm.parse(text);
		if (nodes.length === 0) return '';

		const walk = (node: mfm.MfmNode): string => {
			switch (node.type) {
				case 'text':
					return node.props.text;
				case 'plain':
					return node.children.map(walk).join('');
				case 'unicodeEmoji':
				case 'emojiCode':
					// Misskey 側の絵文字は Twitch チャットで正しく表示できない
					// (カスタム絵文字コードはそのまま ":name:" という無意味なテキストになり、
					// Unicode 絵文字も配信ソフトのオーバーレイ等でグリフ欠落することがある)
					// ため、Twitch へは渡さずまるごと除去する
					return '';
				case 'mention':
					return `@${node.props.username}`;
				case 'hashtag':
					return `#${node.props.hashtag}`;
				case 'url':
					return node.props.url;
				case 'link':
					return node.props.url;
				case 'inlineCode':
					return node.props.code;
				case 'mathInline':
					return node.props.formula;
				case 'fn':
					return node.children.map(walk).join('');
				case 'bold':
				case 'italic':
				case 'strike':
				case 'small':
				case 'quote':
				case 'center':
					return node.children.map(walk).join('');
				case 'blockCode':
					return node.props.code;
				case 'mathBlock':
					return node.props.formula;
				case 'search':
					return node.props.content;
				default:
					return '';
			}
		};

		return nodes.map(walk).join('');
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
			fragments: this.sanitizeFragments(event.message.fragments),
		});
	}

	/**
	 * Twitch EventSub の生 fragments を表示用に単純化する。
	 * cheermote / mention は絵文字ではないため text として畳み込む。
	 * emote だけ id を保持し、フロントエンドで Twitch CDN 画像として描画する
	 */
	@bindThis
	private sanitizeFragments(raw: TwitchRawFragment[] | undefined): TwitchChatFragment[] | null {
		if (raw == null || raw.length === 0) return null;

		const fragments: TwitchChatFragment[] = [];
		for (const f of raw) {
			if (f.type === 'emote' && f.emote?.id != null) {
				fragments.push({
					type: 'emote',
					text: f.text,
					emoteId: f.emote.id,
					animated: Array.isArray(f.emote.format) && f.emote.format.includes('animated'),
				});
			} else {
				// 直前が text fragment ならまとめる (cheermote/mention の畳み込みで連続しうるため)
				const last = fragments[fragments.length - 1];
				if (last != null && last.type === 'text') {
					last.text += f.text;
				} else {
					fragments.push({ type: 'text', text: f.text });
				}
			}
		}
		return fragments;
	}
}
