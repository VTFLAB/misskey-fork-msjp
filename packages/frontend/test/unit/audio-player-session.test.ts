/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

const yt = {
	setYoutubeHandlers: vi.fn(),
	youtubeLoad: vi.fn(),
	youtubePlay: vi.fn(),
	youtubePause: vi.fn(),
	youtubeStop: vi.fn(),
	youtubeSeek: vi.fn(),
	youtubeSetVolume: vi.fn(),
	youtubeSetMuted: vi.fn(),
};
vi.mock('@/utility/audio-player-youtube.js', () => yt);
vi.mock('@/i.js', () => ({ $i: null }));

const file = (id: string) => ({ id, file: { id, name: `${id}.mp3`, url: `https://example.com/${id}.mp3`, comment: null, thumbnailUrl: null }, user: null });
const ytTrack = { kind: 'youtube', id: 'yt:abcdefghijk', youtube: { videoId: 'abcdefghijk', title: 'YT', author: 'ch', thumbnailUrl: null, url: 'https://www.youtube.com/watch?v=abcdefghijk', service: 'youtube' } };

describe('audio player session', () => {
	beforeEach(() => {
		vi.resetModules();
		window.localStorage.clear();
		Object.values(yt).forEach(f => f.mockClear());
	});

	test('restores file track paused at position', async () => {
		window.localStorage.setItem('mkGlobalAudioPlayerQueue:guest', JSON.stringify([file('a'), file('b'), { bogus: true }]));
		window.localStorage.setItem('mkGlobalAudioPlayerPosition:guest', JSON.stringify({ index: 1, currentTime: 42.5, loop: 'all' }));
		const m = await import('@/utility/audio-player.js');
		expect(m.audioPlayerState.queue.length).toBe(2);
		expect(m.audioPlayerState.index).toBe(1);
		expect(m.audioPlayerState.currentTime).toBe(42.5);
		expect(m.audioPlayerState.loop).toBe('all');
		expect(m.audioPlayerState.playing).toBe(false);
		expect(m.audioPlayerState.queue[0].qid).toBeTypeOf('string');
	});

	test('restores youtube track cued at position', async () => {
		window.localStorage.setItem('mkGlobalAudioPlayerQueue:guest', JSON.stringify([file('a'), ytTrack]));
		window.localStorage.setItem('mkGlobalAudioPlayerPosition:guest', JSON.stringify({ index: 1, currentTime: 10, loop: 'off' }));
		const m = await import('@/utility/audio-player.js');
		expect(m.audioPlayerState.index).toBe(1);
		expect(yt.youtubeLoad).toHaveBeenLastCalledWith('abcdefghijk', false, 10);
	});

	test('saves queue and position, clear removes them', async () => {
		vi.useFakeTimers();
		const m = await import('@/utility/audio-player.js');
		m.enqueue([file('x') as never, ytTrack as never]);
		await Promise.resolve();
		vi.advanceTimersByTime(400);
		const q = JSON.parse(window.localStorage.getItem('mkGlobalAudioPlayerQueue:guest')!);
		expect(q.length).toBe(2);
		expect(q[0].qid).toBeUndefined();
		expect(q[1].youtube.videoId).toBe('abcdefghijk');
		const pos = JSON.parse(window.localStorage.getItem('mkGlobalAudioPlayerPosition:guest')!);
		expect(pos.index).toBe(0);
		m.clear();
		expect(window.localStorage.getItem('mkGlobalAudioPlayerQueue:guest')).toBeNull();
		vi.useRealTimers();
	});

	test('youtube track reached while hidden is cued, resumed on visible', async () => {
		const m = await import('@/utility/audio-player.js');
		Object.defineProperty(window.document, 'visibilityState', { configurable: true, get: () => 'hidden' });
		m.playTracks([ytTrack as never], 0);
		expect(yt.youtubeLoad).toHaveBeenLastCalledWith('abcdefghijk', false, 0);
		Object.defineProperty(window.document, 'visibilityState', { configurable: true, get: () => 'visible' });
		window.document.dispatchEvent(new Event('visibilitychange'));
		expect(yt.youtubePlay).toHaveBeenCalled();
	});
});
