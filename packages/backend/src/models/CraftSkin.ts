/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PrimaryColumn, Entity, Index, JoinColumn, Column, ManyToOne } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiDriveFile } from './DriveFile.js';

/**
 * Misskey Craft のプレイヤースキン (Minecraft 互換の 64x64 / 64x32 PNG)。
 * ユーザーごとに 1 件。ドライブのファイルを指す。
 */
@Entity('craft_skin')
export class MiCraftSkin {
	@PrimaryColumn(id())
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	@Index()
	@Column(id())
	public fileId: MiDriveFile['id'];

	@ManyToOne(() => MiDriveFile, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public file: MiDriveFile | null;

	@Column('timestamp with time zone')
	public updatedAt: Date;
}
