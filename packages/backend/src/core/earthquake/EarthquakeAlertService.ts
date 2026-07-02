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

const WOLFX_JMA_EEW_URL = 'wss://ws-api.wolfx.jp/jma_eew';
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
// AtpJetstreamService と同じ理由 (silent hang 対策) の接続試行 watchdog。
const CONNECT_TIMEOUT_MS = 20_000;
const HISTORY_LIMIT = 30;

@Injectable()
export class EarthquakeAlertService implements OnModuleInit, OnApplicationShutdown {
	private logger: Logger;
	private ws: WebSocket | null = null;
	private connecting = false;
	private stopped = false;
	private reconnectAttempt = 0;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private connectTimer: NodeJS.Timeout | null = null;
	private suppressNextReconnect = false;
	private history: JmaEewAlert[] = [];
	// isWarn が発報済みのEventIDを保持 (通知欄が埋まるのを防ぐため重要イベントのみpushする判定に使う)。
	private warnedEvents = new Set<string>();
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
		this.closeWs('shutdown');
	}

	@bindThis
	public getHistory(): JmaEewAlert[] {
		// 新しい順で返す。呼び出し元が内部配列を書き換えられないよう複製する。
		return [...this.history].reverse();
	}

	@bindThis
	private start(): void {
		this.stopped = false;
		this.logger.info('starting JMA EEW (Wolfx) subscription');
		this.connect();
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

		this.history.push(evt);
		if (this.history.length > HISTORY_LIMIT) {
			this.history.shift();
		}

		this.logger.info(`EEW: ${evt.Hypocenter} M${evt.Magunitude} 最大震度${evt.MaxIntensity} (Serial=${evt.Serial}, isFinal=${evt.isFinal}, isCancel=${evt.isCancel})`);
		this.globalEventService.publishBroadcastStream('earthquakeAlert', { alert: evt });

		if (this.shouldNotify(evt)) {
			this.notifyAllUsers(evt).catch(e => {
				this.logger.error(`notifyAllUsers failed: ${e instanceof Error ? e.message : String(e)}`);
			});
		}
	}

	// 重要イベントのみ通知 (push) 対象にする。全serialをpushすると通知欄が埋まるため、
	// (1) 警報級に達した最初の瞬間、(2) 最終報、(3) 警報発出後の取消、の3点に絞る。
	@bindThis
	private shouldNotify(evt: JmaEewAlert): boolean {
		// isWarn と isFinal が同一serialで同時に立つケースもあるため、早期returnにせず
		// 独立に判定する (warnedEventsの掃除漏れを防ぐ)。
		let notify = false;

		if (evt.isWarn && !this.warnedEvents.has(evt.EventID)) {
			this.warnedEvents.add(evt.EventID);
			notify = true;
		}
		if (evt.isFinal) {
			this.warnedEvents.delete(evt.EventID);
			notify = true;
		}
		if (evt.isCancel && this.warnedEvents.has(evt.EventID)) {
			this.warnedEvents.delete(evt.EventID);
			notify = true;
		}

		return notify;
	}

	@bindThis
	private async notifyAllUsers(evt: JmaEewAlert): Promise<void> {
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
			});
		}
	}
}
