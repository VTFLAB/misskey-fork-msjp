/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, IsNull, Not } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { FollowingsRepository, UserProfilesRepository, UsersRepository } from '@/models/_.js';
import { MiUser } from '@/models/User.js';
import type { MiLocalUser, MiRemoteUser } from '@/models/User.js';
import { MiUserProfile } from '@/models/UserProfile.js';
import { IdService } from '@/core/IdService.js';
import { DriveService } from '@/core/DriveService.js';
import { DriveFileEntityService } from '@/core/entities/DriveFileEntityService.js';
import { isDuplicateKeyValueError } from '@/misc/is-duplicate-key-value-error.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { AtpLoggerService } from './AtpLoggerService.js';
import { AtpHttpClientService } from './AtpHttpClientService.js';
import { AtpDidResolver } from './AtpDidResolver.js';

// Bsky user = host='bsky.social' の pseudo-remote MiUser として扱う。
// uri='at://<did>', atDid=<did> で identify する。
// avatar/banner は Bsky CDN から DriveService.uploadFromUrl で取り込んで
// 自前 MiDriveFile を作る (avatarId/bannerId 非 null にしないと Misskey が
// `getIdenticonUrl` にフォールバックして表示されない仕様のため)。

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

		@Inject(DI.followingsRepository)
		private followingsRepository: FollowingsRepository,

		private idService: IdService,
		private driveService: DriveService,
		private driveFileEntityService: DriveFileEntityService,
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
					// avatar/banner はトランザクション外で DriveService.uploadFromUrl 経由で取り込み
					// (avatarId が non-null でないと Misskey UI で表示されない)。
					avatarUrl: null,
					bannerUrl: null,
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
		const createdUser = user as MiRemoteUser;
		this.logger.info(`created pseudo-user: userId=${createdUser.id} handle=@${createdUser.username} did=${did}`);

		// avatar/banner の DriveFile 化 (失敗しても user 作成は成功させる)
		const mediaUpdates = await this.resolveAvatarAndBanner(createdUser, profile);
		if (Object.keys(mediaUpdates).length > 0) {
			await this.usersRepository.update(createdUser.id, mediaUpdates);
			Object.assign(createdUser, mediaUpdates);
		}

		return createdUser;
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
		// avatar/banner はトランザクション外で別 update する (DriveFile 取り込みの戻り値で
		// avatarId 等を埋めるため、ここでは触らない)。
		const userUpdates: Partial<MiUser> = {
			username: handle.slice(0, USERNAME_LENGTH),
			usernameLower: handle.toLowerCase().slice(0, USERNAME_LENGTH),
			name: this.truncate(profile.displayName, NAME_LENGTH),
			followersCount: profile.followersCount ?? user.followersCount,
			followingCount: profile.followsCount ?? user.followingCount,
			lastFetchedAt: new Date(),
		};

		await this.usersRepository.update(user.id, userUpdates);
		await this.userProfilesRepository.update({ userId: user.id }, {
			description: this.truncate(profile.description, SUMMARY_LENGTH),
			url: this.profileUrl(handle, did),
		});

		const merged = { ...user, ...userUpdates } as MiRemoteUser;
		const mediaUpdates = await this.resolveAvatarAndBanner(merged, profile);
		if (Object.keys(mediaUpdates).length > 0) {
			await this.usersRepository.update(user.id, mediaUpdates);
			Object.assign(merged, mediaUpdates);
		}

		return merged;
	}

	/**
	 * Bsky CDN の avatar / banner を Misskey の drive に取り込み、avatarId 等を返す。
	 * - 既に同じ URL の DriveFile があれば再利用
	 * - 失敗時は警告ログのみ (user 作成は止めない、識別 icon にフォールバック)
	 *
	 * 返却値は usersRepository.update に渡せる Partial<MiUser>。
	 */
	@bindThis
	private async resolveAvatarAndBanner(user: MiRemoteUser, profile: BskyProfileView): Promise<Partial<MiUser>> {
		const updates: Partial<MiUser> = {};

		const sameAvatar = user.avatarId != null && user.avatar?.uri === profile.avatar;
		if (profile.avatar && !sameAvatar) {
			try {
				const file = await this.driveService.uploadFromUrl({
					url: profile.avatar,
					user: { id: user.id, host: user.host },
					folderId: null,
					uri: profile.avatar,
				});
				updates.avatarId = file.id;
				updates.avatarUrl = this.driveFileEntityService.getPublicUrl(file, 'avatar');
				updates.avatarBlurhash = file.blurhash;
				this.logger.info(`avatar ingested: userId=${user.id} file=${file.id}`);
			} catch (e) {
				this.logger.warn(`avatar download failed for ${user.atDid}: ${e instanceof Error ? e.message : String(e)}`);
			}
		}

		const sameBanner = user.bannerId != null && user.banner?.uri === profile.banner;
		if (profile.banner && !sameBanner) {
			try {
				const file = await this.driveService.uploadFromUrl({
					url: profile.banner,
					user: { id: user.id, host: user.host },
					folderId: null,
					uri: profile.banner,
				});
				updates.bannerId = file.id;
				updates.bannerUrl = this.driveFileEntityService.getPublicUrl(file);
				updates.bannerBlurhash = file.blurhash;
				this.logger.info(`banner ingested: userId=${user.id} file=${file.id}`);
			} catch (e) {
				this.logger.warn(`banner download failed for ${user.atDid}: ${e instanceof Error ? e.message : String(e)}`);
			}
		}

		return updates;
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
	/**
	 * Misskey 標準の UserFollowingService.follow() は local→remote follow を AP follow request
	 * として処理し、followee.inbox に "Follow" を deliver、Accept 待ち。本 fork の pseudo-MiUser
	 * (host='bsky.social') は inbox=null で Accept が永遠に返らず、followings table に行が
	 * 入らない問題があった。ここでは insertFollowingDoc 相当の最小実装で直接 insert する。
	 * upstream の UserFollowingService 自体は touch しない方針 (rebase コスト minimize)。
	 *
	 * cache invalidation を行わないが、Misskey の followings 関連 cache は read-through
	 * (毎回 DB 参照) または短 TTL なので、現状の運用では数秒以内に follow が反映される
	 * (Phase 1-8 期間の env 経由実装でも同等の挙動だった)。
	 */
	@bindThis
	public async directFollow(
		follower: MiLocalUser,
		followee: MiRemoteUser,
	): Promise<void> {
		const exists = await this.followingsRepository.exists({
			where: { followerId: follower.id, followeeId: followee.id },
		});
		if (exists) {
			throw new IdentifiableError('ec3f65c0-a9d1-47d9-8791-b2e7b9dcdced', 'already following');
		}

		await this.followingsRepository.insert({
			id: this.idService.gen(),
			followerId: follower.id,
			followeeId: followee.id,
			followerHost: follower.host,
			followerInbox: null,
			followerSharedInbox: null,
			followeeHost: followee.host,
			followeeInbox: null,
			followeeSharedInbox: null,
		});

		await this.usersRepository.increment({ id: follower.id }, 'followingCount', 1);
		await this.usersRepository.increment({ id: followee.id }, 'followersCount', 1);

		this.logger.info(`directFollow: follower=${follower.id} → followee=${followee.id} (@${followee.username}@${followee.host})`);
	}

	/**
	 * directFollow の逆。pseudo-MiUser に対する unfollow を AP request 経由でなく直接削除する。
	 */
	@bindThis
	public async directUnfollow(
		follower: MiLocalUser,
		followee: MiRemoteUser,
	): Promise<boolean> {
		const result = await this.followingsRepository.delete({
			followerId: follower.id,
			followeeId: followee.id,
		});
		const affected = result.affected ?? 0;
		if (affected > 0) {
			await this.usersRepository.decrement({ id: follower.id }, 'followingCount', affected);
			await this.usersRepository.decrement({ id: followee.id }, 'followersCount', affected);
			this.logger.info(`directUnfollow: follower=${follower.id} → followee=${followee.id} (@${followee.username}@${followee.host})`);
			return true;
		}
		return false;
	}

	@bindThis
	public async listAllDids(): Promise<string[]> {
		// ORDER BY id ASC は AtpJetstreamService.refreshSubscription の join(',') 比較で
		// 「行は同じだが順序が違う」だけで diff 判定 → spurious reconnect 発生を防ぐため必須。
		const rows = await this.usersRepository.find({
			where: { atDid: Not(IsNull()) },
			select: ['atDid'],
			order: { id: 'ASC' },
		});
		return rows.map(r => r.atDid).filter((d): d is string => d != null);
	}
}
