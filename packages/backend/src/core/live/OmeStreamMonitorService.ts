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
import type { MiLiveChannel } from '@/models/LiveChannel.js';
import { TwitchStreamService } from '@/core/twitch/TwitchStreamService.js';
import { TwitchCommentService } from '@/core/twitch/TwitchCommentService.js';
import { GoogleOAuthService } from '@/core/google/GoogleOAuthService.js';
import { OmeApiService } from './OmeApiService.js';
import { LiveLoggerService } from './LiveLoggerService.js';

const POLL_INTERVAL_MS = 10 * 1000; // 決定書 §2「10秒間隔でポーリング」
const RECONCILE_INTERVAL_MS = 2 * 60 * 1000; // OME ダウン時の自己修復 (webhook 取り逃し対策、TwitchStreamService と同思想)
const OVERAGE_MARGIN = 1.1; // 10% マージン
// 判定に使う直近サンプル数 (10秒間隔 × 3 ≒ 30秒間の平均、決定書 §2 の「30秒継続」意図を維持)。
// bitrateLatest はサブ秒のバースト (WebRTC のキーフレーム一括送出) に敏感で、規定内の
// CBR 配信 (7500kbps + nal-hrd=cbr) でも実測サンプルが 5888〜8869kbps と ±20% 振れる
// (2026-08-01 実測)。旧実装の「瞬間値が3回連続で閾値超過」は、この計測ノイズだけで
// 長時間配信中に誤切断が起こりうる (超過確率 ~12% で約90分に1回) ため、
// 「直近3サンプルの平均 > 閾値」の判定に変更した。真に上限超過している配信は
// 平均も超えるので従来どおり ~30秒で遮断される
const OVERAGE_WINDOW_SIZE = 3;
const BLACKLIST_TTL_SEC = 10 * 60;
// YouTube アーカイブの 12 時間上限 (LiveRecordingService の YOUTUBE_MAX_DURATION_SEC と同値) に対し、
// 1 時間前からライブチャットへ警告を送る閾値・間隔 (bsky-fork 独自)。
const LONG_STREAM_WARN_THRESHOLD_MS = 11 * 60 * 60 * 1000; // 11h: start warning 1h before YouTube's 12h limit
const LONG_STREAM_WARN_INTERVAL_MS = 5 * 60 * 1000; // re-warn at most every 5 minutes

@Injectable()
export class OmeStreamMonitorService implements OnModuleInit, OnApplicationShutdown {
	private logger: Logger;
	private pollTimer: NodeJS.Timeout | null = null;
	private reconcileTimer: NodeJS.Timeout | null = null;
	// streamKey ごとの直近ビットレートサンプル (kbps)。プロセスローカル、Redis化はしない
	// (監視自体が cluster.isPrimary 限定のため単一プロセス)
	private overageSamples = new Map<string, { video: number[]; audio: number[] }>();
	// OME 到達不能の連続回数 (縮退判定用)
	private consecutiveApiFailures = 0;
	// streamId ごとの最終 12h 警告投稿時刻 (epoch ms)。長時間配信向けの YouTube アーカイブ上限警告
	// (bsky-fork 独自) のスロットリング用。プロセスローカル (監視自体が cluster.isPrimary 限定のため)
	private longStreamWarnedAt = new Map<string, number>();
	// Google 連携 (アーカイブ保存) の事前検証を済ませた streamId 集合。配信ごとに 1 回だけ
	// トークンを検証・refresh し、失効していれば配信中のうちにチャットへ警告する (bsky-fork 独自)
	private googleAuthCheckedStreams = new Set<string>();

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
		private twitchCommentService: TwitchCommentService,
		private googleOAuthService: GoogleOAuthService,
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

