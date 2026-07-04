/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, Index, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';

// リモートMisskeyインスタンスのユーザーが MiAuth 経由で本人性を証明した「ゲストアイデンティティ」。
// MiUser は一切使わない完全に独立した第3の体系 (視聴+コメント専用、follow/timeline等には統合しない)。
@Entity('remote_guest_account')
@Index(['usernameLower', 'host'], { unique: true })
export class MiRemoteGuestAccount {
	@PrimaryColumn(id())
	public id: string;

	@Column('varchar', {
		length: 128,
		comment: 'The username on the remote instance (display form).',
	})
	public username: string;

	@Column('varchar', {
		length: 128,
		comment: 'The username (lowercased) on the remote instance. Used for uniqueness.',
	})
	public usernameLower: string;

	@Column('varchar', {
		length: 512,
		comment: 'The remote instance host (normalized: lowercased, no trailing dot).',
	})
	public host: string;

	@Column('varchar', {
		length: 512, nullable: true,
	})
	public avatarUrl: string | null;

	@Column('varchar', {
		length: 128, nullable: true,
	})
	public displayName: string | null;

	@Index()
	@Column('timestamp with time zone')
	public lastLoginAt: Date;

	@Column('timestamp with time zone')
	public createdAt: Date;

	constructor(data: Partial<MiRemoteGuestAccount>) {
		if (data == null) return;

		for (const [k, v] of Object.entries(data)) {
			(this as any)[k] = v;
		}
	}
}
