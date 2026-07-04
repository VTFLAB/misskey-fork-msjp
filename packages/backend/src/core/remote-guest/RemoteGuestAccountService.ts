/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, Inject } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { RemoteGuestAccountsRepository } from '@/models/_.js';
import { MiRemoteGuestAccount } from '@/models/RemoteGuestAccount.js';
import { IdService } from '@/core/IdService.js';
import { bindThis } from '@/decorators.js';

export type RemoteGuestProfileSnapshot = {
	displayName: string | null;
	avatarUrl: string | null;
};

@Injectable()
export class RemoteGuestAccountService {
	constructor(
		@Inject(DI.remoteGuestAccountsRepository)
		private remoteGuestAccountsRepository: RemoteGuestAccountsRepository,

		private idService: IdService,
	) {}

	/**
	 * MiAuth check で本人性確認済みのユーザーを upsert する。
	 * (usernameLower, host) の一意性で同一アイデンティティを判定する。
	 */
	@bindThis
	public async upsertFromMiAuthUser(username: string, host: string, snapshot: RemoteGuestProfileSnapshot): Promise<MiRemoteGuestAccount> {
		const usernameLower = username.toLowerCase();
		const now = new Date();

		const existing = await this.remoteGuestAccountsRepository.findOneBy({ usernameLower, host });
		if (existing != null) {
			await this.remoteGuestAccountsRepository.update(existing.id, {
				username,
				displayName: snapshot.displayName,
				avatarUrl: snapshot.avatarUrl,
				lastLoginAt: now,
			});
			return { ...existing, username, displayName: snapshot.displayName, avatarUrl: snapshot.avatarUrl, lastLoginAt: now };
		}

		return await this.remoteGuestAccountsRepository.insertOne(new MiRemoteGuestAccount({
			id: this.idService.gen(),
			username,
			usernameLower,
			host,
			displayName: snapshot.displayName,
			avatarUrl: snapshot.avatarUrl,
			lastLoginAt: now,
			createdAt: now,
		}));
	}
}
