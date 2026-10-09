/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { CraftBlocksRepository, CraftPlayerStatesRepository, CraftSkinsRepository, CraftWorldsRepository, DriveFilesRepository, MiCraftPlayerState, MiCraftWorld, MiDriveFile, MiUser } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { IdService } from '@/core/IdService.js';
import { RoleService } from '@/core/RoleService.js';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity.js';

/**
 * Misskey Craft (bsky-fork original) のワールド定数。
 * frontend の `utility/craft/constants.ts` と同じ値を持つ。
 */
export const CRAFT_WORLD = {
	/** x / z の絶対値の上限 (ワールドは事実上無限) */
	maxCoord: 1000000,
	minY: 0,
	maxY: 95,
	/** どの id が実在するかはクライアントが決める。サーバーは smallint の範囲を絞るだけ */
	maxBlockType: 255,
	/** 岩盤。置けないし壊せない */
	bedrockType: 17,
	maxWorldsPerUser: 20,
	maxBlocksPerWorld: 200000,
	/** スキン画像の上限 (byte) */
	maxSkinFileSize: 1024 * 256,
	/** プレイヤーのセーブデータ (JSON 文字列) の上限 (文字数) */
	/** セーブデータの上限 (UTF-8 の byte 数) */
	maxPlayerStateBytes: 32768,
	/** ユーザーあたりのセーブデータ (ワールド) の数の上限 */
	maxPlayerStatesPerUser: 200,
	/** 1 日の長さ (ms)。昼夜は壁時計と world の timeOffset から決まる */
	dayLengthMs: 20 * 60 * 1000,
} as const;

@Injectable()
export class CraftService {
	constructor(
		@Inject(DI.craftWorldsRepository)
		private craftWorldsRepository: CraftWorldsRepository,

		@Inject(DI.craftBlocksRepository)
		private craftBlocksRepository: CraftBlocksRepository,

		@Inject(DI.craftSkinsRepository)
		private craftSkinsRepository: CraftSkinsRepository,

		@Inject(DI.craftPlayerStatesRepository)
		private craftPlayerStatesRepository: CraftPlayerStatesRepository,

		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		private globalEventService: GlobalEventService,
		private idService: IdService,
		private roleService: RoleService,
	) {
	}

