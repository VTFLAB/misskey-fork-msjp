/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PrimaryColumn, Entity, Index, JoinColumn, Column, ManyToOne } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiCraftWorld } from './CraftWorld.js';

/**
 * Misskey Craft のワールドに対する、生成地形からの差分ブロック。
 * 1 座標 1 行。生成地形を壊した場合も空気 (type 0) の行として保存する
 * (行が無い座標は seed どおりの地形を意味するため)。
 */
@Entity('craft_block')
export class MiCraftBlock {
	@Index()
	@PrimaryColumn({
		...id(),
	})
	public worldId: MiCraftWorld['id'];

	@ManyToOne(() => MiCraftWorld, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public world: MiCraftWorld | null;

	@PrimaryColumn('integer')
	public x: number;

	@PrimaryColumn('integer')
	public y: number;

	@PrimaryColumn('integer')
	public z: number;

	@Column('smallint')
	public type: number;

	@Index()
	@Column({
		...id(),
		nullable: true,
	})
	public userId: MiUser['id'] | null;

	@ManyToOne(() => MiUser, {
		onDelete: 'SET NULL',
	})
	@JoinColumn()
	public user: MiUser | null;
}
