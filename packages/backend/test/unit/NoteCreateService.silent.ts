/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { NoteCreateService } from '@/core/NoteCreateService.js';
import type { MiNote } from '@/models/Note.js';

describe('silent historical note import', () => {
	test('indexes the post without notifying subscribers', async () => {
		const service = Object.create(NoteCreateService.prototype) as NoteCreateService;
		const createNotification = vi.fn();
		const index = vi.fn();
		Object.assign(service, {
			notesChart: { update: vi.fn() },
			meta: { enableChartsForRemoteUser: false, enableStatsForFederatedInstances: false },
			antennaService: { addNoteToAntennas: vi.fn().mockResolvedValue([]) },
			followingsRepository: { findBy: vi.fn().mockResolvedValue([{ followerId: 'subscriber' }]) },
			notificationService: { createNotification },
		});
		Object.defineProperties(service, {
			incNotesCountOfUser: { value: vi.fn() },
			pushToTl: { value: vi.fn() },
			index: { value: index },
		});
		const note = { id: 'historical', visibility: 'public' } as MiNote;
		const author = { id: 'author', username: 'author', host: 'remote.example', isBot: false };
		await service['postNoteCreated'](note, author, {}, true, [], []);
		expect(createNotification).not.toHaveBeenCalled();
		expect(index).toHaveBeenCalledWith(note);
	});
});
