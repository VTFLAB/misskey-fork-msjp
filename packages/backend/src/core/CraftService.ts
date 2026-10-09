/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { CraftBlocksRepository, CraftWorldsRepository, MiCraftWorld, MiUser } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { IdService } from '@/core/IdService.js';
import { RoleService } from '@/core/RoleService.js';

/**
 * Misskey Craft (bsky-fork original) のワールド定数。
 * frontend の `utility/craft/constants.ts` と同じ値を持つ。
 */
export const CRAFT_WORLD = {
	minX: -128,
	maxX: 127,
	minY: 0,
	maxY: 63,
	minZ: -128,
	maxZ: 127,
	maxBlockType: 12,
	maxWorldsPerUser: 20,
	maxBlocksPerWorld: 200000,
} as const;

@Injectable()
export class CraftService {
	constructor(
		@Inject(DI.craftWorldsRepository)
		private craftWorldsRepository: CraftWorldsRepository,

		@Inject(DI.craftBlocksRepository)
		private craftBlocksRepository: CraftBlocksRepository,

		private globalEventService: GlobalEventService,
		private idService: IdService,
		private roleService: RoleService,
	) {
	}

	@bindThis
	public isValidPosition(x: number, y: number, z: number): boolean {
		return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z) &&
			x >= CRAFT_WORLD.minX && x <= CRAFT_WORLD.maxX &&
			y >= CRAFT_WORLD.minY && y <= CRAFT_WORLD.maxY &&
			z >= CRAFT_WORLD.minZ && z <= CRAFT_WORLD.maxZ;
	}

	@bindThis
	public isValidBlockType(type: number): boolean {
		return Number.isInteger(type) && type >= 0 && type <= CRAFT_WORLD.maxBlockType;
	}

	@bindThis
	public canBuild(world: MiCraftWorld, user: MiUser): boolean {
		return world.isPublic || world.userId === user.id;
	}

	@bindThis
	public async canManage(world: MiCraftWorld, user: MiUser): Promise<boolean> {
		if (world.userId === user.id) return true;
		return await this.roleService.isModerator(user);
	}

	@bindThis
	public async createWorld(user: MiUser, params: { name: string; seed?: number | null; isPublic: boolean }): Promise<MiCraftWorld> {
		const seed = params.seed ?? Math.floor(Math.random() * 2147483647);
		const world = await this.craftWorldsRepository.insertOne({
			id: this.idService.gen(),
			userId: user.id,
			name: params.name,
			seed,
			isPublic: params.isPublic,
			blockCount: 0,
		});
		return world;
	}

	@bindThis
	public async countWorldsOf(user: MiUser): Promise<number> {
		return await this.craftWorldsRepository.countBy({ userId: user.id });
	}

	@bindThis
	public async deleteWorld(world: MiCraftWorld): Promise<void> {
		await this.craftWorldsRepository.delete({ id: world.id });
		this.globalEventService.publishCraftWorldStream(world.id, 'worldDeleted', { worldId: world.id });
	}

	/**
	 * ブロックを置く / 壊す。生成地形を壊した場合も type 0 (空気) の行として保存する。
	 * 成功すると worldStream に blockUpdated を流す。
	 * @returns false のとき権限なし・範囲外・上限超過で何も変えていない
	 */
	@bindThis
	public async setBlock(worldId: MiCraftWorld['id'], user: MiUser, x: number, y: number, z: number, type: number): Promise<boolean> {
		if (!this.isValidPosition(x, y, z) || !this.isValidBlockType(type)) return false;
		// 最下層は壊せない (クライアントと同じ規則)
		if (type === 0 && y === CRAFT_WORLD.minY) return false;

		const world = await this.craftWorldsRepository.findOneBy({ id: worldId });
		if (world == null) return false;
		if (!this.canBuild(world, user)) return false;

		// 上限の枠を先に原子的に確保し、既存行の更新だった場合は戻す
		const reserved = await this.craftWorldsRepository.createQueryBuilder()
			.update()
			.set({ blockCount: () => '"blockCount" + 1' })
			.where('id = :id AND "blockCount" < :cap', { id: worldId, cap: CRAFT_WORLD.maxBlocksPerWorld })
			.execute();
		if ((reserved.affected ?? 0) === 0) return false;

		const rows = await this.craftBlocksRepository.query(
			`INSERT INTO "craft_block" ("worldId", "x", "y", "z", "type", "userId") VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT ("worldId", "x", "y", "z") DO UPDATE SET "type" = EXCLUDED."type", "userId" = EXCLUDED."userId"
			RETURNING (xmax = 0) AS "inserted"`,
			[worldId, x, y, z, type, user.id],
		) as { inserted: boolean }[];
		if (!rows[0]?.inserted) {
			await this.craftWorldsRepository.createQueryBuilder()
				.update()
				.set({ blockCount: () => 'GREATEST("blockCount" - 1, 0)' })
				.where('id = :id', { id: worldId })
				.execute();
		}

		this.globalEventService.publishCraftWorldStream(worldId, 'blockUpdated', {
			x, y, z, type,
			userId: user.id,
		});

		return true;
	}

	/**
	 * 差分ブロックを [x, y, z, type, x, y, z, type, ...] の平坦な配列で返す
	 */
	@bindThis
	public async getBlocksFlat(worldId: MiCraftWorld['id']): Promise<number[]> {
		const rows = await this.craftBlocksRepository.createQueryBuilder('block')
			.select(['block.x', 'block.y', 'block.z', 'block.type'])
			.where('block.worldId = :worldId', { worldId })
			.getRawMany<{ block_x: number; block_y: number; block_z: number; block_type: number }>();
		const flat: number[] = new Array(rows.length * 4);
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];
			flat[i * 4] = row.block_x;
			flat[i * 4 + 1] = row.block_y;
			flat[i * 4 + 2] = row.block_z;
			flat[i * 4 + 3] = row.block_type;
		}
		return flat;
	}
}
