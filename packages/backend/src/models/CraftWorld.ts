/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PrimaryColumn, Entity, Index, JoinColumn, Column, ManyToOne } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

/**
 * Misskey Craft (bsky-fork original) のワールド。
 * 地形はクライアントが seed から決定論的に生成し、サーバーは変更された
 * ブロック (MiCraftBlock) だけを保持する。
 */
@Entity('craft_world')
export class MiCraftWorld {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column({
		...id(),
	})
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	@Column('varchar', {
		length: 128,
	})
	public name: string;

	@Column('integer')
	public seed: number;

	/**
	 * true: 誰でもブロックを置ける / false: オーナーだけが置ける (他人は見学のみ)
	 */
	@Index()
	@Column('boolean', {
		default: true,
	})
	public isPublic: boolean;

	/**
	 * 保存されている差分ブロック (craft_block) の行数。上限判定と一覧表示に使う
	 */
	@Column('integer', {
		default: 0,
	})
	public blockCount: number;
}
