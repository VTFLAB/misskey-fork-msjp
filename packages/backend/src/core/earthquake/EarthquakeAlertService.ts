/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import cluster from 'node:cluster';
import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { LoggerService } from '@/core/LoggerService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { DI } from '@/di-symbols.js';
import type { UsersRepository } from '@/models/_.js';

// Wolfx Open API (https://wolfx.jp/apidoc_en) の JMA EEW (緊急地震速報) WebSocket feed。
// 無料・APIキー不要・認証不要の公開API。フィールド定義はドキュメント準拠 (Magunitude は原文のtypoをそのまま採用)。
export type JmaEewWarnArea = {
	Chiiki: string;
	Shindo1: string;
	Shindo2: string;
	Time: string;
	Type: string;
	Arrive: boolean;
};

export type JmaEewAlert = {
	type: 'jma_eew';
	Title: string;
	CodeType: string;
	'Issue.Source': string;
	'Issue.Status': string;
	EventID: string;
	Serial: number;
	AnnouncedTime: string;
	OriginTime: string;
	Hypocenter: string;
	Latitude: number;
	Longitude: number;
	Magunitude: number;
	Depth: number;
	MaxIntensity: string;
	WarnArea?: JmaEewWarnArea[];
	isSea: boolean;
	isTraining: boolean;
	isAssumption: boolean;
	isWarn: boolean;
	isFinal: boolean;
	isCancel: boolean;
};

// 履歴・通知に採用した報の分類。first=第一報 / final=最終報 / cancel=取消報。
// ここでの「第一報」は Serial=1 ではなく「震度条件を初めて満たし採用された報」を指す
// (深発地震などで途中の serial から震度が引き上がるケースがあるため)。
export type JmaEewReportKind = 'first' | 'final' | 'cancel';

export type JmaEewHistoryEntry = JmaEewAlert & { reportKind: JmaEewReportKind };

// JMA の震度階級文字列 (「1」〜「7」「5弱」「5強」等) を比較可能な数値へ変換する。
// 「不明」や未知の表記は null を返し、震度フィルタでは非該当扱いにする。
export function intensityRank(intensity: string): number | null {
	const m = /^([0-7])(弱|強)?$/.exec(intensity);
	if (m == null) return null;
	return Number(m[1]) + (m[2] === '強' ? 0.5 : 0);
}

const WOLFX_JMA_EEW_URL = 'wss://ws-api.wolfx.jp/jma_eew';
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
// AtpJetstreamService と同じ理由 (silent hang 対策) の接続試行 watchdog。
const CONNECT_TIMEOUT_MS = 20_000;
// Wolfx は heartbeat frame を約1分間隔で常時送ってくるため、5分無音 = half-open TCP と判定できる。
// (2026-07-11 に close イベントが来ないまま2日間受信ゼロになる障害が実際に発生した)
const HEARTBEAT_CHECK_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 5 * 60_000;
const HISTORY_LIMIT = 30;
// 履歴・通知の対象とする最小震度。これ未満 (震度1-2 や解析不能値) の地震はユーザーに出さない。
const MIN_REPORT_INTENSITY = 3;

@Injectable()
export class EarthquakeAlertService implements OnModuleInit, OnApplicationShutdown {
	private logger: Logger;
	private ws: WebSocket | null = null;
	private connecting = false;
	private stopped = false;
	private reconnectAttempt = 0;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private connectTimer: NodeJS.Timeout | null = null;
	private heartbeatTimer: NodeJS.Timeout | null = null;
	private lastMessageAt: number | null = null;
	private suppressNextReconnect = false;
	private history: JmaEewHistoryEntry[] = [];
	// 第一報を採用済みのEventID。1つの地震で続報のたびに履歴・通知が増えるのを防ぎ、
	// 第一報と最終報 (と取消報) だけを採用する判定に使う。
	private reportedEvents = new Set<string>();
	// EventIDごとの直近の有効な最大予測震度。深発地震などでJMAが震度予測を打ち切ると
	// 後続serial (最終報含む) の MaxIntensity が「不明」になるため、表示用に引き継ぐ。
	private lastKnownIntensity = new Map<string, string>();

	constructor(
		private loggerService: LoggerService,
		private globalEventService: GlobalEventService,
		private notificationService: NotificationService,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,
	) {
		this.logger = this.loggerService.getLogger('earthquake', 'red');
	}