	@bindThis
	public isValidPosition(x: number, y: number, z: number): boolean {
		return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z) &&
			Math.abs(x) <= CRAFT_WORLD.maxCoord &&
			y >= CRAFT_WORLD.minY && y <= CRAFT_WORLD.maxY &&
			Math.abs(z) <= CRAFT_WORLD.maxCoord;
	}

	@bindThis
	public isValidBlockType(type: number): boolean {
		return Number.isInteger(type) && type >= 0 && type <= CRAFT_WORLD.maxBlockType;
	}

	@bindThis
	public isNight(timeOffset: number, now = Date.now()): boolean {
		const day = CRAFT_WORLD.dayLengthMs;
		const t = ((((now + timeOffset) % day) + day) % day) / day;
		return t >= 0.5 && t < 0.97;
	}

	/**
	 * 夜を飛ばして朝にする。夜でなければ何もしない。
	 * @returns 新しい timeOffset。null のとき権限なし・存在しない・夜ではない
	 */
	@bindThis
	public async skipNight(worldId: MiCraftWorld['id'], user: MiUser): Promise<number | null> {
		const world = await this.craftWorldsRepository.findOneBy({ id: worldId });
		if (world == null) return null;
		if (!this.canBuild(world, user)) return null;
		const now = Date.now();
		if (!this.isNight(Number(world.timeOffset), now)) return null;
		const day = CRAFT_WORLD.dayLengthMs;
		const offset = (day - (now % day)) % day;
		await this.craftWorldsRepository.update({ id: worldId }, { timeOffset: offset });
		this.globalEventService.publishCraftWorldStream(worldId, 'timeOffsetUpdated', { worldId, timeOffset: offset });
		return offset;
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
		// 岩盤 (最下層) は置けないし壊せない (クライアントと同じ規則)
		if (type === CRAFT_WORLD.bedrockType) return false;
		if (y === CRAFT_WORLD.minY) return false;

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

	// ----- スキン -----

	@bindThis
	public skinUrlOf(file: MiDriveFile): string {
		return file.webpublicUrl ?? file.url;
	}

	@bindThis
	public async getSkinUrl(userId: MiUser['id']): Promise<string | null> {
		const skin = await this.craftSkinsRepository.findOne({ where: { userId }, relations: { file: true } });
		if (skin?.file == null) return null;
		return this.skinUrlOf(skin.file);
	}

	/**
	 * スキンを設定する。fileId が null なら解除。
	 * @returns 'noSuchFile' | 'invalidFile' | URL (null は解除)
	 */
	@bindThis
	public async setSkin(user: MiUser, fileId: MiDriveFile['id'] | null): Promise<{ ok: true; url: string | null } | { ok: false; reason: 'noSuchFile' | 'invalidFile' }> {
		if (fileId == null) {
			await this.craftSkinsRepository.delete({ userId: user.id });
			return { ok: true, url: null };
		}
		const file = await this.driveFilesRepository.findOneBy({ id: fileId, userId: user.id });
		if (file == null) return { ok: false, reason: 'noSuchFile' };
		if (!['image/png', 'image/webp'].includes(file.type) || file.isLink || file.isSensitive || file.size > CRAFT_WORLD.maxSkinFileSize) return { ok: false, reason: 'invalidFile' };
		const w = file.properties.width;
		const h = file.properties.height;
		if (!(w === 64 && (h === 64 || h === 32))) return { ok: false, reason: 'invalidFile' };

		await this.craftSkinsRepository.upsert({
			userId: user.id,
			fileId: file.id,
			updatedAt: new Date(),
		}, ['userId']);
		return { ok: true, url: this.skinUrlOf(file) };
	}

	// ----- プレイヤーのセーブデータ -----

	@bindThis
	public async getPlayerState(worldId: MiCraftWorld['id'], userId: MiUser['id']): Promise<{ state: Record<string, unknown>; updatedAt: Date } | null> {
		const row = await this.craftPlayerStatesRepository.findOneBy({ worldId, userId });
		if (row == null) return null;
		return { state: row.state, updatedAt: row.updatedAt };
	}

	/**
	 * セーブデータの大きさと中身を検査する。jsonb が受け付けない \u0000 も弾く
	 */
	@bindThis
	public isValidPlayerState(state: Record<string, unknown>): boolean {
		const json = JSON.stringify(state);
		if (Buffer.byteLength(json, 'utf8') > CRAFT_WORLD.maxPlayerStateBytes) return false;
		if (json.includes('\\u0000')) return false;
		return true;
	}

	/**
	 * セーブデータを保存する (ゲームロジックは検証しない)。
	 */
	@bindThis
	public async savePlayerState(worldId: MiCraftWorld['id'], userId: MiUser['id'], state: Record<string, unknown>): Promise<'ok' | 'noSuchWorld' | 'tooLarge' | 'tooMany'> {
		if (!this.isValidPlayerState(state)) return 'tooLarge';
		const exists = await this.craftWorldsRepository.existsBy({ id: worldId });
		if (!exists) return 'noSuchWorld';
		// 新しい行なら、ユーザーあたりの件数の上限を見る
		const existing = await this.craftPlayerStatesRepository.existsBy({ worldId, userId });
		if (!existing) {
			const n = await this.craftPlayerStatesRepository.countBy({ userId });
			if (n >= CRAFT_WORLD.maxPlayerStatesPerUser) return 'tooMany';
		}

		try {
			await this.craftPlayerStatesRepository.upsert({
				worldId,
				userId,
				state: state as QueryDeepPartialEntity<MiCraftPlayerState>['state'],
				updatedAt: new Date(),
			}, ['worldId', 'userId']);
		} catch (err) {
			// 検査の直後にワールドが消えた (外部キー違反)
			if (err instanceof QueryFailedError && (err.driverError as { code?: string } | undefined)?.code === '23503') return 'noSuchWorld';
			throw err;
		}
		return 'ok';
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
