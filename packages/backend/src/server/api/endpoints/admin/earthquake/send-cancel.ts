/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { EarthquakeAlertService } from '@/core/earthquake/EarthquakeAlertService.js';

// bsky-fork 独自: 地震速報の取消報を管理者が手動で発報する。配信元の取消報を受け取れなかった、
// または採用しなかった地震 (誤報) を、履歴・トースト・全ユーザーへの通知で取り消す。
// 全ユーザーへ通知が届くため、管理者のログイン中のセッション (API コンソールなど) からだけ呼べるようにする。
export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireAdmin: true,
	secure: true,
	kind: 'write:admin:meta',

	errors: {
		noSuchEvent: {
			message: 'No such earthquake in the history.',
			code: 'NO_SUCH_EVENT',
			id: '8c003418-1b2b-4b41-9b26-488833603c70',
		},
		alreadySent: {
			message: 'A cancel report for this earthquake was already sent manually within 24 hours.',
			code: 'ALREADY_SENT',
			id: 'bb0904a0-97ca-4404-8b2d-c31589d298d5',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		eventId: { type: 'string', minLength: 1, maxLength: 64 },
	},
	required: ['eventId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private earthquakeAlertService: EarthquakeAlertService,
	) {
		super(meta, paramDef, async (ps) => {
			const result = await this.earthquakeAlertService.sendCancelManually(ps.eventId);
			if (result === 'noSuchEvent') throw new ApiError(meta.errors.noSuchEvent);
			if (result === 'alreadySent') throw new ApiError(meta.errors.alreadySent);
		});
	}
}
