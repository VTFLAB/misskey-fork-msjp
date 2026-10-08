/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Brackets, type FindOptionsWhere } from 'typeorm';
import type { NoteReactionsRepository } from '@/models/_.js';
import type { MiNoteReaction } from '@/models/NoteReaction.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { NoteReactionEntityService } from '@/core/entities/NoteReactionEntityService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { DI } from '@/di-symbols.js';
import { QueryService } from '@/core/QueryService.js';
import { GetterService } from '@/server/api/GetterService.js';
import { EmojiImageIdentityService } from '@/core/EmojiImageIdentityService.js'; // bsky-fork
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['notes', 'reactions'],

	requireCredential: false,

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'NoteReaction',
		},
	},

	errors: {
		noSuchNote: {
			message: 'No such note.',
			code: 'NO_SUCH_NOTE',
			id: '263fff3d-d0e1-4af4-bea7-8408059b451a',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		noteId: { type: 'string', format: 'misskey:id' },
		type: { type: 'string', nullable: true },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
		sinceDate: { type: 'integer' },
		untilDate: { type: 'integer' },
	},
	required: ['noteId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.noteReactionsRepository)
		private noteReactionsRepository: NoteReactionsRepository,

		private noteReactionEntityService: NoteReactionEntityService,
		private noteEntityService: NoteEntityService,
		private queryService: QueryService,
		private getterService: GetterService,
		private emojiImageIdentityService: EmojiImageIdentityService, // bsky-fork
	) {
		super(meta, paramDef, async (ps, me) => {
			const note = await this.getterService.getNote(ps.noteId).catch(err => {
				if (err.id === '9725d0ce-ba28-4dde-95a7-2cbb2c15de24') throw new ApiError(meta.errors.noSuchNote);
				throw err;
			});

			if (!await this.noteEntityService.isVisibleForMe(note, me ? me.id : null)) {
				throw new ApiError(meta.errors.noSuchNote);
			}

			const query = this.queryService.makePaginationQuery(this.noteReactionsRepository.createQueryBuilder('reaction'), ps.sinceId, ps.untilId, ps.sinceDate, ps.untilDate)
				.andWhere('reaction.noteId = :noteId', { noteId: note.id })
				.leftJoinAndSelect('reaction.user', 'user')
				.leftJoinAndSelect('reaction.note', 'note');

			if (ps.type) {
				// ローカルリアクションはホスト名が . とされているが
				// DB 上ではそうではないので、必要に応じて変換
				const suffix = '@.:';
				const type = ps.type.endsWith(suffix) ? ps.type.slice(0, ps.type.length - suffix.length) + ':' : ps.type;
				// bsky-fork: 同じ画像の絵文字 (ホスト違い) を 1 つにまとめて表示しているので、
				// まとめた代表のキーで聞かれたら、まとめられた側のリアクションも一緒に返す
				const types = await this.siblingReactionTypes(note, type);
				query.andWhere('reaction.reaction IN (:...types)', { types });
			}

			const reactions = await query.limit(ps.limit).getMany();

			return await this.noteReactionEntityService.packMany(reactions, me);
		});
	}

	// bsky-fork: DB 表記のキー (ローカルは `:name:`) を受け取り、同じ画像としてまとめられるキー一覧を DB 表記で返す。
	// 要求されたキーが代表かどうかに関わらず、同じ画像のキーをすべて集める
	private async siblingReactionTypes(note: { reactions: Record<string, number>; userHost: string | null }, dbType: string): Promise<string[]> {
		const toPacked = (key: string) => key.replace(/^:([-\w]+):$/, ':$1@.:');
		const toDb = (key: string) => key.replace(/^:([-\w]+)@\.:$/, ':$1:');
		const packedReactions: Record<string, number> = {};
		for (const [key, count] of Object.entries(note.reactions)) {
			if (count > 0) packedReactions[toPacked(key)] = count;
		}
		const requested = toPacked(dbType);
		packedReactions[requested] ??= 1; // 元サーバーの取得分で表示されたキーが DB に無くても仲間を引けるように
		const grouped = await this.emojiImageIdentityService.group(packedReactions, { noteUserHost: note.userHost });
		const representative = grouped.keyMap.get(requested) ?? requested;
		const types = new Set([dbType]);
		for (const key of Object.keys(packedReactions)) {
			if (key === representative || grouped.keyMap.get(key) === representative) types.add(toDb(key));
		}
		return [...types];
	}
}
