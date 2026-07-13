/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { LiveChannelsRepository, MiUser } from '@/models/_.js';
import { IdService } from '@/core/IdService.js';
import { bindThis } from '@/decorators.js';
import { secureRndstr } from '@/misc/secure-rndstr.js';
import { MiLiveChannel } from '@/models/LiveChannel.js';

@Injectable()
export class LiveChannelService {
	constructor(
		@Inject(DI.liveChannelsRepository)
		private liveChannelsRepository: LiveChannelsRepository,

		private idService: IdService,
	) {
	}

	// 有効化 (= 「配信機能を利用する」トグル ON)。既に行が存在する場合は ALREADY_EXISTS として呼び出し側でエラーにする
	// (endpoint 側で事前に show() の結果を見て判定する。ここでは単純作成のみ行う)。
	@bindThis
	public async create(userId: MiUser['id']): Promise<MiLiveChannel> {
		const now = new Date();
		const id = this.idService.gen();
		await this.liveChannelsRepository.insertOne(new MiLiveChannel({
			id,
			userId,
			enabled: true,
			name: null,
			description: null,
			bannerId: null,
			streamKey: secureRndstr(),
			streamKeyRegeneratedAt: now,
			lastCutReason: null,
			createdAt: now,
		}));

		return await this.liveChannelsRepository.findOneByOrFail({ id });
	}

	// name/description/bannerId/enabled の部分更新。undefined のフィールドは変更しない (twitch/update-settings.ts と同型)。
	@bindThis
	public async update(userId: MiUser['id'], params: {
		enabled?: boolean;
		name?: string | null;
		description?: string | null;
		bannerId?: string | null;
	}): Promise<MiLiveChannel> {
		const channel = await this.liveChannelsRepository.findOneByOrFail({ userId });

		const update: Partial<MiLiveChannel> = {};
		if (params.enabled !== undefined) update.enabled = params.enabled;
		if (params.name !== undefined) update.name = params.name;
		if (params.description !== undefined) update.description = params.description;
		if (params.bannerId !== undefined) update.bannerId = params.bannerId;

		if (Object.keys(update).length > 0) {
			await this.liveChannelsRepository.update(channel.id, update);
		}

		return await this.liveChannelsRepository.findOneByOrFail({ id: channel.id });
	}

	// 新乱数を発行し既存キーを置換する。Phase 2 では OME REST DELETE で旧キーの接続を切断する処理をここに追加する。
	// Phase 1 では乱数の入れ替えのみ行う。
	@bindThis
	public async regenerateStreamKey(userId: MiUser['id']): Promise<MiLiveChannel> {
		const channel = await this.liveChannelsRepository.findOneByOrFail({ userId });
		const now = new Date();

		await this.liveChannelsRepository.update(channel.id, {
			streamKey: secureRndstr(),
			streamKeyRegeneratedAt: now,
		});

		return await this.liveChannelsRepository.findOneByOrFail({ id: channel.id });
	}

	@bindThis
	public async show(userId: MiUser['id']): Promise<MiLiveChannel | null> {
		return await this.liveChannelsRepository.findOneBy({ userId });
	}

	// meId === channel.userId のときのみ streamKey を含める (ClipEntityService.ts の owner-only 分岐と同型)。
	@bindThis
	public async pack(
		src: MiLiveChannel['id'] | MiLiveChannel,
		me?: { id: MiUser['id'] } | null | undefined,
	) {
		const meId = me ? me.id : null;
		const channel = typeof src === 'object' ? src : await this.liveChannelsRepository.findOneByOrFail({ id: src });
		const isOwner = meId === channel.userId;

		return {
			id: channel.id,
			userId: channel.userId,
			enabled: channel.enabled,
			name: channel.name,
			description: channel.description,
			bannerId: channel.bannerId,
			createdAt: channel.createdAt.toISOString(),
			// 所有者のみ: ストリームキーと再生成日時
			streamKey: isOwner ? channel.streamKey : undefined,
			streamKeyRegeneratedAt: isOwner ? channel.streamKeyRegeneratedAt.toISOString() : undefined,
			lastCutReason: isOwner ? channel.lastCutReason : undefined,
		};
	}
}
