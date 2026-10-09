/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const packedCraftWorldSchema = {
	type: 'object',
	properties: {
		id: {
			type: 'string',
			optional: false, nullable: false,
			format: 'id',
		},
		createdAt: {
			type: 'string',
			optional: false, nullable: false,
			format: 'date-time',
		},
		name: {
			type: 'string',
			optional: false, nullable: false,
		},
		seed: {
			type: 'number',
			optional: false, nullable: false,
		},
		isPublic: {
			type: 'boolean',
			optional: false, nullable: false,
		},
		userId: {
			type: 'string',
			optional: false, nullable: false,
			format: 'id',
		},
		user: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'UserLite',
		},
		blockCount: {
			type: 'number',
			optional: false, nullable: false,
		},
		timeOffset: {
			type: 'number',
			optional: false, nullable: false,
		},
	},
} as const;
