/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, Index, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

// 配信ページ単位のブロック。配信者 (userId) が自分の配信チャットから特定の投稿者を
// 締め出すためのもので、Misskey 本体の blocking とは独立している。対象は
// Misskey ユーザー / リモートゲスト / Twitch チャッターの 3 種で、targetType と
// 対応するカラム群のどれか 1 組だけが設定される。配信セッションを跨いで永続する。
@Entity('twitch_stream_block')
@Index(['userId', 'targetUserId'], { unique: true, where: '"targetUserId" IS NOT NULL' })
@Index(['userId', 'targetRemoteGuestUsername', 'targetRemoteGuestHost'], { unique: true, where: '"targetRemoteGuestUsername" IS NOT NULL' })
@Index(['userId', 'targetTwitchUserName'], { unique: true, where: '"targetTwitchUserName" IS NOT NULL' })
export class MiTwitchStreamBlock {
	@PrimaryColumn(id())
	public id: string;

	// ブロックを設定した配信者 (ローカルユーザー)
	@Index()
	@Column({
		...id(),
		comment: 'The broadcaster (local user) who owns this block.',
	})
	public userId: MiUser['id'];

	@ManyToOne(type => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	@Column('varchar', {
		length: 16,
		comment: 'Block target kind: misskey | remote-guest | twitch.',
	})
	public targetType: 'misskey' | 'remote-guest' | 'twitch';

	// targetType=misskey: ブロック対象のローカルユーザー
	@Column({
		...id(),
		nullable: true,
	})
	public targetUserId: MiUser['id'] | null;

	@ManyToOne(type => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public targetUser: MiUser | null;

	// targetType=remote-guest: username@host で同定する (アカウント行の削除・再作成を跨いで安定)
	@Column('varchar', {
		length: 128, nullable: true,
	})
	public targetRemoteGuestUsername: string | null;

	@Column('varchar', {
		length: 512, nullable: true,
	})
	public targetRemoteGuestHost: string | null;

	// targetType=twitch: chatter_user_id (安定 ID)。過去コメント由来で ID 不明の場合は null
	@Column('varchar', {
		length: 64, nullable: true,
	})
	public targetTwitchUserId: string | null;

	// targetType=twitch: login 名。ID が引けない旧データからのブロックでも照合できるよう必須で持つ
	@Column('varchar', {
		length: 128, nullable: true,
	})
	public targetTwitchUserName: string | null;

	// 管理 UI 表示用スナップショット
	@Column('varchar', {
		length: 128, nullable: true,
	})
	public targetTwitchDisplayName: string | null;

	constructor(data: Partial<MiTwitchStreamBlock>) {
		if (data == null) return;

		for (const [k, v] of Object.entries(data)) {
			(this as any)[k] = v;
		}
	}
}
