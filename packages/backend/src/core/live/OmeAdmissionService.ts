/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, Inject } from '@nestjs/common';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import type { LiveChannelsRepository, TwitchStreamsRepository } from '@/models/_.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { TwitchStreamService } from '@/core/twitch/TwitchStreamService.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { LiveLoggerService } from './LiveLoggerService.js';

export type OmeAdmissionRequest = {
	direction: 'incoming' | 'outgoing';
	protocol: 'webrtc' | 'llhls' | 'thumbnail';
	status: 'opening' | 'closing';
	url: string;
};

export type OmeOpeningDecision = {
	allowed: boolean;
	reason: string;
	// afterOpeningAllowed() に渡すための内部情報 (allowed=false の場合は無視される)
	liveChannel?: { userId: string; name: string | null };
};

/**
 * OME AdmissionWebhooks の判定ロジック (bsky-fork 独自)。
 *
 * 目的は SignedPolicy だけでは実現できない「ビットレート超過で cut された streamKey の
 * 再接続を ingest 開始時点 (opening) で拒否する」こと (OmeStreamMonitorService.cutStream が
 * 立てる `ome:blacklist:<streamKey>` を参照する)。これが無いと、cut 後に同じ streamKey で
 * OBS が再接続した場合 OME は SignedPolicy の署名だけを見て普通に受理してしまい、
 * 高ビットレード配信によるサーバー負荷を実質的に防げない (10秒ポーリングでの再検知・再cutを
 * 繰り返す「もぐら叩き」になるだけで、その間トランスコード負荷は発生し続ける)。
 *
 * ライブセッションの作成・フォロワー通知・自動ノート投稿は既存 TwitchStreamService.markOmeStreamLive
 * (OmeStreamMonitorService の10秒ポーリング検知からも呼ばれる、冪等) に委譲し、通知経路を二重実装しない。
 */
@Injectable()
export class OmeAdmissionService {
	private logger: Logger;

	constructor(
		@Inject(DI.liveChannelsRepository)
		private liveChannelsRepository: LiveChannelsRepository,

		@Inject(DI.twitchStreamsRepository)
		private twitchStreamsRepository: TwitchStreamsRepository,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		private twitchStreamService: TwitchStreamService,
		private globalEventService: GlobalEventService,
		private liveLoggerService: LiveLoggerService,
	) {
		this.logger = this.liveLoggerService.child('admission');
	}

	// URL (scheme://host[:port]/app/stream[/file]?query) から stream 名 (= streamKey) を抜き出す。
	// OME の app 名は config.ome.app 固定 (決定書「app 名は live 固定」) なので、path の第2セグメントを使う。
	@bindThis
	private extractStreamKey(url: string): string | null {
		try {
			const u = new URL(url);
			const segments = u.pathname.split('/').filter(s => s.length > 0);
			// segments = [app, stream, ...file] 形式
			return segments[1] ?? null;
		} catch {
			return null;
		}
	}

	@bindThis
	private blacklistKey(streamKey: string): string {
		return `ome:blacklist:${streamKey}`;
	}

	// LiveChannelService.issueViewToken() / verifyViewToken() と完全に同一の key 形式。
	@bindThis
	private viewTokenKey(token: string): string {
		return `ome:viewtoken:${token}`;
	}

	@bindThis
	private extractViewToken(url: string): string | null {
		try {
			return new URL(url).searchParams.get('vt');
		} catch {
			return null;
		}
	}