			// YouTube 12時間アーカイブ上限の事前警告 (bsky-fork 独自)。OME API に依存しないため
			// getStream 失敗時にも配信者へ届く。失敗が監視ループを壊さないよう try/catch で包む
			try {
				await this.warnLongStreamIfDue(session, channel);
			} catch (err) {
				this.logger.warn(`warnLongStreamIfDue failed (streamId=${session.id}): ${err instanceof Error ? err.message : err}`);
			}

			// アーカイブ保存に使う Google 連携の事前検証 (bsky-fork 独自)。配信終了後のアーカイブ処理で
			// 初めてトークン失効に気付くと録画の保存に失敗するため、配信開始直後に検証・refresh し、
			// 失効していれば配信者がまだ対処できるうちにチャットへ警告する
			try {
				await this.warnBrokenGoogleAuthIfDue(session, channel);
			} catch (err) {
				this.logger.warn(`warnBrokenGoogleAuthIfDue failed (streamId=${session.id}): ${err instanceof Error ? err.message : err}`);
			}

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

			const samples = this.overageSamples.get(channel.streamKey) ?? { video: [], audio: [] };
			samples.video.push(videoBitrateKbps);
			samples.audio.push(audioBitrateKbps);
			if (samples.video.length > OVERAGE_WINDOW_SIZE) samples.video.shift();
			if (samples.audio.length > OVERAGE_WINDOW_SIZE) samples.audio.shift();
			this.overageSamples.set(channel.streamKey, samples);

			// 平坦なCBR配信でも瞬間値サンプルは大きく振れるため、窓が埋まってから平均で判定する
			const videoAvgKbps = samples.video.reduce((a, b) => a + b, 0) / samples.video.length;
			const audioAvgKbps = samples.audio.reduce((a, b) => a + b, 0) / samples.audio.length;
			const videoOver = samples.video.length >= OVERAGE_WINDOW_SIZE && videoAvgKbps > ome.maxVideoBitrate * OVERAGE_MARGIN;
			const audioOver = samples.audio.length >= OVERAGE_WINDOW_SIZE && audioAvgKbps > ome.maxAudioBitrate * OVERAGE_MARGIN;

