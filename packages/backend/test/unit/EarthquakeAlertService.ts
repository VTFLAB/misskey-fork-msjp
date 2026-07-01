/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { EarthquakeAlertService } from '@/core/earthquake/EarthquakeAlertService.js';
import { LoggerService } from '@/core/LoggerService.js';

// bsky-fork 独自: 地震速報 push 通知の「重要イベントのみ通知する」フィルタリングロジックの検証。
// 全serialをpushすると通知欄が埋まるため、(1) isWarn初回, (2) isFinal, (3) 警報後のisCancel、
// の3点のみが通知対象になることを確認する。DB/Redis は使わずコンストラクタ引数を直接モックする。
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

	test('isWarn:false の中間serialは通知しない', async () => {
		await feed({ Serial: 1, isWarn: false });

		expect(globalEventService.publishBroadcastStream).toHaveBeenCalledTimes(1);
		expect(notificationService.createNotification).not.toHaveBeenCalled();
	});

	test('isWarnが最初にtrueになった瞬間は通知する', async () => {
		await feed({ Serial: 1, isWarn: false });
		await feed({ Serial: 2, isWarn: true });

		expect(notificationService.createNotification).toHaveBeenCalledTimes(2);
		expect(notificationService.createNotification.mock.calls.every(call => call[1] === 'earthquakeAlert')).toBe(true);
	});

	test('同一イベントの2回目以降のisWarnは通知しない (isFinalまで抑制)', async () => {
		await feed({ Serial: 1, isWarn: true });
		await feed({ Serial: 2, isWarn: true });
		await feed({ Serial: 3, isWarn: true });

		// 最初の1回分 (2ユーザー) のみ
		expect(notificationService.createNotification).toHaveBeenCalledTimes(2);
	});

	test('isFinalは常に通知する', async () => {
		await feed({ Serial: 1, isWarn: false });
		await feed({ Serial: 2, isWarn: false, isFinal: true });

		expect(notificationService.createNotification).toHaveBeenCalledTimes(2);
	});

	test('isWarnの後のisCancelは通知するが、isWarn無しのisCancelは通知しない', async () => {
		await feed({ EventID: 'evt-a', Serial: 1, isWarn: true });
		await feed({ EventID: 'evt-a', Serial: 2, isCancel: true });
		await feed({ EventID: 'evt-b', Serial: 1, isCancel: true });

		// evt-a: isWarn(2件) + isCancel(2件) = 4件、evt-b: isWarn無しのisCancelは0件
		expect(notificationService.createNotification).toHaveBeenCalledTimes(4);
	});

	test('訓練報 (isTraining) は履歴にも通知にも一切含めない', async () => {
		await feed({ isTraining: true, isWarn: true });

		expect(globalEventService.publishBroadcastStream).not.toHaveBeenCalled();
		expect(notificationService.createNotification).not.toHaveBeenCalled();
		expect(service.getHistory().length).toBe(0);
	});
});
