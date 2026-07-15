/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHmac } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { ChannelsRepository, DriveFilesRepository, LiveChannelsRepository, MiUser } from '@/models/_.js';
import type { MiChannel } from '@/models/Channel.js';
import type { Config } from '@/config.js';
import { IdService } from '@/core/IdService.js';
import { bindThis } from '@/decorators.js';
import { secureRndstr } from '@/misc/secure-rndstr.js';
import { MiLiveChannel } from '@/models/LiveChannel.js';
import { DriveFileEntityService } from '@/core/entities/DriveFileEntityService.js';

@Injectable()
export class LiveChannelService {
	constructor(
		@Inject(DI.liveChannelsRepository)
		private liveChannelsRepository: LiveChannelsRepository,

		@Inject(DI.channelsRepository)
		private channelsRepository: ChannelsRepository,

		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		private idService: IdService,
		private driveFileEntityService: DriveFileEntityService,
	) {
	}

	// 有効化 (= 「配信機能を利用する」トグル ON)。既に行が存在する場合は ALREADY_EXISTS として呼び出し側でエラーにする
	// (endpoint 側で事前に show() の結果を見て判定する。ここでは単純作成のみ行う)。
	// live_channel と同時に Misskey channel (community timeline) を作成し、channelId を紐づける。
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
			offlineImageId: null,
			streamKey: secureRndstr(),
			streamKeyRegeneratedAt: now,
			lastCutReason: null,
			createdAt: now,
			channelId: null,
		}));

		const channel = await this.channelsRepository.insertOne({
			id: this.idService.gen(),
			userId,
			name: '配信チャンネル',
			description: null,
			bannerId: null,
			isSensitive: false,
			allowRenoteToExternal: true,
			isLiveChannel: true,
		} as MiChannel);

		await this.liveChannelsRepository.update(id, { channelId: channel.id });

		return await this.liveChannelsRepository.findOneByOrFail({ id });
	}

	// name/description/bannerId/enabled の部分更新。undefined のフィールドは変更しない (twitch/update-settings.ts と同型)。
	// 紐づく Misskey channel も name/description/bannerId の変更時に同期する。
	@bindThis
	public async update(userId: MiUser['id'], params: {
		enabled?: boolean;
		name?: string | null;
		description?: string | null;
		bannerId?: string | null;
		offlineImageId?: string | null;
	}): Promise<MiLiveChannel> {
		const liveChannel = await this.liveChannelsRepository.findOneByOrFail({ userId });

		const update: Partial<MiLiveChannel> = {};
		if (params.enabled !== undefined) update.enabled = params.enabled;
		if (params.name !== undefined) update.name = params.name;
		if (params.description !== undefined) update.description = params.description;
		if (params.bannerId !== undefined) update.bannerId = params.bannerId;
		if (params.offlineImageId !== undefined) update.offlineImageId = params.offlineImageId;

		if (Object.keys(update).length > 0) {
			await this.liveChannelsRepository.update(liveChannel.id, update);
		}

		if (liveChannel.channelId != null && (params.name !== undefined || params.description !== undefined || params.bannerId !== undefined)) {
			const channelUpdate: Partial<MiChannel> = {};
			if (params.name !== undefined) channelUpdate.name = params.name ?? '配信チャンネル';
			if (params.description !== undefined) channelUpdate.description = params.description;
			if (params.bannerId !== undefined) channelUpdate.bannerId = params.bannerId;
			await this.channelsRepository.update(liveChannel.channelId, channelUpdate);
		}

		return await this.liveChannelsRepository.findOneByOrFail({ id: liveChannel.id });
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
		const channel = await this.liveChannelsRepository.findOneBy({ userId });
		if (channel == null) return null;

		// Lazy initialization for live_channel rows created before channelId existed.
		if (channel.channelId == null) {
			const misskeyChannel = await this.channelsRepository.insertOne({
				id: this.idService.gen(),
				userId,
				name: '配信チャンネル',
				description: null,
				bannerId: null,
				isSensitive: false,
				allowRenoteToExternal: true,
				isLiveChannel: true,
			} as MiChannel);

			await this.liveChannelsRepository.update(channel.id, { channelId: misskeyChannel.id });
			channel.channelId = misskeyChannel.id;
		}

		return channel;
	}

	// generateIngestUrls: SignedPolicy 付き WHIP ingest URL を生成する (決定書 §2、00-overview.md D3)。
	//
	// 署名基準の落とし穴 (2026-07-15 実機確認): OME は HAProxy の TLS 終端の背後で動くため、
	// クライアントが https://stream.msjp.pro/... (443) へ接続しても、OME が SignedPolicy 検証で
	// 再構成する URL は「Host ヘッダ + OME signalling listener」= http://stream.msjp.pro:3333/...
	// になる (OME は署名不一致時の 401 応答で expected URL をそのまま返してくれる)。
	// したがって HMAC は「OME が再構成する URL」(signBase) に対して計算しなければ一致せず、
	// OBS からの ingest が 401 で弾かれる。一方 OBS に渡す URL は HAProxy 経由の
	// https://stream.msjp.pro/... (publicBase、TLS) とし、OME 直の 3333 は外部露出しない。
	@bindThis
	public generateIngestUrls(channel: MiLiveChannel, ome: NonNullable<Config['ome']>): {
		whip: string;
	} {
		const urlExpireMs = Date.now() + 100 * 365 * 24 * 60 * 60 * 1000; // 100 years (実質無期限)

		// publicBase: OBS が接続する公開 URL prefix (HAProxy TLS 終端。例 https://stream.msjp.pro)。
		// signBase:   OME が SignedPolicy 検証時に再構成する URL prefix。HAProxy 背後でも OME 直でも
		//             Host ヘッダは publicWhipUrl のホストになり、OME は自身の signalling listener
		//             (平文 http / port 3333) を付けて再構成するため、http://<host>:3333 で署名する。
		const publicBase = ome.publicWhipUrl.replace(/\/$/, '');
		const signBase = `http://${new URL(ome.publicWhipUrl).hostname}:3333`;

		return {
			whip: this.signUrl({
				publicBase,
				signBase,
				app: ome.app,
				stream: channel.streamKey,
				secretKey: ome.signedPolicySecret,
				urlExpireMs,
				extraQuery: { direction: 'whip' }, // OME調査 §7 の WHIP URL 形式
			}),
		};
	}

	// OME調査 §3 の Node.js 実装を移植 (Base64URL エンコード + HMAC-SHA1)。
	// HMAC は signBase (OME が再構成する URL) に対して計算し、返す URL は publicBase を用いる。
	@bindThis
	private signUrl(params: {
		publicBase: string; // OBS が接続する公開 URL prefix (例 https://stream.msjp.pro)
		signBase: string; // OME が SignedPolicy 検証時に再構成する URL prefix (例 http://stream.msjp.pro:3333)
		app: string;
		stream: string;
		secretKey: string;
		urlExpireMs: number;
		extraQuery?: Record<string, string>;
	}): string {
		const policy = { url_expire: params.urlExpireMs };
		const policyEncoded = this.base64UrlEncode(Buffer.from(JSON.stringify(policy), 'utf8'));

		let pathAndQuery = `/${params.app}/${params.stream}?policy=${policyEncoded}`;
		if (params.extraQuery != null) {
			for (const [k, v] of Object.entries(params.extraQuery)) {
				pathAndQuery += `&${k}=${encodeURIComponent(v)}`;
			}
		}

		// 署名は OME が再構成する URL (signBase + path) に対して計算する。
		const signature = createHmac('sha1', params.secretKey).update(`${params.signBase}${pathAndQuery}`).digest();
		const signatureEncoded = this.base64UrlEncode(signature);

		// OBS に渡すのは publicBase (HAProxy TLS) の URL。signature は上記 signBase 版を流用する。
		return `${params.publicBase}${pathAndQuery}&signature=${signatureEncoded}`;
	}

	@bindThis
	private base64UrlEncode(buf: Buffer): string {
		return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

		let banner = channel.banner;
		if (banner == null && channel.bannerId != null) {
			banner = await this.driveFilesRepository.findOneBy({ id: channel.bannerId });
		}
		const bannerUrl = banner != null ? this.driveFileEntityService.getPublicUrl(banner) : null;

		let offlineImage = channel.offlineImage;
		if (offlineImage == null && channel.offlineImageId != null) {
			offlineImage = await this.driveFilesRepository.findOneBy({ id: channel.offlineImageId });
		}
		const offlineImageUrl = offlineImage != null ? this.driveFileEntityService.getPublicUrl(offlineImage) : null;

		return {
			id: channel.id,
			userId: channel.userId,
			enabled: channel.enabled,
			name: channel.name,
			description: channel.description,
			bannerId: channel.bannerId,
			bannerUrl,
			offlineImageId: channel.offlineImageId,
			offlineImageUrl,
			channelId: channel.channelId,
			createdAt: channel.createdAt.toISOString(),
			// 所有者のみ: ストリームキーと再生成日時
			streamKey: isOwner ? channel.streamKey : undefined,
			streamKeyRegeneratedAt: isOwner ? channel.streamKeyRegeneratedAt.toISOString() : undefined,
			lastCutReason: isOwner ? channel.lastCutReason : undefined,
		};
	}

	// 配信チャンネル一覧 (live-channels/list) 用の軽量 pack。streamKey 等の owner-only 分岐を持たないため pack() から分離する。
	// isLive/startedAt は呼び出し側 (endpoint) が twitch_stream(source='ome') を別クエリで取得し Map 突合した値を渡す。
	// user は呼び出し側で UserEntityService.packMany してマージする (twitch/live-streams.ts と同型)。
	@bindThis
	public async packForList(
		channel: MiLiveChannel,
		isLive: boolean,
		startedAt: Date | null,
	) {
		let banner = channel.banner;
		if (banner == null && channel.bannerId != null) {
			banner = await this.driveFilesRepository.findOneBy({ id: channel.bannerId });
		}
		const bannerUrl = banner != null ? this.driveFileEntityService.getPublicUrl(banner) : null;

		let offlineImage = channel.offlineImage;
		if (offlineImage == null && channel.offlineImageId != null) {
			offlineImage = await this.driveFilesRepository.findOneBy({ id: channel.offlineImageId });
		}
		const offlineImageUrl = offlineImage != null ? this.driveFileEntityService.getPublicUrl(offlineImage) : null;

		return {
			id: channel.id,
			userId: channel.userId,
			name: channel.name,
			description: channel.description,
			bannerUrl,
			offlineImageUrl,
			channelId: channel.channelId,
			isLive,
			startedAt: startedAt != null ? startedAt.toISOString() : null,
		};
	}
}
