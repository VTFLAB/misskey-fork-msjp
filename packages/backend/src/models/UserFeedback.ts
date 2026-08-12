/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Index, JoinColumn, Column, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import type { MiDriveFile } from './DriveFile.js';

export const userFeedbackTypes = ['bug', 'feature'] as const;
export const userFeedbackStatuses = ['open', 'inProgress', 'resolved', 'rejected'] as const;

// bsky-fork 独自: ユーザーからのバグ報告・機能要望の受付。
// 本文・添付は LLM エージェントが LAN 限定 endpoint 経由で参照するため、常に
// 信頼できない入力として扱う (取り扱い規律は .claude/skills/handling-user-feedback)。
@Entity('user_feedback')
export class MiUserFeedback {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column({
		...id(),
		comment: 'The ID of reporter.',
	})
	public userId: MiUser['id'];

	@ManyToOne(type => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	@Column('varchar', {
		length: 16,
		comment: 'bug | feature',
	})
	public type: typeof userFeedbackTypes[number];

	@Column('varchar', {
		length: 256,
	})
	public title: string;

	@Column('varchar', {
		length: 8192,
	})
	public body: string;

	@Column({
		...id(),
		array: true, default: '{}',
	})
	public fileIds: MiDriveFile['id'][];

	@Column('varchar', {
		length: 16, default: 'open',
		comment: 'open | inProgress | resolved | rejected',
	})
	public status: typeof userFeedbackStatuses[number];

	@Column('varchar', {
		length: 8192, nullable: true,
		comment: 'Staff response shown to the reporter.',
	})
	public response: string | null;

	@Column('timestamp with time zone', {
		nullable: true,
	})
	public updatedAt: Date | null;

	constructor(data: Partial<MiUserFeedback>) {
		if (data == null) return;

		for (const [k, v] of Object.entries(data)) {
			(this as any)[k] = v;
		}
	}
}
