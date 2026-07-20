/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import cluster from 'node:cluster';
import { Injectable, Inject, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import * as Redis from 'ioredis';
import { In } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { LiveChannelsRepository, TwitchStreamsRepository } from '@/models/_.js';
import type { Config } from '@/config.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { MiTwitchStream } from '@/models/TwitchStream.js';
import { TwitchStreamService } from '@/core/twitch/TwitchStreamService.js';
import { OmeApiService } from './OmeApiService.js';
import { LiveLoggerService } from './LiveLoggerService.js';

const POLL_INTERVAL_MS = 10 * 1000; // 決定書 §2「10秒間隔でポーリング」
const RECONCILE_INTERVAL_MS = 2 * 60 * 1000; // OME ダウン時の自己修復 (webhook 取り逃し対策、TwitchStreamService と同思想)
const OVERAGE_MARGIN = 1.1; // 10% マージン
const CONSECUTIVE_OVERAGE_THRESHOLD = 3; // 3回連続 (≒30秒継続)
const BLACKLIST_TTL_SEC = 10 * 60;

@Injectable()
export class OmeStreamMonitorService implements OnModuleInit, OnApplicationShutdown {
	private logger: Logger;
	private pollTimer: NodeJS.Timeout | null = null;
	private reconcileTimer: NodeJS.Timeout | null = null;
	// streamKey ごとの連続超過カウント (プロセスローカル、Redis化はしない: 監視自体が cluster.isPrimary 限定のため単一プロセス)
	private overageCounts = new Map<string, { video: number; audio: number }>();
	// OME 到達不能の連続回数 (縮退判定用)
	private consecutiveApiFailures = 0;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.liveChannelsRepository)
		private liveChannelsRepository: LiveChannelsRepository,

		@Inject(DI.twitchStreamsRepository)
		private twitchStreamsRepository: TwitchStreamsRepository,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		private omeApiService: OmeApiService,
		private twitchStreamService: TwitchStreamService,
		private liveLoggerService: LiveLoggerService,
	) {
		this.logger = this.liveLoggerService.child('monitor');
	}

	async onModuleInit(): Promise<void> {
		if (!this.omeApiService.isEnabled) return;
		// TwitchStreamService.onModuleInit (:52-71) と同じ理由で primary process のみで走らせる。
		if (!cluster.isPrimary) return;

		this.pollTimer = setInterval(() => {
			// 先にライブ開始検知 (listStreams → 未 live なチャンネルを isLive 化)。取得済みの
			// streamKey 集合を使い回して offline 反映 (detectEndedStreams, WI-7) も同じ周期で行う
			// (listStreams を二重に呼ばない)。続いて既存 live セッションのビットレート監視を回す。
			this.detectStartedStreams()
				.then(omeStreamKeySet => {
					if (omeStreamKeySet == null) return;
					return this.detectEndedStreams(omeStreamKeySet);
				})
				.catch(err => {
					this.logger.error(`detect failed: ${err instanceof Error ? err.message : err}`);
				});
			this.pollActiveSessions().catch(err => {
				this.logger.error(`poll failed: ${err instanceof Error ? err.message : err}`);
			});
		}, POLL_INTERVAL_MS);

		this.reconcileTimer = setInterval(() => {
			this.reconcileWithOme().catch(err => {
				this.logger.error(`reconcile failed: ${err instanceof Error ? err.message : err}`);
			});
		}, RECONCILE_INTERVAL_MS);
	}

	async onApplicationShutdown(): Promise<void> {
		if (this.pollTimer != null) clearInterval(this.pollTimer);
		if (this.reconcileTimer != null) clearInterval(this.reconcileTimer);
	}

	/**
	 * OME で publish 中 (listStreams) だが DB に live セッションが無い配信を検出し、
	 * ライブセッション (source=ome, isLive=true) を作成する (bsky-fork 独自)。
	 * AdmissionWebhooks 無効構成でのライブ「開始」検知を担う (offline 化は detectEndedStreams / reconcileWithOme)。
	 * OME 到達不能時はセッションを勝手に作らずスキップ (縮退方針、reconcile と同思想)。
	 *
	 * 戻り値の Set は listStreams() で取得済みの streamKey 集合。呼び出し元の pollTimer が
	 * 同じ 10 秒周期内で detectEndedStreams (WI-7) に使い回し、OME API 呼び出し回数を増やさない。
	 * listStreams 自体が失敗した場合は null を返す (呼び出し元は offline 判定をスキップする)。
	 */
	@bindThis
	public async detectStartedStreams(): Promise<Set<string> | null> {
		if (this.config.ome == null) return null;

		let omeStreamKeys: string[];
		try {
			omeStreamKeys = await this.omeApiService.listStreams();
		} catch (err) {
			this.logger.warn(`detect: listStreams failed, skipping this cycle: ${err instanceof Error ? err.message : err}`);
			return null;
		}
		const omeStreamKeySet = new Set(omeStreamKeys);
		if (omeStreamKeys.length === 0) return omeStreamKeySet;

		const channels = await this.liveChannelsRepository.findBy({ streamKey: In(omeStreamKeys) });
		for (const channel of channels) {
			// ビットレート超過で cut された streamKey はブラックリスト有効期間中は再ライブ化しない。
			if ((await this.redisClient.exists(`ome:blacklist:${channel.streamKey}`)) === 1) continue;
			await this.twitchStreamService.markOmeStreamLive(channel.userId, channel.name);
		}

		return omeStreamKeySet;
	}

	/**
	 * アクティブな source='ome' セッションのみを対象に統計をポーリングし、ビットレート超過を判定する。
	 */
	@bindThis
	public async pollActiveSessions(): Promise<void> {
		const ome = this.config.ome;
		if (ome == null) return;

		const activeSessions = await this.twitchStreamsRepository.find({
			where: { isLive: true, source: 'ome' },
		});
		if (activeSessions.length === 0) return;

		const channelsByUserId = new Map(
			(await this.liveChannelsRepository.findBy({ userId: In(activeSessions.map(s => s.userId)) })) // eslint-disable-line
				.map(c => [c.userId, c]),
		);

		for (const session of activeSessions) {
			const channel = channelsByUserId.get(session.userId);
			if (channel == null) continue;

			let stats: Awaited<ReturnType<OmeApiService['getStream']>>;
			try {
				stats = await this.omeApiService.getStream(channel.streamKey);
				this.consecutiveApiFailures = 0;
			} catch (err) {
				this.consecutiveApiFailures++;
				// OME ダウン時の縮退: エラー連続時はログのみ、セッションを勝手に閉じない (決定書 §2 末尾)。
				this.logger.warn(`getStream failed (streamKey=${channel.streamKey}, consecutive=${this.consecutiveApiFailures}): ${err instanceof Error ? err.message : err}`);
				continue;
			}
			if (stats == null) continue; // ストリーム未存在 (既に切断済み等) は次回 reconcile に任せる

			const videoTrack = stats.input.tracks.find(t => t.type === 'Video');
			const audioTrack = stats.input.tracks.find(t => t.type === 'Audio');

			// bitrateLatest の実挙動 (瞬間値/平均値の意味) は Phase 0 実機検証項目 (00-overview 未確定事項4)。
			// ここでは「最新の瞬間ビットレート」という前提でしきい値判定する。
			const videoBitrateKbps = videoTrack?.video != null ? Number(videoTrack.video.bitrateLatest) / 1000 : 0;
			const audioBitrateKbps = audioTrack?.audio != null ? Number(audioTrack.audio.bitrateLatest) / 1000 : 0;

			const videoOver = videoBitrateKbps > ome.maxVideoBitrate * OVERAGE_MARGIN;
			const audioOver = audioBitrateKbps > ome.maxAudioBitrate * OVERAGE_MARGIN;

			const counts = this.overageCounts.get(channel.streamKey) ?? { video: 0, audio: 0 };
			counts.video = videoOver ? counts.video + 1 : 0;
			counts.audio = audioOver ? counts.audio + 1 : 0;
			this.overageCounts.set(channel.streamKey, counts);

			if (counts.video >= CONSECUTIVE_OVERAGE_THRESHOLD || counts.audio >= CONSECUTIVE_OVERAGE_THRESHOLD) {
				await this.cutStream(session, channel.streamKey, videoOver ? 'video' : 'audio', videoBitrateKbps, audioBitrateKbps);
				this.overageCounts.delete(channel.streamKey);
			}
		}

		// 監視対象から外れたキーのカウントを掃除 (メモリリーク防止)
		const activeKeys = new Set(activeSessions.map(s => channelsByUserId.get(s.userId)?.streamKey).filter((k): k is string => k != null));
		for (const key of this.overageCounts.keys()) {
			if (!activeKeys.has(key)) this.overageCounts.delete(key);
		}
	}

	/**
	 * 遮断シーケンス: DELETE → blacklist → 通知 → markOffline (決定書 §2)。
	 */
	@bindThis
	private async cutStream(session: MiTwitchStream, streamKey: string, cause: 'video' | 'audio', videoKbps: number, audioKbps: number): Promise<void> {
		const reason = cause === 'video'
			? `映像ビットレートが上限を超過しました (${Math.round(videoKbps)}kbps)`
			: `音声ビットレートが上限を超過しました (${Math.round(audioKbps)}kbps)`;

		this.logger.warn(`cutting stream due to bitrate overage: streamKey=${streamKey} cause=${cause} video=${videoKbps}kbps audio=${audioKbps}kbps`);

		// 1. 強制切断
		try {
			await this.omeApiService.deleteStream(streamKey);
		} catch (err) {
			this.logger.error(`deleteStream failed (streamKey=${streamKey}): ${err instanceof Error ? err.message : err}`);
			// DELETE 失敗時もブラックリストと通知は続行する (再接続拒否側で防御を継続するため)
		}

		// 2. ブラックリスト登録 (10分、AdmissionWebhooks opening で再接続拒否)
		await this.redisClient.set(`ome:blacklist:${streamKey}`, '1', 'EX', BLACKLIST_TTL_SEC);

		// 3. 配信者へ通知 (live_channel.lastCutReason に記録。既存 notification 経由の即時プッシュは
		//    Phase 4 のフロント実装と合わせて検討、Phase 2 では DB 記録のみ行う)
		await this.liveChannelsRepository.update({ userId: session.userId }, { lastCutReason: reason });

		// 4. markOffline 相当 + streamEnded 配信 (+ 録画パイプライン起動)
		await this.twitchStreamService.markOmeStreamEnded(session.id);
	}

	/**
	 * OME の listStreams() 結果 (streamKey 集合) と DB の isLive/source=ome セッションを突合し、
	 * OME 側に存在しないのに DB 上 isLive のままのセッションを offline に倒す (WI-7)。
	 * reconcileWithOme (2分間隔、自己修復) と 10秒 pollTimer (detectStartedStreams が取得済みの
	 * 集合を使い回す、offline反映短縮) の双方から呼ばれる共通ロジック。
	 */
	@bindThis
	private async detectEndedStreams(omeStreamKeySet: Set<string>): Promise<void> {
		const activeSessions = await this.twitchStreamsRepository.find({ where: { isLive: true, source: 'ome' } });
		if (activeSessions.length === 0) return;

		const channels = await this.liveChannelsRepository.findBy({ userId: In(activeSessions.map(s => s.userId)) }); // eslint-disable-line
		const channelByUserId = new Map(channels.map(c => [c.userId, c]));

		for (const session of activeSessions) {
			const channel = channelByUserId.get(session.userId);
			if (channel == null) continue;
			if (!omeStreamKeySet.has(channel.streamKey)) {
				this.logger.info(`session ${session.id} (streamKey=${channel.streamKey}) is not present on OME, marking offline (webhook likely missed)`);
				await this.twitchStreamService.markOmeStreamEnded(session.id);
			}
		}
	}

	/**
	 * OME ダウン時の webhook 取り逃し自己修復: listStreams() を取得し直して detectEndedStreams に渡す。
	 * 2分間隔 (決定書 §2「listStreams と DB の突合を2分間隔で実施」)。10秒 pollTimer 側の
	 * offline反映短縮 (WI-7) とは独立したセーフティネットとして存置する。
	 */
	@bindThis
	public async reconcileWithOme(): Promise<void> {
		if (this.config.ome == null) return;

		let omeStreamKeys: string[];
		try {
			omeStreamKeys = await this.omeApiService.listStreams();
		} catch (err) {
			this.logger.warn(`reconcile: listStreams failed, skipping this cycle: ${err instanceof Error ? err.message : err}`);
			return; // OME 到達不能時はセッションを勝手に閉じない (縮退方針)
		}

		await this.detectEndedStreams(new Set(omeStreamKeys));
	}
}
