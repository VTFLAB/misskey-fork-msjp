/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, assert, describe, test } from 'vitest';
import { cleanup, render } from '@testing-library/vue';
import * as Misskey from 'misskey-js';
import { components } from '@/components/index.js';
import { directives } from '@/directives/index.js';
import MkNote from '@/components/MkNote.vue';
import MkNoteDetailed from '@/components/MkNoteDetailed.vue';
import { PREF_DEF } from '@/preferences/def.js';

function createUser(overrides: Partial<Misskey.entities.UserLite> = {}): Misskey.entities.UserLite {
	return {
		id: 'user-default',
		name: 'Default User',
		username: 'defaultuser',
		host: null,
		avatarUrl: 'https://example.com/avatar.png',
		avatarBlurhash: null,
		isBot: false,
		isCat: false,
		avatarDecorations: [],
		emojis: {},
		onlineStatus: 'online',
		badgeRoles: [],
		...overrides,
	};
}

function createNote(overrides: Partial<Misskey.entities.Note> = {}): Misskey.entities.Note {
	const user = overrides.user ?? createUser({ id: overrides.userId ?? 'user-default' });
	return {
		id: 'note-default',
		createdAt: '2026-11-26T00:00:00.000Z',
		userId: user.id,
		user,
		text: null,
		cw: null,
		visibility: 'public',
		localOnly: false,
		isAIGenerated: false,
		reactionAcceptance: null,
		reactionCount: 0,
		renoteCount: 0,
		repliesCount: 0,
		reactions: {},
		reactionEmojis: {},
		fileIds: [],
		files: [],
		replyId: null,
		renoteId: null,
		...overrides,
	};
}

describe('Renote display', () => {
	afterEach(() => {
		cleanup();
	});

	test('PREF_DEF.collapseRenotes.default is false', () => {
		assert.strictEqual(PREF_DEF.collapseRenotes.default, false);
	});

	test('MkNote renders pure renote banner without renoter avatar and highlights the target note in article', () => {
		const renoter = createUser({
			id: 'renoter-1',
			name: 'Renoter Alice',
			username: 'alice',
		});
		const originalAuthor = createUser({
			id: 'author-1',
			name: 'Original Bob',
			username: 'bob',
		});
		const targetNote = createNote({
			id: 'target-1',
			userId: originalAuthor.id,
			user: originalAuthor,
			text: 'Original post content',
		});
		const pureRenote = createNote({
			id: 'renote-1',
			userId: renoter.id,
			user: renoter,
			renoteId: targetNote.id,
			renote: targetNote,
		});

		const { container } = render(MkNote, {
			props: {
				note: pureRenote,
				mock: true,
			},
			global: { directives, components },
		});

		const repeatIcon = container.querySelector('.ti-repeat');
		assert.exists(repeatIcon, 'repeat icon is rendered');

		const renoteBanner = repeatIcon?.closest('div');
		assert.exists(renoteBanner, 'renote banner container exists');
		assert.include(renoteBanner?.textContent ?? '', 'Renoter Alice');
		assert.isNull(renoteBanner?.querySelector('img'), 'renoter avatar img is not rendered in renote banner');

		const article = container.querySelector('article');
		assert.exists(article, 'article element for target note exists');
		assert.include(article?.textContent ?? '', 'Original Bob');
		assert.include(article?.textContent ?? '', 'Original post content');

		const relation = renoteBanner!.compareDocumentPosition(article!);
		assert.isTrue((relation & Node.DOCUMENT_POSITION_FOLLOWING) !== 0, 'renote banner precedes article');
	});

	test('MkNote places renote banner before reply context when a reply note is renoted', () => {
		const renoter = createUser({
			id: 'renoter-2',
			name: 'Renoter Carol',
			username: 'carol',
		});
		const replyParentAuthor = createUser({
			id: 'parent-author',
			name: 'Parent Dave',
			username: 'dave',
		});
		const replyTargetAuthor = createUser({
			id: 'reply-author',
			name: 'Reply Eve',
			username: 'eve',
		});
		const parentNote = createNote({
			id: 'parent-1',
			userId: replyParentAuthor.id,
			user: replyParentAuthor,
			text: 'Parent note body',
		});
		const replyNote = createNote({
			id: 'reply-1',
			userId: replyTargetAuthor.id,
			user: replyTargetAuthor,
			replyId: parentNote.id,
			reply: parentNote,
			text: 'Reply note body',
		});
		const pureRenoteOfReply = createNote({
			id: 'renote-2',
			userId: renoter.id,
			user: renoter,
			renoteId: replyNote.id,
			renote: replyNote,
		});

		const { container } = render(MkNote, {
			props: {
				note: pureRenoteOfReply,
				mock: true,
			},
			global: { directives, components },
		});

		const repeatIcon = container.querySelector('.ti-repeat');
		const renoteBanner = repeatIcon?.closest('div');
		const article = container.querySelector('article');
		assert.exists(renoteBanner);
		assert.exists(article);

		const rootChildren = Array.from(container.firstElementChild?.children ?? []);
		const renoteIdx = rootChildren.indexOf(renoteBanner!);
		const articleIdx = rootChildren.indexOf(article!);
		const parentIdx = rootChildren.findIndex((el) => el.textContent?.includes('Parent note body'));

		assert.isAtLeast(renoteIdx, 0, 'renote banner is a direct child of root');
		assert.isAbove(parentIdx, renoteIdx, 'reply parent follows renote banner');
		assert.isAbove(articleIdx, parentIdx, 'article follows reply parent');
	});

	test('MkNoteDetailed renders pure renote banner without renoter avatar and highlights the target note in article', () => {
		const renoter = createUser({
			id: 'renoter-3',
			name: 'Detailed Renoter Frank',
			username: 'frank',
		});
		const originalAuthor = createUser({
			id: 'author-3',
			name: 'Detailed Original Grace',
			username: 'grace',
		});
		const targetNote = createNote({
			id: 'target-3',
			userId: originalAuthor.id,
			user: originalAuthor,
			text: 'Detailed target note content',
		});
		const pureRenote = createNote({
			id: 'renote-3',
			userId: renoter.id,
			user: renoter,
			renoteId: targetNote.id,
			renote: targetNote,
		});

		const { container } = render(MkNoteDetailed, {
			props: {
				note: pureRenote,
			},
			global: { directives, components },
		});

		const repeatIcon = container.querySelector('.ti-repeat');
		assert.exists(repeatIcon, 'repeat icon is rendered in MkNoteDetailed');

		const renoteBanner = repeatIcon?.closest('div');
		assert.exists(renoteBanner, 'renote banner container exists in MkNoteDetailed');
		assert.include(renoteBanner?.textContent ?? '', 'Detailed Renoter Frank');
		assert.isNull(renoteBanner?.querySelector('img'), 'renoter avatar img is not rendered in MkNoteDetailed renote banner');

		const article = container.querySelector('article');
		assert.exists(article, 'article element exists in MkNoteDetailed');
		assert.include(article?.textContent ?? '', 'Detailed Original Grace');
		assert.include(article?.textContent ?? '', 'Detailed target note content');
	});
});
