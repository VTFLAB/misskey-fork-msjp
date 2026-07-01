/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const packedUpdateInfoSchema = {
	type: 'object',
	properties: {
		id: {
			type: 'string',
			optional: false, nullable: false,
			format: 'id',
			example: 'xxxxxxxxxx',
		},
		createdAt: {
			type: 'string',
			optional: false, nullable: false,
			format: 'date-time',
		},
		updatedAt: {
			type: 'string',
			optional: false, nullable: true,
			format: 'date-time',
		},
		title: {
			type: 'string',
			optional: false, nullable: false,
		},
		text: {
			type: 'string',
			optional: false, nullable: false,
		},
		imageUrl: {
			type: 'string',
			optional: false, nullable: true,
		},
	},
} as const;