			if (videoOver || audioOver) {
				await this.cutStream(session, channel.streamKey, videoOver ? 'video' : 'audio', videoAvgKbps, audioAvgKbps);
				this.overageSamples.delete(channel.streamKey);
			}
		}

		// 監視対象から外れたキーのサンプルを掃除 (メモリリーク防止)
		const activeKeys = new Set(activeSessions.map(s => channelsByUserId.get(s.userId)?.streamKey).filter((k): k is string => k != null));
		for (const key of this.overageSamples.keys()) {
			if (!activeKeys.has(key)) this.overageSamples.delete(key);
		}

		// 終了済みセッションの 12h 警告タイムスタンプを掃除 (メモリリーク防止)
		const liveStreamIds = new Set(activeSessions.map(s => s.id));
		for (const id of this.longStreamWarnedAt.keys()) {
			if (!liveStreamIds.has(id)) this.longStreamWarnedAt.delete(id);
		}

		// 終了済みセッションの Google 連携検証済みフラグを掃除 (メモリリーク防止)
		for (const id of this.googleAuthCheckedStreams) {
			if (!liveStreamIds.has(id)) this.googleAuthCheckedStreams.delete(id);
		}
	}

	/**
	 * 遮断シーケンス: DELETE → blacklist → 通知 → markOffline (決定書 §2)。
	 * videoKbps / audioKbps は直近 OVERAGE_WINDOW_SIZE サンプルの平均値。
	 */
	@bindThis
	private async cutStream(session: MiTwitchStream, streamKey: string, cause: 'video' | 'audio', videoKbps: number, audioKbps: number): Promise<void> {
		const reason = cause === 'video'
			? `映像ビットレートが上限を超過しました (直近30秒平均 ${Math.round(videoKbps)}kbps)`
			: `音声ビットレートが上限を超過しました (直近30秒平均 ${Math.round(audioKbps)}kbps)`;

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
	 * YouTube アーカイブの 12 時間上限を超えそうな長時間配信に対し、ライブチャットへ
	 * システム警告コメントを投稿する (bsky-fork 独自、Phase 3)。配信者は配信中チャットしか
	 * 見ないため Misskey 通知ではなくチャットメッセージで届ける。YouTube アップロードが
	 * 無効 (Drive-only) のチャンネルは 12h 上限が無関係のため対象外。
	 */
	@bindThis
	private async warnLongStreamIfDue(stream: MiTwitchStream, channel: MiLiveChannel | null): Promise<void> {
		// 12h 上限は YouTube 固有。YouTube アップロード無効 (Drive-only) は対象外
		if (channel?.youtubeUploadEnabled !== true) return;

		const elapsedMs = Date.now() - stream.startedAt.getTime();
		if (elapsedMs < LONG_STREAM_WARN_THRESHOLD_MS) return;

		const now = Date.now();
		const last = this.longStreamWarnedAt.get(stream.id);
		if (last != null && now - last < LONG_STREAM_WARN_INTERVAL_MS) return;

		this.longStreamWarnedAt.set(stream.id, now);
		const hours = Math.floor(elapsedMs / (60 * 60 * 1000));
		const text = `【システム警告】配信開始から${hours}時間を超えました。YouTubeアーカイブは12時間を超えると保存できません（12時間超の録画はDrive保存のみ、Drive容量が足りなければ録画は失われます）。必要なら配信を終了してアーカイブを確定してください。`;
		await this.twitchCommentService.createSystemComment(stream, text);
		this.logger.warn(`posted 12h-limit warning to chat: streamId=${stream.id} elapsedHours=${hours}`);
	}

	/**
	 * アーカイブ保存に使う Google 連携 (Drive / YouTube) のトークンを配信ごとに 1 回だけ検証する
	 * (bsky-fork 独自)。getValidAccessToken が失効間際の refresh も担うため、正常系では配信開始
	 * 時点でトークンが最新化される。検証に失敗した (refresh 拒否・連携解除済みなど) 場合は、
	 * 配信終了後にアーカイブが失われる前に対処できるよう、ライブチャットへシステム警告を投稿する。
	 * 連携が Google に拒否された瞬間の Misskey 通知 (googleAuthExpired) は GoogleOAuthService 側が送る。
	 */
	@bindThis
	private async warnBrokenGoogleAuthIfDue(stream: MiTwitchStream, channel: MiLiveChannel): Promise<void> {
		if (this.googleAuthCheckedStreams.has(stream.id)) return;
		if (!this.googleOAuthService.isEnabled) return;
		this.googleAuthCheckedStreams.add(stream.id);

		const broken: string[] = [];
		const account = await this.googleOAuthService.getLinkedAccount(stream.userId);
		if (account == null) {
			// Drive 未連携ならアーカイブ自体が対象外なので警告しない。ただし YouTube アップロードを
			// 有効にしたまま連携が消えている (invalid_grant による自動解除など) 場合は保存されない
			if (channel.youtubeUploadEnabled) {
				broken.push('Google Drive', 'YouTube');
			}
		} else {
			if (await this.googleOAuthService.getValidAccessToken(stream.userId, 'drive') == null) {
				broken.push('Google Drive');
			}
			if (channel.youtubeUploadEnabled && await this.googleOAuthService.getValidAccessToken(stream.userId, 'youtube') == null) {
				broken.push('YouTube');
			}
		}
		if (broken.length === 0) return;

		const text = `【システム警告】${broken.join(' / ')}の連携が無効になっているため、この配信のアーカイブ保存は失敗します。配信設定 (設定 → 配信) から再連携してください。`;
		await this.twitchCommentService.createSystemComment(stream, text);
		this.logger.warn(`posted broken-google-auth warning to chat: streamId=${stream.id} broken=${broken.join(',')}`);
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
