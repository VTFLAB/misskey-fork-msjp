/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import cluster from 'node:cluster';
import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { LoggerService } from '@/core/LoggerService.js';
import { EarthquakeAlertService } from '@/core/earthquake/EarthquakeAlertService.js';
import type { JmaEewAlert } from '@/core/earthquake/EarthquakeAlertService.js';

// P2P地震情報 JSON API v2 (https://www.p2pquake.net/develop/json_api_v2/) の
// WebSocket feed。code 556 = 緊急地震速報 (警報) のみを扱う並行ソースで、
// Wolfx より先に届いた場合に警報の第一報を前倒しする + Wolfx 単一障害点の冗長化が目的
// (2026-07-11 に Wolfx が silent hang で2日間停止した実績がある)。
// 予報 (非警報) は P2P地震情報では配信されないため、従来どおり Wolfx のみが担う。
// 重複排除は EarthquakeAlertService.ingest 側の EventID + 発生時刻ガードが一元的に行う。

// 556 payload の必要部分 (フィールドは API v2 ドキュメント準拠)
export type P2pquakeEewMessage = {
	code: number;
	cancelled: boolean;
	earthquake?: {
		originTime?: string;
		arrivalTime?: string;
		hypocenter?: {
			name?: string;
			depth?: number;
			latitude?: number;
			longitude?: number;
			magnitude?: number;
		};
	};
	issue: {
		eventId: string;
		serial: string;
		time: string;
	};
	areas?: {
		pref: string;
		name: string;
		scaleFrom: number;
		scaleTo: number;
	}[];
};

const P2PQUAKE_WS_URL = 'wss://api.p2pquake.net/v2/ws';
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
const CONNECT_TIMEOUT_MS = 20_000;
// P2P地震情報の WS は地震情報以外 (551/555 等) も流れてくるが頻度が読めないため、
// Wolfx (毎分 heartbeat) より大幅に緩い 60 分無音で half-open と判定する。
const HEARTBEAT_CHECK_INTERVAL_MS = 60_000;
const HEARTBEAT_TIMEOUT_MS = 60 * 60_000;

// P2P地震情報の震度スケール (10,20,...,70) → JMA 震度階級文字列
const SCALE_TO_INTENSITY = new Map<number, string>([
	[10, '1'], [20, '2'], [30, '3'], [40, '4'],
	[45, '5弱'], [50, '5強'], [55, '6弱'], [60, '6強'], [70, '7'],
]);

// 556 メッセージを Wolfx 互換の JmaEewAlert へ変換する。556 は定義上すべて警報。
// 変換できない (556 でない・必須情報欠落) 場合は null。
export function p2pquakeEewToJmaAlert(msg: P2pquakeEewMessage): JmaEewAlert | null {
	if (msg.code !== 556) return null;
	// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
	if (msg.issue?.eventId == null || msg.issue.eventId === '') return null;

	// 最大予測震度 = 全対象地域の scaleTo の最大 (99 =「〜程度以上」の未確定値は除外)
	let maxScale = -1;
	for (const area of msg.areas ?? []) {
		if (area.scaleTo !== 99 && area.scaleTo > maxScale) maxScale = area.scaleTo;
		if (area.scaleFrom !== 99 && area.scaleFrom > maxScale) maxScale = area.scaleFrom;
	}
	const hypo = msg.earthquake?.hypocenter;

	return {
		type: 'jma_eew',
		Title: '緊急地震速報（警報）',
		CodeType: 'P2P地震情報 556',
		'Issue.Source': 'p2pquake',
		'Issue.Status': '通常',
		EventID: msg.issue.eventId,
		Serial: Number(msg.issue.serial) || 1,
		AnnouncedTime: msg.issue.time,
		OriginTime: msg.earthquake?.originTime ?? msg.issue.time,
		Hypocenter: hypo?.name ?? '不明',
		Latitude: hypo?.latitude ?? 0,
		Longitude: hypo?.longitude ?? 0,
		Magunitude: hypo?.magnitude ?? 0,
		Depth: hypo?.depth ?? 0,
		MaxIntensity: SCALE_TO_INTENSITY.get(maxScale) ?? '不明',
		isSea: false,
		isTraining: false,
		isAssumption: false,
		isWarn: true,
		isFinal: false,
		isCancel: msg.cancelled,
	};
}

@Injectable()
export class EarthquakeP2pquakeSource implements OnModuleInit, OnApplicationShutdown {
	private logger: Logger;
	private ws: WebSocket | null = null;
	private connecting = false;
	private stopped = false;
	private reconnectAttempt = 0;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private connectTimer: NodeJS.Timeout | null = null;
	private heartbeatTimer: NodeJS.Timeout | null = null;
	private lastMessageAt: number | null = null;

	constructor(
		private loggerService: LoggerService,
		private earthquakeAlertService: EarthquakeAlertService,
	) {
		this.logger = this.loggerService.getLogger('earthquake-p2p', 'red');
	}

	async onModuleInit(): Promise<void> {
		if (process.env.EARTHQUAKE_ALERT_DISABLE === '1') {
			this.logger.info('disabled via EARTHQUAKE_ALERT_DISABLE env');
			return;
		}
		// EarthquakeAlertService と同じく cluster primary のみで購読する。
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
	private start(): void {
		this.stopped = false;
		this.logger.info('starting P2P地震情報 EEW (warning) subscription');
		this.scheduleHeartbeatCheck();
		this.connect();
	}

	@bindThis
	private scheduleHeartbeatCheck(): void {
		if (this.heartbeatTimer != null) return;
		this.heartbeatTimer = setInterval(() => {
			if (this.ws == null) return;
			if (this.ws.readyState !== WebSocket.OPEN) return;
			if (this.lastMessageAt == null) return;
			const idleMs = Date.now() - this.lastMessageAt;
			if (idleMs > HEARTBEAT_TIMEOUT_MS) {
				this.logger.warn(`heartbeat watchdog: no messages for ${Math.round(idleMs / 1000)}s; forcing reconnect`);
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
		this.logger.info('connecting to P2P地震情報 WS feed');

		let ws: WebSocket;
		try {
			ws = new WebSocket(P2PQUAKE_WS_URL);
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
			this.lastMessageAt = Date.now();
			this.logger.info('connected to P2P地震情報 WS feed');
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
		// 551 (地震情報) / 555 (地域ピア) など全 code が流れてくる。生存確認として全てカウント。
		this.lastMessageAt = Date.now();
		if (typeof data !== 'string') return;

		let parsed: unknown;
		try {
			parsed = JSON.parse(data);
		} catch (e) {
			this.logger.warn(`malformed message: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}
		if (typeof parsed !== 'object' || parsed == null) return;
		if ((parsed as { code?: unknown }).code !== 556) return;

		const alert = p2pquakeEewToJmaAlert(parsed as P2pquakeEewMessage);
		if (alert == null) {
			this.logger.warn('received 556 but conversion failed (missing eventId?)');
			return;
		}
		this.earthquakeAlertService.ingest(alert, 'p2pquake');
	}
}
