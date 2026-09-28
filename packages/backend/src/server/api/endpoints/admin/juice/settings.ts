/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { JuiceSettingsService } from '@/core/JuiceSettingsService.js';
import { resolveReactionPiggybackSettings, resolveReportCategorySettings, resolveAiGeneratedFallbackCwSettings } from '@/models/JuiceSettings.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireAdmin: true,
	kind: 'read:admin:juice-settings',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			reactionPiggybackOnRemoteEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			reportCategories: {
				type: 'array',
				optional: false, nullable: false,
				items: {
					type: 'object',
					optional: false, nullable: false,
					properties: {
						key: { type: 'string', optional: false, nullable: false },
						text: { type: 'string', optional: false, nullable: false },
						enabled: { type: 'boolean', optional: false, nullable: false },
						order: { type: 'number', optional: false, nullable: false },
						isDefault: { type: 'boolean', optional: false, nullable: false },
					},
				},
			},
			aiGeneratedFallbackCwEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private juiceSettingsService: JuiceSettingsService,
	) {
		super(meta, paramDef, async () => {
			const settings = await this.juiceSettingsService.fetch();
			return {
				...resolveReactionPiggybackSettings(settings),
				...resolveReportCategorySettings(settings),
				...resolveAiGeneratedFallbackCwSettings(settings),
			};
		});
	}
}
