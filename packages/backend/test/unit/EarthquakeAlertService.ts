/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { EarthquakeAlertService, intensityRank } from '@/core/earthquake/EarthquakeAlertService.js';
import { p2pquakeEewToJmaAlert } from '@/core/earthquake/EarthquakeP2pquakeSource.js';
import { LoggerService } from '@/core/LoggerService.js';

// bsky-fork 独自: 地震速報の「第一報・最終報のみ / 震度3以上」フィルタリングロジックの検証。
// 全serialを出すと1つの地震で履歴・通知が埋まるため、履歴・broadcast・push通知のいずれも
// (1) 震度3以上を初めて満たした報 (=第一報)、(2) 最終報、(3) 第一報後の取消報、
// のみが対象になることを確認する。DB/Redis は使わずコンストラクタ引数を直接モックする。
describe('EarthquakeAlertService', () => {
	let globalEventService: { publishBroadcastStream: ReturnType<typeof vi.fn> };
	let notificationService: { createNotification: ReturnType<typeof vi.fn> };
	let usersRepository: { findBy: ReturnType<typeof vi.fn> };
	let service: EarthquakeAlertService;

	function baseAlert(overrides: Record<string, unknown>) {
		return {
			type: 'jma_eew',
			Title: '緊急地震速報',
			CodeType: 'echo',
			'Issue.Source': 'test',
			'Issue.Status': 'test',
			EventID: 'evt-1',
			Serial: 1,
			AnnouncedTime: '2026-07-02 00:00:00',
			OriginTime: '2026-07-02 00:00:00',
			Hypocenter: 'テスト震源',
			Latitude: 0,
			Longitude: 0,
			Magunitude: 5,
			Depth: 10,
			MaxIntensity: '5弱',
			isSea: false,
			isTraining: false,
			isAssumption: false,
			isWarn: false,
			isFinal: false,
			isCancel: false,
			...overrides,
		};
	}

	beforeEach(() => {
		globalEventService = { publishBroadcastStream: vi.fn() };
		notificationService = { createNotification: vi.fn() };
		usersRepository = { findBy: vi.fn().mockResolvedValue([{ id: 'user1' }, { id: 'user2' }]) };

		service = new EarthquakeAlertService(
			new LoggerService(),
			globalEventService as any,
			notificationService as any,
			usersRepository as any,
		);
	});

	async function feed(overrides: Record<string, unknown>) {
		(service as any).handleMessage(JSON.stringify(baseAlert(overrides)));
		// notifyAllUsers は fire-and-forget (await していない) なので、内部の非同期処理が
		// 完了するまでマイクロタスクを1回消化させる。
		await new Promise(resolve => setImmediate(resolve));
	}

	test('intensityRank は JMA 震度階級を比較可能な数値にする', () => {
		expect(intensityRank('2')).toBe(2);
		expect(intensityRank('3')).toBe(3);
		expect(intensityRank('5弱')).toBe(5);
		expect(intensityRank('5強')).toBe(5.5);
		expect(intensityRank('7')).toBe(7);
		expect(intensityRank('不明')).toBeNull();
	});

	test('震度3未満の報は履歴・broadcast・通知のいずれにも出ない', async () => {
		await feed({ Serial: 1, MaxIntensity: '2' });

		expect(globalEventService.publishBroadcastStream).not.toHaveBeenCalled();
		expect(notificationService.createNotification).not.toHaveBeenCalled();
		expect(service.getHistory().length).toBe(0);
	});

	test('震度3以上を初めて満たした報は第一報として履歴・通知に出る', async () => {
		await feed({ Serial: 1, MaxIntensity: '3' });

		expect(globalEventService.publishBroadcastStream).toHaveBeenCalledTimes(1);
		expect(globalEventService.publishBroadcastStream.mock.calls[0][1].alert.reportKind).toBe('first');
		// 2ユーザー分
		expect(notificationService.createNotification).toHaveBeenCalledTimes(2);
		expect(notificationService.createNotification.mock.calls[0][2].reportKind).toBe('first');
		expect(service.getHistory()[0].reportKind).toBe('first');
	});

	test('第一報と最終報の間の続報は出ない', async () => {
		await feed({ Serial: 1 });
		await feed({ Serial: 2 });
		await feed({ Serial: 3 });
		await feed({ Serial: 4, isFinal: true });

		expect(globalEventService.publishBroadcastStream).toHaveBeenCalledTimes(2);
		// getHistory は新しい順
		expect(service.getHistory().map(e => e.reportKind)).toEqual(['final', 'first']);
		// (第一報 + 最終報) × 2ユーザー
		expect(notificationService.createNotification).toHaveBeenCalledTimes(4);
	});

	test('途中の serial から震度3以上になった地震はその報を第一報として出す', async () => {
		await feed({ Serial: 1, MaxIntensity: '2' });
		await feed({ Serial: 2, MaxIntensity: '4' });

		expect(globalEventService.publishBroadcastStream).toHaveBeenCalledTimes(1);
		const alert = globalEventService.publishBroadcastStream.mock.calls[0][1].alert;
		expect(alert.reportKind).toBe('first');
		expect(alert.Serial).toBe(2);
	});

	test('続報なしで最終報のみでも震度3以上なら最終報1件だけ出す', async () => {
		await feed({ Serial: 1, MaxIntensity: '4', isFinal: true });

		expect(globalEventService.publishBroadcastStream).toHaveBeenCalledTimes(1);
		expect(globalEventService.publishBroadcastStream.mock.calls[0][1].alert.reportKind).toBe('final');
		expect(service.getHistory().length).toBe(1);
	});

	test('震度3未満のまま終わった地震は最終報も出ない', async () => {
		await feed({ Serial: 1, MaxIntensity: '1' });
		await feed({ Serial: 2, MaxIntensity: '1', isFinal: true });

		expect(globalEventService.publishBroadcastStream).not.toHaveBeenCalled();
		expect(notificationService.createNotification).not.toHaveBeenCalled();
		expect(service.getHistory().length).toBe(0);
	});

	test('取消報は第一報を出した地震に限り出す', async () => {
		await feed({ EventID: 'evt-a', Serial: 1, MaxIntensity: '5弱' });
		await feed({ EventID: 'evt-a', Serial: 2, isCancel: true });
		await feed({ EventID: 'evt-b', Serial: 1, MaxIntensity: '2' });
		await feed({ EventID: 'evt-b', Serial: 2, isCancel: true });

		// evt-a: 第一報 + 取消、evt-b: どちらも出ない
		expect(globalEventService.publishBroadcastStream).toHaveBeenCalledTimes(2);
		expect(globalEventService.publishBroadcastStream.mock.calls[1][1].alert.reportKind).toBe('cancel');
		// (第一報 + 取消) × 2ユーザー
		expect(notificationService.createNotification).toHaveBeenCalledTimes(4);
	});

	test('MaxIntensity「不明」は同一イベントの直近の有効値で補完される', async () => {
		await feed({ Serial: 1, MaxIntensity: '4' });
		await feed({ Serial: 2, MaxIntensity: '不明', isFinal: true });

		const final = globalEventService.publishBroadcastStream.mock.calls[1][1].alert;
		expect(final.MaxIntensity).toBe('4');
		expect(final.reportKind).toBe('final');
		expect(service.getHistory()[0].MaxIntensity).toBe('4');
	});

	test('取消報の「不明」は補完しない', async () => {
		await feed({ Serial: 1, MaxIntensity: '4', isWarn: true });
		await feed({ Serial: 2, MaxIntensity: '不明', isCancel: true });

		const cancel = globalEventService.publishBroadcastStream.mock.calls[1][1].alert;
		expect(cancel.MaxIntensity).toBe('不明');
	});

	test('最終報・取消報で保持中の有効値を破棄する (EventID再利用時に持ち越さない)', async () => {
		await feed({ Serial: 1, MaxIntensity: '5弱' });
		await feed({ Serial: 2, MaxIntensity: '不明', isFinal: true });

		expect((service as any).lastKnownIntensity.size).toBe(0);
	});

	test('訓練報 (isTraining) は履歴にも通知にも一切含めない', async () => {
		await feed({ isTraining: true, isWarn: true });

		expect(globalEventService.publishBroadcastStream).not.toHaveBeenCalled();
		expect(notificationService.createNotification).not.toHaveBeenCalled();
		expect(service.getHistory().length).toBe(0);
	});

	test('警報 (isWarn) は震度が「不明」でも採用する', async () => {
		await feed({ Serial: 1, MaxIntensity: '不明', isWarn: true });

		expect(globalEventService.publishBroadcastStream).toHaveBeenCalledTimes(1);
		expect(globalEventService.publishBroadcastStream.mock.calls[0][1].alert.reportKind).toBe('first');
	});

	// 複数ソース購読 (Wolfx + P2P地震情報) の重複ガード検証
	describe('multi-source dedupe', () => {
		async function ingest(overrides: Record<string, unknown>, source = 'test') {
			service.ingest(baseAlert(overrides) as any, source);
			await new Promise(resolve => setImmediate(resolve));
		}

		test('同一EventIDなら別ソースからの同じ地震は第一報を二重に出さない', async () => {
			await ingest({ EventID: 'evt-x', Serial: 1, isWarn: true }, 'p2pquake');
			await ingest({ EventID: 'evt-x', Serial: 1 }, 'wolfx');

			expect(globalEventService.publishBroadcastStream).toHaveBeenCalledTimes(1);
		});

		test('EventIDが不一致でも発生時刻が±3秒以内なら第一報を二重に出さない', async () => {
			await ingest({ EventID: 'evt-p2p', Serial: 1, OriginTime: '2026-08-12 15:00:00', isWarn: true }, 'p2pquake');
			await ingest({ EventID: 'evt-wolfx', Serial: 1, OriginTime: '2026-08-12 15:00:02' }, 'wolfx');

			expect(globalEventService.publishBroadcastStream).toHaveBeenCalledTimes(1);
			// (第一報1回) × 2ユーザーのみ
			expect(notificationService.createNotification).toHaveBeenCalledTimes(2);
		});

		test('EventID不一致の地震でも Wolfx の最終報は最終報として出る (第一報とペアになる)', async () => {
			await ingest({ EventID: 'evt-p2p', Serial: 1, OriginTime: '2026-08-12 15:00:00', isWarn: true }, 'p2pquake');
			await ingest({ EventID: 'evt-wolfx', Serial: 5, OriginTime: '2026-08-12 15:00:01', isFinal: true }, 'wolfx');

			expect(globalEventService.publishBroadcastStream).toHaveBeenCalledTimes(2);
			expect(globalEventService.publishBroadcastStream.mock.calls[1][1].alert.reportKind).toBe('final');
		});

		test('発生時刻が十分離れた別の地震は独立して第一報を出す', async () => {
			await ingest({ EventID: 'evt-1st', Serial: 1, OriginTime: '2026-08-12 15:00:00' });
			await ingest({ EventID: 'evt-2nd', Serial: 1, OriginTime: '2026-08-12 15:05:00' });

			expect(globalEventService.publishBroadcastStream).toHaveBeenCalledTimes(2);
		});
	});
});

