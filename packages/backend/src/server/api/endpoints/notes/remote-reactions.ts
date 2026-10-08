/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import { Inject, Injectable } from '@nestjs/common';
import { In, IsNull, Not } from 'typeorm';
import type { NotesRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { RemoteReactionService } from '@/core/RemoteReactionService.js';
import { EmojiImageIdentityService } from '@/core/EmojiImageIdentityService.js';
import { mergeRemoteReactions } from '@/misc/remote-reactions.js';

// bsky-fork 独自: リモートノートのリアクションを元サーバーから取得し、自サーバーの集計と合わせて返す。
// notes/show-partial-bulk と同じ形で返すので、フロントは同じ経路 ($note.reactions) で反映できる。
// 自サーバーのノートや、元サーバーの API が分からないノートは自サーバーの集計だけを返す。
export const meta = {
	tags: ['notes'],

	requireCredential: true,

	kind: 'read:account',

	limit: {
		duration: ms('1min'),
		max: 60,
	},

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			properties: {
				id: {
					type: 'string',
					optional: false, nullable: false,
				},
				reactions: {
					type: 'object',
					optional: false, nullable: false,
					additionalProperties: {
						type: 'number',
					},
				},
				reactionEmojis: {
					type: 'object',
					optional: false, nullable: false,
					additionalProperties: {
						type: 'string',
					},
				},
				remoteFetchedAt: {
					type: 'string',
					optional: false, nullable: true,
					format: 'date-time',
				},
			},
		},
	},

	errors: {
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		noteIds: { type: 'array', items: { type: 'string', format: 'misskey:id' }, maxItems: 100, minItems: 1 },
	},
	required: ['noteIds'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		private noteEntityService: NoteEntityService,
		private remoteReactionService: RemoteReactionService,
		private emojiImageIdentityService: EmojiImageIdentityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// 自サーバーの集計 (閲覧可否の判定込み)
			const diffs = await this.noteEntityService.fetchDiffs(ps.noteIds, me.id);
			if (diffs.length === 0) return [];

			const notes = await this.notesRepository.find({
				where: { id: In(diffs.map(x => x.id)), userHost: Not(IsNull()) },
				select: { id: true, uri: true, userHost: true },
			});
			const snapshots = await this.remoteReactionService.getMany(notes);
			const userHosts = new Map(notes.map(note => [note.id, note.userHost]));

			return await Promise.all(diffs.map(async diff => {
				const snapshot = snapshots.get(diff.id) ?? null;
				const merged = mergeRemoteReactions(diff, snapshot);
				// 同じ画像の絵文字 (ホスト違い) をまとめる。ここでは同一性の取得を少し待つ
				const grouped = await this.emojiImageIdentityService.group(merged.reactions, {
					noteUserHost: userHosts.get(diff.id) ?? null,
					reactionEmojis: merged.reactionEmojis,
					wait: true,
				});
				return {
					id: diff.id,
					reactions: grouped.reactions,
					reactionEmojis: grouped.reactionEmojis,
					remoteFetchedAt: snapshot ? new Date(snapshot.fetchedAt).toISOString() : null,
				};
			}));
		});
	}
}
