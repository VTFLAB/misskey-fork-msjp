/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, Index, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiRemoteGuestAccount } from './RemoteGuestAccount.js';

// 発行済みのゲストログインセッション (bearer token)。
// MiUser.token / MiAuth の access_token とは別の第3の名前空間。
// フロントが localStorage に保持し、リクエスト毎に明示的に body param として送る (Cookie不使用)。
@Entity('remote_guest_session')
export class MiRemoteGuestSession {
	@PrimaryColumn(id())
	public id: string;

	@Index({ unique: true })
	@Column('varchar', {
		length: 128,
		comment: 'Opaque bearer token held by the frontend (localStorage).',
	})
	public token: string;

	@Index()
	@Column({
		...id(),
	})
	public remoteGuestAccountId: MiRemoteGuestAccount['id'];

	@ManyToOne(type => MiRemoteGuestAccount, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public remoteGuestAccount: MiRemoteGuestAccount | null;

	@Column('timestamp with time zone')
	public createdAt: Date;

	@Index()
	@Column('timestamp with time zone', {
		comment: 'Sliding expiry, extended on each validated use.',
	})
	public expiresAt: Date;

	@Column('timestamp with time zone', {
		nullable: true,
	})
	public lastActiveAt: Date | null;

	constructor(data: Partial<MiRemoteGuestSession>) {
		if (data == null) return;

		for (const [k, v] of Object.entries(data)) {
			(this as any)[k] = v;
		}
	}
}
