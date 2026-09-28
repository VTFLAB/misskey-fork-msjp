/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { JuiceSettingsService } from '@/core/JuiceSettingsService.js';
import type { JuiceSettingsValue } from '@/models/JuiceSettings.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireAdmin: true,
	kind: 'write:admin:juice-settings',
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		reactionPiggybackOnRemoteEnabled: { type: 'boolean' },
		reportCategories: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					key: { type: 'string', minLength: 1, maxLength: 64 },
					text: { type: 'string', minLength: 1, maxLength: 128 },
					enabled: { type: 'boolean' },
					order: { type: 'integer' },
					isDefault: { type: 'boolean' },
				},
				required: ['key', 'text', 'enabled', 'order', 'isDefault'],
			},
		},
		aiGeneratedFallbackCwEnabled: { type: 'boolean' },
	},
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private juiceSettingsService: JuiceSettingsService,
		private moderationLogService: ModerationLogService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const before = await this.juiceSettingsService.fetch(true);

			// paramDef に additionalProperties: false を指定していないため、
			// ps には認証トークン(i)等の余分なフィールドが含まれうる。
			// jsonb にそのまま紛れ込ませないよう、既知のフィールドだけを明示的に拾う。
			const set: Partial<JuiceSettingsValue> = {};
			if (ps.reactionPiggybackOnRemoteEnabled !== undefined) set.reactionPiggybackOnRemoteEnabled = ps.reactionPiggybackOnRemoteEnabled;
			if (ps.reportCategories !== undefined) set.reportCategories = ps.reportCategories;
			if (ps.aiGeneratedFallbackCwEnabled !== undefined) set.aiGeneratedFallbackCwEnabled = ps.aiGeneratedFallbackCwEnabled;

			const after = await this.juiceSettingsService.update(set);

			this.moderationLogService.log(me, 'updateJuiceSettings', {
				before,
				after,
			});
		});
	}
}
