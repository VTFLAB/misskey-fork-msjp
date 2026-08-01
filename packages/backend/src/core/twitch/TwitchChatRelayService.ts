/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, Inject } from '@nestjs/common';
import * as mfm from 'mfm-js';
import { DI } from '@/di-symbols.js';
import type { LiveChannelsRepository, TwitchAccountsRepository, TwitchStreamsRepository } from '@/models/_.js';
import type { MiTwitchStream } from '@/models/TwitchStream.js';
import type { TwitchChatFragment } from '@/models/TwitchStreamComment.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { TwitchApiService } from './TwitchApiService.js';
import { TwitchOAuthService } from './TwitchOAuthService.js';
import { TwitchCommentService } from './TwitchCommentService.js';
import { TwitchStreamBlockService } from './TwitchStreamBlockService.js';
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

		@Inject(DI.twitchAccountsRepository)
		private twitchAccountsRepository: TwitchAccountsRepository,

		@Inject(DI.liveChannelsRepository)
		private liveChannelsRepository: LiveChannelsRepository,

		private twitchApiService: TwitchApiService,
		private twitchOAuthService: TwitchOAuthService,
		private twitchCommentService: TwitchCommentService,
		private twitchStreamBlockService: TwitchStreamBlockService,
		private twitchLoggerService: TwitchLoggerService,
	) {
		this.logger = this.twitchLoggerService.child('chat-relay');
	}

	/**
	 * コメントの投稿先として正となるライブセッションを解決する (bsky-fork 独自)。
	 *
	 * Twitch 同時転送中は「OME セッション + Twitch 中継セッション」の 2 行が並存するが、
	 * チャットの本体は OME セッション側 (Twitch 側チャットも handleChatMessageEvent が
	 * OME セッションへ合流させる)。この状態で Twitch 中継セッション宛てにコメントが
	 * 投稿されると、視聴者にも配信者にも見えない「別部屋」に落ちてしまうため、
	 * 投稿系エンドポイントはここで OME セッションへ付け替えてから永続化する。
	 * 同時転送でない場合 (Twitch 単独中継 / OME 単独) は渡されたセッションをそのまま返す。
	 */
	@bindThis
	public async resolveCanonicalChatStream(stream: MiTwitchStream): Promise<MiTwitchStream> {
		if (stream.source !== 'twitch' || !stream.isLive) return stream;

		const channel = await this.liveChannelsRepository.findOneBy({ userId: stream.userId });
		if (channel?.twitchRestreamEnabled !== true) return stream;

		const omeStream = await this.twitchStreamsRepository.findOneBy({
			userId: stream.userId,
			source: 'ome',
			isLive: true,
		});
		return omeStream ?? stream;
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
		// Twitch 中継セッション、または Twitch 同時転送中の MSJP 配信 (OME) セッションのみ対象。
		// OME セッションは twitchUserId を持たないため、送信先は本人の連携アカウントから解決する
		if (stream.source !== 'twitch' && stream.source !== 'ome') return;

		(async () => {
			let broadcasterId = stream.twitchUserId;
			if (stream.source === 'ome') {
				const channel = await this.liveChannelsRepository.findOneBy({ userId: stream.userId });
				if (channel?.twitchRestreamEnabled !== true) return;
				const account = await this.twitchAccountsRepository.findOneBy({ userId: stream.userId });
				if (account == null) return;
				broadcasterId = account.twitchUserId;
			}
			if (broadcasterId == null) return;

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
					broadcaster_id: broadcasterId,
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

		// Twitch 同時転送中は MSJP 配信 (OME) セッションが配信の本体なので、Twitch 側の
		// チャットもそちらへ取り込む (視聴者が見ている OME 配信のチャット欄・コメントリプレイに
		// 合流させる)。転送していない場合は従来どおり Twitch 中継セッションへ
		let stream: MiTwitchStream | null = null;
		const account = await this.twitchAccountsRepository.findOneBy({ twitchUserId: event.broadcaster_user_id });
		if (account?.userId != null) {
			const channel = await this.liveChannelsRepository.findOneBy({ userId: account.userId });
			if (channel?.twitchRestreamEnabled === true) {
				stream = await this.twitchStreamsRepository.findOneBy({
					userId: account.userId,
					source: 'ome',
					isLive: true,
				});
			}
		}
		if (stream == null) {
			stream = await this.twitchStreamsRepository.findOneBy({
				twitchUserId: event.broadcaster_user_id,
				isLive: true,
			});
		}
		if (stream == null) {
			// 配信していない間はプレビュー行があればそこへ取り込む。
			// EventSub の chat 購読は配信状態と無関係に常設のため、オフライン中の
			// Twitch チャットもプレビューモード (配信前の機能検証) で確認できる
			stream = await this.twitchStreamsRepository.findOneBy({
				twitchUserId: event.broadcaster_user_id,
				isPreview: true,
			});
		}
		if (stream == null) return;
		if (stream.source !== 'twitch' && stream.source !== 'ome') return;

		// 配信者にブロックされたチャッターの発言は取り込まない (永続化も配信もしない)。
		// Twitch 側のチャット欄には残るが、Misskey 側の視聴ページ・OBS オーバーレイには出ない
		if (await this.twitchStreamBlockService.isBlockedTwitchChatter(stream.userId, event.chatter_user_id, event.chatter_user_login)) {
			return;
		}

		await this.twitchCommentService.createTwitchComment(stream, {
			twitchMessageId: event.message_id,
			twitchUserName: event.chatter_user_login,
			twitchDisplayName: event.chatter_user_name,
			twitchChatterUserId: event.chatter_user_id,
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
