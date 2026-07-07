/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, Index, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

// Twitch アカウント連携。1 Misskey ユーザーにつき最大 1 レコード。
// インスタンス共通の中継 bot アカウント (isBot=true) は userId が null の単一レコード
// (単一性は migration の partial unique index で担保 WHERE "isBot" = TRUE)。
@Entity('twitch_account')
export class MiTwitchAccount {
	@PrimaryColumn(id())
	public id: string;

	@Index({ unique: true })
	@Column({
		...id(),
		nullable: true,
		comment: 'The linked local user. Null for the instance-wide relay bot account.',
	})
	public userId: MiUser['id'] | null;

	@ManyToOne(type => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	@Index({ unique: true })
	@Column('varchar', {
		length: 64,
		comment: 'Twitch user id.',
	})
	public twitchUserId: string;

	@Column('varchar', {
		length: 128,
		comment: 'Twitch login name (used for chat / embed player URLs).',
	})
	public twitchLogin: string;

	@Column('varchar', {
		length: 128,
	})
	public twitchDisplayName: string;

	@Column('boolean', {
		default: false,
		comment: 'Whether this row is the instance-wide relay bot account.',
	})
	public isBot: boolean;

	@Column('varchar', {
		length: 512,
	})
	public accessToken: string;

	@Column('varchar', {
		length: 512, nullable: true,
	})
	public refreshToken: string | null;

	@Column('timestamp with time zone', {
		comment: 'Expiry of accessToken.',
	})
	public expiresAt: Date;

	@Column('varchar', {
		length: 64, array: true, default: '{}',
	})
	public scopes: string[];

	// 配信コメント翻訳機能 (bsky-fork 独自) の配信者単位ON/OFF。配信を跨いで維持する恒久設定
	@Column('boolean', {
		default: false,
	})
	public translationEnabled: boolean;

	constructor(data: Partial<MiTwitchAccount>) {
		if (data == null) return;

		for (const [k, v] of Object.entries(data)) {
			(this as any)[k] = v;
		}
	}
}
