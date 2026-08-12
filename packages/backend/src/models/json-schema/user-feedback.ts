/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const packedUserFeedbackSchema = {
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
		type: {
			type: 'string',
			optional: false, nullable: false,
			enum: ['bug', 'feature'],
		},
		title: {
			type: 'string',
			optional: false, nullable: false,
		},
		body: {
			type: 'string',
			optional: false, nullable: false,
		},
		status: {
			type: 'string',
			optional: false, nullable: false,
			enum: ['open', 'inProgress', 'resolved', 'rejected'],
		},
		response: {
			type: 'string',
			optional: false, nullable: true,
		},
		files: {
			type: 'array',
			optional: false, nullable: false,
			items: {
				type: 'object',
				optional: false, nullable: false,
				ref: 'DriveFile',
			},
		},
	},
} as const;
