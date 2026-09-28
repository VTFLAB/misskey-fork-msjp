/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, Index, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

export type MusicServiceAccountService = 'lastfm' | 'listenbrainz';

// NowPlaying (fork 独自) の scrobble サービス連携。1 ユーザーにつき service ごとに最大 1 レコード。
@Entity('music_service_account')
@Index(['userId', 'service'], { unique: true })
export class MiMusicServiceAccount {
	@PrimaryColumn(id())
	public id: string;

	@Column({
		...id(),
		comment: 'The linked local user.',
	})
	public userId: MiUser['id'];

	@ManyToOne(type => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	@Column('varchar', {
		length: 32,
		comment: 'lastfm or listenbrainz.',
	})
	public service: MusicServiceAccountService;

	@Column('varchar', {
		length: 128, nullable: true,
		comment: 'Username on the linked service (display only).',
	})
	public serviceUsername: string | null;

	@Column('varchar', {
		length: 512,
		comment: 'Last.fm session key or ListenBrainz user token.',
	})
	public credential: string;

	@Column('timestamp with time zone')
	public createdAt: Date;

	constructor(data: Partial<MiMusicServiceAccount>) {
		if (data == null) return;

		for (const [k, v] of Object.entries(data)) {
			(this as any)[k] = v;
		}
	}
}
