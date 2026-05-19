/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, IsNull, Not } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { UserProfilesRepository, UsersRepository } from '@/models/_.js';
import { MiUser } from '@/models/User.js';
import type { MiRemoteUser } from '@/models/User.js';
import { MiUserProfile } from '@/models/UserProfile.js';
import { IdService } from '@/core/IdService.js';
import { isDuplicateKeyValueError } from '@/misc/is-duplicate-key-value-error.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { AtpLoggerService } from './AtpLoggerService.js';
import { AtpHttpClientService } from './AtpHttpClientService.js';
import { AtpDidResolver } from './AtpDidResolver.js';

// Bsky user = host='bsky.social' の pseudo-remote MiUser として扱う。
// uri='at://<did>', atDid=<did> で identify する。
// avatar/banner は CDN URL をそのまま保存し、Misskey 側で DriveFile を作らない。

export const BSKY_PSEUDO_HOST = 'bsky.social';

const NAME_LENGTH = 128;
const SUMMARY_LENGTH = 2048;
const USERNAME_LENGTH = 128;
const PROFILE_FETCH_INTERVAL = 1000 * 60 * 60 * 6; // 6h

type BskyProfileView = {
	did: string;
	handle?: string;
	displayName?: string;
	description?: string;
	avatar?: string;
	banner?: string;
	followersCount?: number;
	followsCount?: number;
	postsCount?: number;
	indexedAt?: string;
};

@Injectable()
export class AtpPersonService {
	private logger: Logger;

	constructor(
		@Inject(DI.db)
		private db: DataSource,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private idService: IdService,
		private atpLoggerService: AtpLoggerService,
		private atpHttpClientService: AtpHttpClientService,
		private atpDidResolver: AtpDidResolver,
	) {
		this.logger = this.atpLoggerService.child('person');
	}

	/**
	 * DID で識別される Bsky user を取得 (DB 上に居れば返す、無ければ null)。
	 */
	@bindThis
	public async fetchByDid(did: string): Promise<MiRemoteUser | null> {
		const user = await this.usersRepository.findOneBy({ atDid: did });
		return user as MiRemoteUser | null;
	}

	/**
	 * DID から pseudo-MiUser を upsert する。
	 * - 既存があれば profile を refresh (前回 fetch から 6h 以上経っていれば)
	 * - 無ければ DID document + profile を取得して新規作成
	 */
	@bindThis
	public async resolveByDid(did: string, opts: { forceRefresh?: boolean } = {}): Promise<MiRemoteUser> {
		const existing = await this.fetchByDid(did);
		if (existing != null) {
			if (opts.forceRefresh || this.shouldRefresh(existing)) {
				this.logger.debug(`resolveByDid: refresh path for ${did} (userId=${existing.id})`);
				return await this.refresh(existing);
			}
			this.logger.debug(`resolveByDid: cache hit for ${did} (userId=${existing.id})`);
			return existing;
		}
		this.logger.info(`resolveByDid: create path for ${did}`);
		return await this.create(did);
	}

	/**
	 * handle (e.g. jay.bsky.team) から DID を解決して resolveByDid に委譲。
	 */
	@bindThis
	public async resolveByHandle(handle: string): Promise<MiRemoteUser> {
		const res = await this.atpHttpClientService.xrpcGet<{ did: string }>('com.atproto.identity.resolveHandle', { handle });
		if (!res.did) throw new Error(`could not resolve handle: ${handle}`);
		return await this.resolveByDid(res.did);
	}

	@bindThis
	private shouldRefresh(user: MiRemoteUser): boolean {
		if (user.lastFetchedAt == null) return true;
		return Date.now() - user.lastFetchedAt.getTime() > PROFILE_FETCH_INTERVAL;
	}

