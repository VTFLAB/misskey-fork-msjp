/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, Index, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiDriveFile } from './DriveFile.js';
import { MiTwitchStream } from './TwitchStream.js';
import { MiRemoteGuestAccount } from './RemoteGuestAccount.js';

// Twitch EventSub の message.fragments を最小限に単純化したもの。
// cheermote / mention は特別扱いせず text として扱う (絵文字表示にのみ対応する)
export type TwitchChatFragment = {
	type: 'text' | 'emote';
	text: string;
	// type === 'emote' のときのみ設定 (Twitch CDN 画像 URL の構築に使う)
	emoteId?: string;
	// type === 'emote' のときのみ設定。true ならアニメーション (GIF) 版の画像 URL を使う
	animated?: boolean;
};

// 配信視聴ページのコメント。ノートとは完全に独立した専用モデルで、
// Misskey ユーザーの投稿 (source=misskey) と Twitch チャット由来 (source=twitch) の
// 両方を配信セッション単位で永続化する。配信ページ上でのみ表示され、連合しない。
@Entity('twitch_stream_comment')
export class MiTwitchStreamComment {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column({
		...id(),
		comment: 'The stream (session) this comment belongs to.',
	})
	public streamId: MiTwitchStream['id'];

	@ManyToOne(type => MiTwitchStream, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public stream: MiTwitchStream | null;

	@Column('varchar', {
		length: 16,
		comment: 'Comment origin: misskey | twitch | remote-guest | system (server-generated warning).',
	})
	public source: 'misskey' | 'twitch' | 'remote-guest' | 'system';

	// source=misskey の投稿者。退会時は null になりコメントは「削除されたユーザー」として残る
	@Column({
		...id(),
		nullable: true,
	})
	public userId: MiUser['id'] | null;

	@ManyToOne(type => MiUser, {
		onDelete: 'SET NULL',
	})
	@JoinColumn()
	public user: MiUser | null;

	// source=twitch のときの表示用スナップショット
	@Column('varchar', {
		length: 128, nullable: true,
	})
	public twitchUserName: string | null;

	// source=twitch のときの chatter_user_id (安定 ID)。配信ブロックの対象同定に使う。
	// カラム追加以前の旧コメントは null
	@Column('varchar', {
		length: 64, nullable: true,
	})
	public twitchChatterUserId: string | null;

	@Column('varchar', {
		length: 128, nullable: true,
	})
	public twitchDisplayName: string | null;

	// EventSub message_id (重複排除・bot エコーのループ防止用)
	@Index({ unique: true })
	@Column('varchar', {
		length: 64, nullable: true,
	})
	public twitchMessageId: string | null;

	// source=remote-guest の投稿者。ゲストアカウント削除後も "user@host" 表示を残すためスナップショットも持つ
	@Column({
		...id(),
		nullable: true,
	})
	public remoteGuestAccountId: MiRemoteGuestAccount['id'] | null;

	@ManyToOne(type => MiRemoteGuestAccount, {
		onDelete: 'SET NULL',
	})
	@JoinColumn()
	public remoteGuestAccount: MiRemoteGuestAccount | null;

	@Column('varchar', {
		length: 128, nullable: true,
	})
	public remoteGuestUsername: string | null;

	@Column('varchar', {
		length: 512, nullable: true,
	})
	public remoteGuestHost: string | null;

	@Column('varchar', {
		length: 1024,
	})
	public text: string;

	// source=twitch のときの絵文字レンダリング情報 (Twitch EventSub の fragments 由来)。
	// source=misskey や fragments 未取得の場合は null (プレーンテキストとして表示)
	@Column('jsonb', {
		nullable: true,
		comment: 'Twitch EventSub message fragments (source=twitch only). Used to render Twitch emotes inline; null for plain-text-only messages.',
	})
	public fragments: TwitchChatFragment[] | null;

	// source=misskey の添付メディア (ドライブファイル)。Twitch へは中継されない
	@Column({
		...id(),
		array: true, default: '{}',
		comment: 'Attached drive files (source=misskey only, not relayed to Twitch).',
	})
	public fileIds: MiDriveFile['id'][];

	// 翻訳結果 (bsky-fork 独自)。未翻訳/翻訳失敗時は null。source=misskey の同期翻訳、
	// または非同期翻訳キュー (TwitchCommentTranslateProcessorService) のいずれかで設定される
	@Column('varchar', {
		length: 1024, nullable: true,
	})
	public translatedText: string | null;

	// 翻訳結果の言語 ('ja' | 'en' 等)。translatedText と対で設定される
	@Column('varchar', {
		length: 8, nullable: true,
	})
	public translatedLang: string | null;

	constructor(data: Partial<MiTwitchStreamComment>) {
		if (data == null) return;

		for (const [k, v] of Object.entries(data)) {
			(this as any)[k] = v;
		}
	}
}
