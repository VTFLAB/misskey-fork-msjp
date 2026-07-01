/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { EarthquakeAlertService } from '@/core/earthquake/EarthquakeAlertService.js';

const warnAreaSchema = {
	type: 'object',
	optional: false, nullable: false,
	properties: {
		Chiiki: { type: 'string', optional: false, nullable: false },
		Shindo1: { type: 'string', optional: false, nullable: false },
		Shindo2: { type: 'string', optional: false, nullable: false },
		Time: { type: 'string', optional: false, nullable: false },
		Type: { type: 'string', optional: false, nullable: false },
		Arrive: { type: 'boolean', optional: false, nullable: false },
	},
} as const;

export const meta = {
	tags: ['meta'],

	requireCredential: false,
	allowGet: true,
	cacheSec: 10,

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			alerts: {
				type: 'array',
				optional: false, nullable: false,
				items: {
					type: 'object',
					optional: false, nullable: false,
					properties: {
						Title: { type: 'string', optional: false, nullable: false },
						EventID: { type: 'string', optional: false, nullable: false },
						Serial: { type: 'number', optional: false, nullable: false },
						AnnouncedTime: { type: 'string', optional: false, nullable: false },
						OriginTime: { type: 'string', optional: false, nullable: false },
						Hypocenter: { type: 'string', optional: false, nullable: false },
						Latitude: { type: 'number', optional: false, nullable: false },
						Longitude: { type: 'number', optional: false, nullable: false },
						Magunitude: { type: 'number', optional: false, nullable: false },
						Depth: { type: 'number', optional: false, nullable: false },
						MaxIntensity: { type: 'string', optional: false, nullable: false },
						WarnArea: { type: 'array', optional: true, nullable: false, items: warnAreaSchema },
						isSea: { type: 'boolean', optional: false, nullable: false },
						isWarn: { type: 'boolean', optional: false, nullable: false },
						isFinal: { type: 'boolean', optional: false, nullable: false },
						isCancel: { type: 'boolean', optional: false, nullable: false },
					},
				},
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private earthquakeAlertService: EarthquakeAlertService,
	) {
		super(meta, paramDef, async () => {
			return {
				alerts: this.earthquakeAlertService.getHistory(),
			};
		});
	}
}
