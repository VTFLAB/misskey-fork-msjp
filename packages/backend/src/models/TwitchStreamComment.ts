/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, Index, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiTwitchStream } from './TwitchStream.js';

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
		comment: 'Comment origin: misskey | twitch.',
	})
	public source: 'misskey' | 'twitch';

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

	@Column('varchar', {
		length: 1024,
	})
	public text: string;

	constructor(data: Partial<MiTwitchStreamComment>) {
		if (data == null) return;

		for (const [k, v] of Object.entries(data)) {
			(this as any)[k] = v;
		}
	}
}
