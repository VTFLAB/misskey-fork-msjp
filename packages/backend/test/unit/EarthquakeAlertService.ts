/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { EarthquakeAlertService, intensityRank } from '@/core/earthquake/EarthquakeAlertService.js';
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
});
