/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { DI } from '@/di-symbols.js';
import type { CraftWorldsRepository, MiCraftWorld, MiUser } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import { CraftService } from '@/core/CraftService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { isJsonObject } from '@/misc/json-value.js';
import type { JsonObject, JsonValue } from '@/misc/json-value.js';
import Channel, { type ChannelRequest } from '../channel.js';

/** ユーザーあたりの受付上限 (1 秒あたり)。接続やチャンネルを増やしても合算される */
const MOVE_RATE_PER_SEC = 20;
const SET_BLOCK_RATE_PER_SEC = 30;
const LIMITER_IDLE_MS = 1000 * 60 * 5;

class RateLimiter {
	private tokens: number;
	public last = Date.now();

	constructor(private readonly perSec: number) {
		this.tokens = perSec;
	}

	public take(): boolean {
		const now = Date.now();
		this.tokens = Math.min(this.perSec, this.tokens + (now - this.last) / 1000 * this.perSec);
		this.last = now;
		if (this.tokens < 1) return false;
		this.tokens -= 1;
		return true;
	}
}

// プロセス内でユーザー単位に共有する (worker をまたいだ合算はしない)
const moveLimiters = new Map<MiUser['id'], RateLimiter>();
const setBlockLimiters = new Map<MiUser['id'], RateLimiter>();
let lastSweep = Date.now();

function limiterFor(map: Map<MiUser['id'], RateLimiter>, userId: MiUser['id'], perSec: number): RateLimiter {
	const now = Date.now();
	if (now - lastSweep > LIMITER_IDLE_MS) {
		lastSweep = now;
		for (const m of [moveLimiters, setBlockLimiters]) {
			for (const [id, limiter] of m) {
				if (now - limiter.last > LIMITER_IDLE_MS) m.delete(id);
			}
		}
	}
	let limiter = map.get(userId);
	if (limiter == null) {
		limiter = new RateLimiter(perSec);
		map.set(userId, limiter);
	}
	return limiter;
}

/**
 * Misskey Craft のワールド単位ストリーム (bsky-fork original)。
 * 未ログインでも見学 (受信) はできる。ブロックの設置・移動の送信はログインユーザーのみ。
 */
@Injectable({ scope: Scope.TRANSIENT })
export class CraftWorldChannel extends Channel {
	public readonly chName = 'craftWorld';
	public static shouldShare = false;
	public static requireCredential = false as const;
	private worldId: MiCraftWorld['id'] | null = null;
	private queue: Promise<void> = Promise.resolve();

	constructor(
		@Inject(REQUEST)
		request: ChannelRequest,

		@Inject(DI.craftWorldsRepository)
		private craftWorldsRepository: CraftWorldsRepository,

		private craftService: CraftService,
		private globalEventService: GlobalEventService,
		private loggerService: LoggerService,
	) {
		super(request);
	}

	@bindThis
	public async init(params: JsonObject) {
		if (typeof params.worldId !== 'string') return;
		const world = await this.craftWorldsRepository.findOneBy({ id: params.worldId });
		if (world == null) return;
		this.worldId = world.id;

		this.subscriber.on(`craftWorldStream:${this.worldId}`, this.send);
	}

	/** サードパーティのトークンは write:account を持つものだけ書き込める */
	private get canWrite(): boolean {
		if (this.user == null) return false;
		const token = this.connection.token;
		if (token == null) return true;
		return token.permission.includes('write:account');
	}

	@bindThis
	public onMessage(type: string, body: JsonValue) {
		if (this.worldId == null) return;
		switch (type) {
			case 'setBlock':
				if (!isJsonObject(body)) return;
				if (typeof body.x !== 'number' || typeof body.y !== 'number' || typeof body.z !== 'number' || typeof body.type !== 'number') return;
				this.setBlock(body.x, body.y, body.z, body.type);
				break;
			case 'move':
				if (!isJsonObject(body)) return;
				if (typeof body.x !== 'number' || typeof body.y !== 'number' || typeof body.z !== 'number') return;
				if (typeof body.yaw !== 'number' || typeof body.pitch !== 'number') return;
				this.move(body.x, body.y, body.z, body.yaw, body.pitch);
				break;
		}
	}

	@bindThis
	private setBlock(x: number, y: number, z: number, blockType: number) {
		const user = this.user;
		const worldId = this.worldId;
		if (user == null || worldId == null || !this.canWrite) return;
		if (![x, y, z, blockType].every(Number.isFinite)) return;
		if (!limiterFor(setBlockLimiters, user.id, SET_BLOCK_RATE_PER_SEC).take()) {
			this.send('setBlockRejected', { x, y, z });
			return;
		}

		// 同じ接続からの操作は到着順に確定させる
		this.queue = this.queue.then(async () => {
			const ok = await this.craftService.setBlock(worldId, user, x, y, z, blockType);
			if (!ok) this.send('setBlockRejected', { x, y, z });
		}).catch(err => {
			this.loggerService.getLogger('craft').error(err as Error);
			this.send('setBlockRejected', { x, y, z });
		});
	}

	@bindThis
	private move(x: number, y: number, z: number, yaw: number, pitch: number) {
		if (this.user == null || this.worldId == null || !this.canWrite) return;
		if (![x, y, z, yaw, pitch].every(Number.isFinite)) return;
		if (!limiterFor(moveLimiters, this.user.id, MOVE_RATE_PER_SEC).take()) return;

		this.globalEventService.publishCraftWorldStream(this.worldId, 'playerMoved', {
			userId: this.user.id,
			username: this.user.username,
			name: this.user.name,
			avatarUrl: this.user.avatarUrl,
			x, y, z, yaw, pitch,
		});
	}

	@bindThis
	public dispose() {
		if (this.worldId == null) return;
		this.subscriber.off(`craftWorldStream:${this.worldId}`, this.send);
		if (this.user != null) {
			this.globalEventService.publishCraftWorldStream(this.worldId, 'playerLeft', { userId: this.user.id });
		}
	}
}