	/**
	 * direction: incoming (配信者からの ingest) / outgoing (視聴) の opening 判定。
	 * OmeServerService から呼ばれ、Server.xml の AdmissionWebhooks Timeout (3000ms) 以内に
	 * 完了する必要がある (DB 1クエリ + Redis 1クエリのみ)。
	 */
	@bindThis
	public async decideOpening(req: OmeAdmissionRequest): Promise<OmeOpeningDecision> {
		if (req.direction === 'outgoing') {
			// 視聴 (WebRTC egress) は SignedPolicy 非適用の匿名視聴を許すため、public 配信は常に許可する。
			// public 以外 (視聴制限あり) は、twitch/streams/show / verify-view-password が発行した
			// 視聴トークン (`?vt=`) が Redis 上で streamKey と一致する場合のみ許可する
			// (視聴制限 enforcement 設計、確定済み — API で playbackUrl を隠すだけでは
			// OME の wss endpoint へ直結できてしまうため、ここでの実効遮断が必須)。
			const streamKey = this.extractStreamKey(req.url);
			if (streamKey == null) {
				return { allowed: false, reason: 'cannot extract stream key from url' };
			}

			const liveChannel = await this.liveChannelsRepository.findOneBy({ streamKey });
			if (liveChannel == null || liveChannel.visibility === 'public') {
				return { allowed: true, reason: 'outgoing (playback) is always allowed for public streams' };
			}

			const viewToken = this.extractViewToken(req.url);
			if (viewToken == null) {
				return { allowed: false, reason: 'view token required for restricted stream' };
			}

			const tokenStreamKey = await this.redisClient.get(this.viewTokenKey(viewToken));
			if (tokenStreamKey !== streamKey) {
				this.logger.info(`outgoing admission denied (invalid view token): streamKey=${streamKey}`);
				return { allowed: false, reason: 'invalid or expired view token' };
			}

			return { allowed: true, reason: 'authorized view token' };
		}

		const streamKey = this.extractStreamKey(req.url);
		if (streamKey == null) {
			return { allowed: false, reason: 'cannot extract stream key from url' };
		}

		const blacklisted = await this.redisClient.exists(this.blacklistKey(streamKey));
		if (blacklisted === 1) {
			this.logger.info(`admission denied (blacklisted): streamKey=${streamKey}`);
			return { allowed: false, reason: 'stream key is temporarily blocked' };
		}

		const liveChannel = await this.liveChannelsRepository.findOneBy({ streamKey, enabled: true });
		if (liveChannel == null) {
			this.logger.info(`admission denied (no matching live_channel): streamKey=${streamKey}`);
			return { allowed: false, reason: 'unknown or disabled stream key' };
		}

		// 多重配信防止: 配信者が OBS を再起動した際に自分自身をブロックしないよう、
		// 既存 isLive セッションは閉じてから新規接続を許可する (OmeStreamMonitorService.cutStream と同型)。
		const existingLive = await this.twitchStreamsRepository.findBy({
			userId: liveChannel.userId,
			isLive: true,
			source: 'ome',
		});
		for (const s of existingLive) {
			await this.twitchStreamsRepository.update(s.id, { isLive: false, endedAt: new Date() });
			this.globalEventService.publishTwitchLiveStream(s.id, 'streamEnded', {});
			this.logger.info(`closed stale ome session: streamId=${s.id} (superseded by new opening)`);
		}

		return {
			allowed: true,
			reason: 'authorized',
			liveChannel: { userId: liveChannel.userId, name: liveChannel.name },
		};
	}

	/**
	 * decideOpening() が allowed:true (incoming) を返した直後、応答送信後に非同期で呼ばれる。
	 * markOmeStreamLive は既に isLive なら何もしない冪等実装なので、ポーリング側 (10秒) と
	 * 競合しても二重通知・二重セッション作成は起きない。
	 */
	@bindThis
	public async afterOpeningAllowed(decision: OmeOpeningDecision): Promise<void> {
		if (decision.liveChannel == null) return;
		await this.twitchStreamService.markOmeStreamLive(decision.liveChannel.userId, decision.liveChannel.name);
	}

	/**
	 * direction: incoming + status: closing。OmeServerService から非同期に呼ばれる (応答は既に空 JSON 送信済み)。
	 */
	@bindThis
	public async handleClosing(req: OmeAdmissionRequest): Promise<void> {
		if (req.direction === 'outgoing') return;

		const streamKey = this.extractStreamKey(req.url);
		if (streamKey == null) return;

		const liveChannel = await this.liveChannelsRepository.findOneBy({ streamKey });
		if (liveChannel == null) return;

		const liveSessions = await this.twitchStreamsRepository.findBy({
			userId: liveChannel.userId,
			isLive: true,
			source: 'ome',
		});
		for (const s of liveSessions) {
			await this.twitchStreamsRepository.update(s.id, { isLive: false, endedAt: new Date() });
			this.globalEventService.publishTwitchLiveStream(s.id, 'streamEnded', {});
		}
		if (liveSessions.length > 0) {
			this.logger.info(`ome stream ended (admission closing): user=${liveChannel.userId} streamKey=${streamKey}`);
		}
	}
}
