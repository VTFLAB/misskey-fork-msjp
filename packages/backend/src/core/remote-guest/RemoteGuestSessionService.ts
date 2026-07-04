/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { randomBytes } from 'node:crypto';
import { Injectable, Inject } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { RemoteGuestAccountsRepository, RemoteGuestSessionsRepository } from '@/models/_.js';
import { MiRemoteGuestSession } from '@/models/RemoteGuestSession.js';
import type { MiRemoteGuestAccount } from '@/models/RemoteGuestAccount.js';
import { IdService } from '@/core/IdService.js';
import { bindThis } from '@/decorators.js';

// セッション有効期間 (アクセスの都度スライディング延長)
const SESSION_TTL_MS = 1000 * 60 * 60 * 24; // 24h

@Injectable()
export class RemoteGuestSessionService {
	constructor(
		@Inject(DI.remoteGuestSessionsRepository)
		private remoteGuestSessionsRepository: RemoteGuestSessionsRepository,

		@Inject(DI.remoteGuestAccountsRepository)
		private remoteGuestAccountsRepository: RemoteGuestAccountsRepository,

		private idService: IdService,
	) {}

	@bindThis
	public async issue(account: MiRemoteGuestAccount): Promise<{ token: string; expiresAt: Date }> {
		const token = randomBytes(32).toString('hex');
		const now = new Date();
		const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

		await this.remoteGuestSessionsRepository.insertOne(new MiRemoteGuestSession({
			id: this.idService.gen(),
			token,
			remoteGuestAccountId: account.id,
			createdAt: now,
			expiresAt,
			lastActiveAt: null,
		}));

		return { token, expiresAt };
	}

	/**
	 * トークンを検証し、有効ならスライディング延長のうえアカウントを返す。
	 * 無効・期限切れなら null (期限切れ行は遅延削除)。
	 */
	@bindThis
	public async validate(token: string): Promise<MiRemoteGuestAccount | null> {
		const session = await this.remoteGuestSessionsRepository.findOneBy({ token });
		if (session == null) return null;

		const now = new Date();
		if (session.expiresAt.getTime() < now.getTime()) {
			await this.remoteGuestSessionsRepository.delete(session.id);
			return null;
		}

		const account = await this.remoteGuestAccountsRepository.findOneBy({ id: session.remoteGuestAccountId });
		if (account == null) {
			await this.remoteGuestSessionsRepository.delete(session.id);
			return null;
		}

		await this.remoteGuestSessionsRepository.update(session.id, {
			expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
			lastActiveAt: now,
		});

		return account;
	}

	@bindThis
	public async revoke(token: string): Promise<boolean> {
		const session = await this.remoteGuestSessionsRepository.findOneBy({ token });
		if (session == null) return false;
		await this.remoteGuestSessionsRepository.delete(session.id);
		return true;
	}
}
