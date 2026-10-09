/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { CraftWorldsRepository } from '@/models/_.js';
import type { Packed } from '@/misc/json-schema.js';
import type { MiCraftWorld } from '@/models/CraftWorld.js';
import { bindThis } from '@/decorators.js';
import { IdService } from '@/core/IdService.js';
import { UserEntityService } from './UserEntityService.js';

@Injectable()
export class CraftWorldEntityService {
	constructor(
		@Inject(DI.craftWorldsRepository)
		private craftWorldsRepository: CraftWorldsRepository,

		private userEntityService: UserEntityService,
		private idService: IdService,
	) {
	}

	@bindThis
	public async pack(
		src: MiCraftWorld['id'] | MiCraftWorld,
		hint?: {
			packedUser?: Packed<'UserLite'>,
		},
	): Promise<Packed<'CraftWorld'>> {
		const world = typeof src === 'object' ? src : await this.craftWorldsRepository.findOneByOrFail({ id: src });

		const user = hint?.packedUser ?? await this.userEntityService.pack(world.user ?? world.userId);

		return {
			id: world.id,
			createdAt: this.idService.parse(world.id).date.toISOString(),
			name: world.name,
			seed: world.seed,
			isPublic: world.isPublic,
			userId: world.userId,
			user,
			blockCount: world.blockCount,
		};
	}

	@bindThis
	public async packMany(worlds: MiCraftWorld[]): Promise<Packed<'CraftWorld'>[]> {
		if (worlds.length === 0) return [];

		const userIds = [...new Set(worlds.map(w => w.userId))];
		const packedUsers = await this.userEntityService.packMany(userIds);
		const userMap = new Map(packedUsers.map(u => [u.id, u]));

		return await Promise.all(worlds.map(world => this.pack(world, {
			packedUser: userMap.get(world.userId),
		})));
	}
}
