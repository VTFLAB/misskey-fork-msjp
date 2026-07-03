/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, Index, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

// Twitch の配信セッション。stream.online 〜 stream.offline を 1 レコードで表す。
// 過去セッションも履歴として残す (視聴ページのコメント履歴が streamId で紐づくため)。
@Entity('twitch_stream')
export class MiTwitchStream {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column({
		...id(),
		comment: 'The local user who owns the linked Twitch account.',
	})
	public userId: MiUser['id'];

	@ManyToOne(type => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	@Index()
	@Column('varchar', {
		length: 64,
		comment: 'Twitch user id of the broadcaster.',
	})
	public twitchUserId: string;

	@Index({ unique: true })
	@Column('varchar', {
		length: 64,
		comment: 'Twitch stream (session) id.',
	})
	public twitchStreamId: string;

	@Column('varchar', {
		length: 128, default: '',
		comment: '[Denormalized] Twitch login name (for embed player / chat relay).',
	})
	public twitchLogin: string;

	@Index()
	@Column('boolean', {
		default: false,
	})
	public isLive: boolean;

	@Column('varchar', {
		length: 512, default: '',
	})
	public title: string;

	@Column('varchar', {
		length: 256, nullable: true,
	})
	public gameName: string | null;

	@Column('varchar', {
		length: 1024, nullable: true,
		comment: 'Thumbnail URL template ({width}/{height} placeholders as returned by Helix).',
	})
	public thumbnailUrl: string | null;

	@Column('integer', {
		default: 0,
	})
	public viewerCount: number;

	@Column('timestamp with time zone')
	public startedAt: Date;

	@Column('timestamp with time zone', {
		nullable: true,
	})
	public endedAt: Date | null;

	constructor(data: Partial<MiTwitchStream>) {
		if (data == null) return;

		for (const [k, v] of Object.entries(data)) {
			(this as any)[k] = v;
		}
	}
}
