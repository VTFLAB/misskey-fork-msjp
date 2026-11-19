/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const player = vi.hoisted(() => ({
	play: vi.fn(),
	pause: vi.fn(),
	toggle: vi.fn(),
	next: vi.fn(),
	prev: vi.fn(),
	playTracks: vi.fn(),
	showDock: vi.fn(),
	isUnplayableTrack: vi.fn((track: { id: string }) => track.id === 'gone'),
	hasQueue: { value: true },
}));
vi.mock('@/utility/audio-player.js', () => player);
vi.mock('@/utility/audio-playlists.js', () => ({
	getPlaylist: vi.fn(async (id: string) => id === 'p1'
		? { id: 'p1', name: '作業用', updatedAt: 0, tracks: [{ id: 't1' }, { id: 'gone' }, { id: 't2' }] }
		: null),
}));

// Web Locks shared by the tabs (module instances) of one browser: one holder, a queue, and steal.
class FakeLocks {
	private holder: ((e: unknown) => void) | null = null;
	private queue: (() => void)[] = [];

	request(_name: string, opts: { steal?: boolean }, cb: () => Promise<void>): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const grant = () => {
				this.holder = reject;
				cb().then(resolve, reject);
			};
			if (opts.steal && this.holder != null) {
				const old = this.holder;
				this.holder = null;
				old(new DOMException('stolen', 'AbortError'));
			}
			if (this.holder == null) queueMicrotask(grant);
			else this.queue.push(grant);
		});
	}
}

async function openTab() {
	vi.resetModules();
	return await import('@/utility/audio-player-remote.js');
}

describe('audio-player-remote', () => {
	beforeEach(() => {
		Object.defineProperty(window.navigator, 'locks', { value: new FakeLocks(), configurable: true });
		window.localStorage.clear();
		vi.clearAllMocks();
		player.hasQueue.value = true;
	});

	afterEach(() => {
		window.localStorage.clear();
	});

	test('既定ではオフで、指示を無視する', async () => {
		const tab = await openTab();
		expect(tab.isAudioPlayerRemoteControlEnabled()).toBe(false);
		await tab.handleAudioPlayerCommand({ action: 'play', playlistId: null, shuffle: false });
		expect(player.play).not.toHaveBeenCalled();
	});

	test('オンなら play を実行し、キューが空なら保存したキューを開き直す', async () => {
		const tab = await openTab();
		tab.setAudioPlayerRemoteControlEnabled(true);
		player.hasQueue.value = false;
		await tab.handleAudioPlayerCommand({ action: 'play', playlistId: null, shuffle: false });
		expect(player.showDock).toHaveBeenCalledTimes(1);
		expect(player.play).toHaveBeenCalledTimes(1);
	});

	test('playPlaylist は再生できない曲を除いて先頭から再生する', async () => {
		const tab = await openTab();
		tab.setAudioPlayerRemoteControlEnabled(true);
		await tab.handleAudioPlayerCommand({ action: 'playPlaylist', playlistId: 'p1', shuffle: false });
		expect(player.playTracks).toHaveBeenCalledWith([{ id: 't1' }, { id: 't2' }], 0);
		expect(player.showDock).toHaveBeenCalled();
	});

	test('同じブラウザの 2 つのタブでは 1 つだけが受け、再生を始めたタブが受け持ちを奪う', async () => {
		window.localStorage.setItem('audioPlayerRemoteControl', 'true');
		const tabA = await openTab();
		const tabB = await openTab();

		await tabA.handleAudioPlayerCommand({ action: 'next', playlistId: null, shuffle: false });
		await tabB.handleAudioPlayerCommand({ action: 'next', playlistId: null, shuffle: false });
		expect(player.next).toHaveBeenCalledTimes(1);

		tabB.claimAudioPlayerRemoteControl();
		await new Promise(resolve => setTimeout(resolve, 0));
		vi.clearAllMocks();

		await tabA.handleAudioPlayerCommand({ action: 'pause', playlistId: null, shuffle: false });
		await tabB.handleAudioPlayerCommand({ action: 'pause', playlistId: null, shuffle: false });
		expect(player.pause).toHaveBeenCalledTimes(1);
	});
});