	@bindThis
	private async create(did: string): Promise<MiRemoteUser> {
		this.logger.info(`creating pseudo-user for ${did}`);

		// DID document と profile を並行取得。
		const [didDoc, profile] = await Promise.all([
			this.atpDidResolver.resolve(did),
			this.fetchProfile(did),
		]);

		const handle = profile.handle ?? didDoc.handle ?? did;
		const uri = `at://${did}`;

		let user: MiRemoteUser | null = null;
		try {
			await this.db.transaction(async (tx: EntityManager) => {
				const created = await tx.save(new MiUser({
					id: this.idService.gen(),
					username: handle.slice(0, USERNAME_LENGTH),
					usernameLower: handle.toLowerCase().slice(0, USERNAME_LENGTH),
					name: this.truncate(profile.displayName, NAME_LENGTH),
					host: BSKY_PSEUDO_HOST,
					uri,
					atDid: did,
					inbox: null,
					sharedInbox: null,
					followersUri: null,
					featured: null,
					tags: [],
					emojis: [],
					isBot: false,
					isExplorable: true,
					isLocked: false,
					avatarUrl: profile.avatar ?? null,
					bannerUrl: profile.banner ?? null,
					followersCount: profile.followersCount ?? 0,
					followingCount: profile.followsCount ?? 0,
					notesCount: 0,
					lastFetchedAt: new Date(),
				})) as MiRemoteUser;

				await tx.save(new MiUserProfile({
					userId: created.id,
					description: this.truncate(profile.description, SUMMARY_LENGTH),
					url: this.profileUrl(handle, did),
					fields: [],
					userHost: BSKY_PSEUDO_HOST,
				}));

				user = created;
			});
		} catch (e) {
			// 競合 (別 worker が先に insert した) は無視して読み直す
			if (isDuplicateKeyValueError(e)) {
				const existing = await this.fetchByDid(did);
				if (existing == null) throw new Error(`duplicate key but pseudo-user not found: ${did}`);
				return existing;
			}
			throw e;
		}

		if (user == null) throw new Error('failed to create pseudo-user');
		this.logger.info(`created pseudo-user: userId=${(user as MiRemoteUser).id} handle=@${(user as MiRemoteUser).username} did=${did}`);
		return user;
	}

	@bindThis
	private async refresh(user: MiRemoteUser): Promise<MiRemoteUser> {
		if (user.atDid == null) throw new Error('refresh called on non-bsky user');
		const did = user.atDid;
		this.logger.info(`refreshing pseudo-user ${did}`);

		const profile = await this.fetchProfile(did).catch((e) => {
			this.logger.warn(`profile refresh failed for ${did}: ${e instanceof Error ? e.message : String(e)}`);
			return null;
		});
		if (profile == null) {
			// 取得失敗時は lastFetchedAt のみ更新して再試行を遅延
			await this.usersRepository.update(user.id, { lastFetchedAt: new Date() });
			return user;
		}

		const handle = profile.handle ?? user.username;
		const userUpdates: Partial<MiUser> = {
			username: handle.slice(0, USERNAME_LENGTH),
			usernameLower: handle.toLowerCase().slice(0, USERNAME_LENGTH),
			name: this.truncate(profile.displayName, NAME_LENGTH),
			avatarUrl: profile.avatar ?? null,
			bannerUrl: profile.banner ?? null,
			followersCount: profile.followersCount ?? user.followersCount,
			followingCount: profile.followsCount ?? user.followingCount,
			lastFetchedAt: new Date(),
		};

		await this.usersRepository.update(user.id, userUpdates);
		await this.userProfilesRepository.update({ userId: user.id }, {
			description: this.truncate(profile.description, SUMMARY_LENGTH),
			url: this.profileUrl(handle, did),
		});

		return { ...user, ...userUpdates } as MiRemoteUser;
	}

	@bindThis
	private async fetchProfile(did: string): Promise<BskyProfileView> {
		return await this.atpHttpClientService.xrpcGet<BskyProfileView>('app.bsky.actor.getProfile', { actor: did });
	}

	@bindThis
	private profileUrl(handle: string, did: string): string {
		// handle が消えた場合でも DID で profile 表示できる。
		const ref = handle !== did ? handle : did;
		return `https://bsky.app/profile/${ref}`;
	}

	@bindThis
	private truncate(value: string | undefined | null, max: number): string | null {
		if (value == null || value === '') return null;
		return value.length > max ? value.slice(0, max) : value;
	}

	/**
	 * 全 Bsky pseudo-user の DID 一覧を返す。Jetstream の wantedDids 構築用。
	 */
	@bindThis
	public async listAllDids(): Promise<string[]> {
		const rows = await this.usersRepository.find({
			where: { atDid: Not(IsNull()) },
			select: ['atDid'],
		});
		return rows.map(r => r.atDid).filter((d): d is string => d != null);
	}
}