// P2P地震情報 556 → JmaEewAlert 変換の検証 (payload は API v2 実データの構造に準拠)
describe('p2pquakeEewToJmaAlert', () => {
	function base556(overrides: Record<string, unknown> = {}) {
		return {
			code: 556,
			cancelled: false,
			earthquake: {
				originTime: '2026/07/29 22:19:36',
				arrivalTime: '2026/07/29 22:19:39',
				hypocenter: { name: '熊本県天草・芦北地方', depth: 10, latitude: 32.4, longitude: 130.5, magnitude: 4.5 },
			},
			issue: { eventId: '20260729221939', serial: '1', time: '2026/07/29 22:19:44' },
			areas: [
				{ pref: '熊本', name: '熊本県熊本', scaleFrom: 45, scaleTo: 45 },
				{ pref: '熊本', name: '熊本県球磨', scaleFrom: 40, scaleTo: 40 },
			],
			...overrides,
		};
	}

	test('警報を JmaEewAlert に変換する (最大震度 = areas の最大)', () => {
		const alert = p2pquakeEewToJmaAlert(base556() as any);
		expect(alert).not.toBeNull();
		expect(alert!.EventID).toBe('20260729221939');
		expect(alert!.Serial).toBe(1);
		expect(alert!.isWarn).toBe(true);
		expect(alert!.isFinal).toBe(false);
		expect(alert!.MaxIntensity).toBe('5弱');
		expect(alert!.Hypocenter).toBe('熊本県天草・芦北地方');
		expect(alert!.OriginTime).toBe('2026/07/29 22:19:36');
	});

	test('取消報は isCancel になる', () => {
		const alert = p2pquakeEewToJmaAlert(base556({ cancelled: true }) as any);
		expect(alert!.isCancel).toBe(true);
	});

	test('scale 99 (程度以上の未確定値) は無視し、有効値が無ければ不明', () => {
		const alert = p2pquakeEewToJmaAlert(base556({ areas: [{ pref: 'x', name: 'y', scaleFrom: 99, scaleTo: 99 }] }) as any);
		expect(alert!.MaxIntensity).toBe('不明');
		// 警報なので不明でも採用対象 (classifyReport 側で isWarn が qualify する)
		expect(alert!.isWarn).toBe(true);
	});

	test('556 以外や eventId 欠落は null', () => {
		expect(p2pquakeEewToJmaAlert(base556({ code: 551 }) as any)).toBeNull();
		expect(p2pquakeEewToJmaAlert(base556({ issue: { eventId: '', serial: '1', time: 'x' } }) as any)).toBeNull();
	});
});
