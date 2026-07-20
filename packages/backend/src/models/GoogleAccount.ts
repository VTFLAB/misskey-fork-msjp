/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, Index, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

// Google アカウント連携 (配信アーカイブの Google Drive アップロード用)。1 Misskey ユーザーにつき最大 1 レコード。
@Entity('google_account')
export class MiGoogleAccount {
	@PrimaryColumn(id())
	public id: string;

	@Index({ unique: true })
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
		length: 256,
		comment: 'Google account email.',
	})
	public googleEmail: string;

	@Column('varchar', {
		length: 512, nullable: true,
	})
	public refreshToken: string | null;

	@Column('varchar', {
		length: 512, nullable: true,
	})
	public accessToken: string | null;

	@Column('timestamp with time zone', {
		comment: 'Expiry of accessToken.',
	})
	public expiresAt: Date;

	@Column('varchar', {
		length: 128, array: true, default: '{}',
	})
	public scopes: string[];

	@Column('varchar', {
		length: 128, nullable: true,
		comment: 'Google Drive folder id to upload recordings into. null = upload to root.',
	})
	public folderId: string | null;

	constructor(data: Partial<MiGoogleAccount>) {
		if (data == null) return;

		for (const [k, v] of Object.entries(data)) {
			(this as any)[k] = v;
		}
	}
}