	async onModuleInit(): Promise<void> {
		if (process.env.EARTHQUAKE_ALERT_DISABLE === '1') {
			this.logger.info('disabled via EARTHQUAKE_ALERT_DISABLE env');
			return;
		}
		// Jetstream と同じ理由で、cluster worker との重複接続を避けるため primary のみで起動する。
		if (!cluster.isPrimary) {
			this.logger.info(`skip start: not cluster primary (worker.id=${cluster.worker?.id})`);
			return;
		}
		this.start();
	}

	async onApplicationShutdown(): Promise<void> {
		this.stopped = true;
		if (this.reconnectTimer != null) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.heartbeatTimer != null) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
		this.closeWs('shutdown');
	}

	@bindThis
	public getHistory(): JmaEewHistoryEntry[] {
		// 新しい順で返す。呼び出し元が内部配列を書き換えられないよう複製する。
		return [...this.history].reverse();
	}

	@bindThis
	private start(): void {
		this.stopped = false;
		this.logger.info('starting JMA EEW (Wolfx) subscription');
		this.scheduleHeartbeatCheck();
		this.connect();
	}

	@bindThis
	private scheduleHeartbeatCheck(): void {
		if (this.heartbeatTimer != null) return;
		this.heartbeatTimer = setInterval(() => {
			// OPEN な WS が heartbeat timeout 以上無音なら half-open (silent hang) と判定して
			// 強制 close → 通常の reconnect 経路に乗せる。AtpJetstreamService と同じ設計。
			// OPEN 以外を対象外にするのは、接続確立前に殺すと open ハンドラの
			// lastMessageAt 初期化に到達できず death-loop になるため。
			if (this.ws == null) return;
			if (this.ws.readyState !== WebSocket.OPEN) return;
			if (this.lastMessageAt == null) return;
			const idleMs = Date.now() - this.lastMessageAt;
			if (idleMs > HEARTBEAT_TIMEOUT_MS) {
				this.logger.warn(`heartbeat watchdog: no messages for ${Math.round(idleMs / 1000)}s (timeout=${Math.round(HEARTBEAT_TIMEOUT_MS / 1000)}s); forcing reconnect`);
				this.closeWs('heartbeat-timeout');
				this.scheduleReconnect();
			}
		}, HEARTBEAT_CHECK_INTERVAL_MS);
	}

	@bindThis
	private connect(): void {
		if (this.stopped) return;
		if (this.connecting) return;

		this.connecting = true;
		this.logger.info('connecting to Wolfx JMA EEW feed');

		let ws: WebSocket;
		try {
			ws = new WebSocket(WOLFX_JMA_EEW_URL);
		} catch (e) {
			this.connecting = false;
			this.logger.error(`WebSocket construction failed: ${e instanceof Error ? e.message : String(e)}`);
			this.scheduleReconnect();
			return;
		}

		ws.addEventListener('open', () => {
			if (this.ws !== ws) return;
			this.connecting = false;
			this.clearConnectTimer();
			this.reconnectAttempt = 0;
			// 接続直後に初期化しないと、古い lastMessageAt のまま watchdog が即 reconnect する。
			this.lastMessageAt = Date.now();
			this.logger.info('connected to Wolfx JMA EEW feed');
		});
		ws.addEventListener('message', (event: MessageEvent) => {
			if (this.ws !== ws) return;
			this.handleMessage(event.data);
		});
		ws.addEventListener('error', (event) => {
			const msg = (event as Event & { message?: string }).message ?? '(no message)';
			this.logger.warn(`WS error: ${msg}${this.ws === ws ? '' : ' (stale)'}`);
		});
		ws.addEventListener('close', (event) => {
			const stale = this.ws !== ws;
			this.logger.warn(`WS closed (code=${event.code}, reason="${event.reason}")${stale ? ' (stale)' : ''}`);
			if (stale) return;
			this.connecting = false;
			this.ws = null;
			this.clearConnectTimer();
			if (this.suppressNextReconnect) {
				this.suppressNextReconnect = false;
				return;
			}
			this.scheduleReconnect();
		});

		this.ws = ws;

		this.clearConnectTimer();
		this.connectTimer = setTimeout(() => {
			this.connectTimer = null;
			if (this.ws !== ws) return;
			if (ws.readyState === WebSocket.OPEN) return;
			this.logger.warn(`connect watchdog: WS stuck (readyState=${ws.readyState}) for ${CONNECT_TIMEOUT_MS}ms; forcing reconnect`);
			this.closeWs('connect-timeout');
			this.scheduleReconnect();
		}, CONNECT_TIMEOUT_MS);
	}

	@bindThis
	private clearConnectTimer(): void {
		if (this.connectTimer != null) {
			clearTimeout(this.connectTimer);
			this.connectTimer = null;
		}
	}

	@bindThis
	private closeWs(reason: string): void {
		this.clearConnectTimer();
		if (this.ws == null) return;
		try {
			this.ws.close(1000, reason);
		} catch {
			// ignore close errors
		}
		this.ws = null;
		this.connecting = false;
	}

	@bindThis
	private scheduleReconnect(): void {
		if (this.stopped) return;
		if (this.reconnectTimer != null) return;
		const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** this.reconnectAttempt);
		this.reconnectAttempt += 1;
		this.logger.info(`reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, delay);
	}

	@bindThis
	private handleMessage(data: unknown): void {
		// heartbeat frame など jma_eew 以外のメッセージも生存確認としてカウントする。
		this.lastMessageAt = Date.now();
		if (typeof data !== 'string') return;

		let parsed: unknown;
		try {
			parsed = JSON.parse(data);
		} catch (e) {
			this.logger.warn(`malformed message: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}

		if (typeof parsed !== 'object' || parsed == null || (parsed as { type?: unknown }).type !== 'jma_eew') return;
		const evt = parsed as JmaEewAlert;
		// 訓練報は実際の地震ではないため、ユーザー向け通知・履歴には含めない。
		if (evt.isTraining) return;

		// 「不明」になった serial では同一イベントの直近の有効値で補完する。
		// 取消報は震度自体が無意味になるため補完しない。
		if (!evt.isCancel) {
			if (evt.MaxIntensity !== '不明') {
				this.lastKnownIntensity.set(evt.EventID, evt.MaxIntensity);
			} else {
				const known = this.lastKnownIntensity.get(evt.EventID);
				if (known != null) evt.MaxIntensity = known;
			}
		}
		if (evt.isFinal || evt.isCancel) {
			this.lastKnownIntensity.delete(evt.EventID);
		}

		const reportKind = this.classifyReport(evt);
		this.logger.info(`EEW: ${evt.Hypocenter} M${evt.Magunitude} 最大震度${evt.MaxIntensity} (Serial=${evt.Serial}, isFinal=${evt.isFinal}, isCancel=${evt.isCancel}, reportKind=${reportKind ?? 'skip'})`);
		if (reportKind == null) return;

		const entry: JmaEewHistoryEntry = { ...evt, reportKind };
		this.history.push(entry);
		if (this.history.length > HISTORY_LIMIT) {
			this.history.shift();
		}

		this.globalEventService.publishBroadcastStream('earthquakeAlert', { alert: entry });
		this.notifyAllUsers(entry).catch(e => {
			this.logger.error(`notifyAllUsers failed: ${e instanceof Error ? e.message : String(e)}`);
		});
	}

	// 1つの地震 (EventID) につき履歴・通知・トーストに出すのは第一報と最終報 (と取消報) のみ。
	// 全serialを出すと1つの地震で通知欄・履歴が埋まるため。さらに最大予測震度が
	// MIN_REPORT_INTENSITY 未満の地震はそもそも採用しない。null = 採用しない。
	@bindThis
	private classifyReport(evt: JmaEewAlert): JmaEewReportKind | null {
		if (evt.isCancel) {
			// 取消報は第一報を出した地震に限り出す (出していない地震の取消は意味を持たないため)。
			return this.reportedEvents.delete(evt.EventID) ? 'cancel' : null;
		}

		const rank = intensityRank(evt.MaxIntensity);
		const qualifies = rank != null && rank >= MIN_REPORT_INTENSITY;

		if (evt.isFinal) {
			if (this.reportedEvents.delete(evt.EventID)) return 'final';
			// 続報が無く最終報しか来ない小規模イベントでも、震度条件を満たすなら最終報1件だけ出す。
			return qualifies ? 'final' : null;
		}
		if (qualifies && !this.reportedEvents.has(evt.EventID)) {
			this.reportedEvents.add(evt.EventID);
			return 'first';
		}
		return null;
	}

	@bindThis
	private async notifyAllUsers(evt: JmaEewHistoryEntry): Promise<void> {
		const localActiveUsers = await this.usersRepository.findBy({
			host: IsNull(),
			isSuspended: false,
			isDeleted: false,
		});

		for (const user of localActiveUsers) {
			this.notificationService.createNotification(user.id, 'earthquakeAlert', {
				eventId: evt.EventID,
				serial: evt.Serial,
				title: evt.Title,
				hypocenter: evt.Hypocenter,
				magnitude: evt.Magunitude,
				maxIntensity: evt.MaxIntensity,
				isWarn: evt.isWarn,
				isFinal: evt.isFinal,
				isCancel: evt.isCancel,
				reportKind: evt.reportKind,
			});
		}
	}
}
