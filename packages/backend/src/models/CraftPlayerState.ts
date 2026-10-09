/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PrimaryColumn, Entity, Index, JoinColumn, Column, ManyToOne } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiCraftWorld } from './CraftWorld.js';

/**
 * Misskey Craft のワールドごと・ユーザーごとのセーブデータ
 * (インベントリ、ステータス、経験値、位置、スポーン地点など)。
 * サーバーはゲームロジックを検証せず、サイズだけを制限する。
 */
@Entity('craft_player_state')
export class MiCraftPlayerState {
	@PrimaryColumn(id())
	public worldId: MiCraftWorld['id'];

	@ManyToOne(() => MiCraftWorld, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public world: MiCraftWorld | null;

	@PrimaryColumn(id())
	public userId: MiUser['id'];

	@Index()
	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	@Column('jsonb', {
		default: {},
	})
	public state: Record<string, unknown>;

	@Column('timestamp with time zone')
	public updatedAt: Date;
}
