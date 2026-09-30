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
vi.mock('@/i.js', () => ({ $i: { id: 'me' } }));
const api = vi.fn();
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: (...args: unknown[]) => api(...args) }));

const ytTrack = (videoId: string, extra: Record<string, unknown> = {}) => ({
	kind: 'youtube', id: `yt:${videoId}`,
	youtube: { videoId, title: `t-${videoId}`, author: 'ch', thumbnailUrl: null, url: 'u', service: 'youtube', ...extra },
});

describe('youtube metadata refresh', () => {
	beforeEach(() => {
		vi.resetModules();
		window.localStorage.clear();
		api.mockReset();
		Object.values(yt).forEach(f => f.mockClear());
	});

	test('only stale tracks are looked up; removed/private are marked but kept', async () => {
		const m = await import('@/utility/youtube-metadata.js');
		const now = Date.now();
		api.mockResolvedValue({
			videos: [
				{ videoId: 'aaaaaaaaaaa', status: 'available', title: 'New A', author: 'A', thumbnailUrl: 'th' },
				{ videoId: 'bbbbbbbbbbb', status: 'removed', title: null, author: null, thumbnailUrl: null },
				{ videoId: 'ccccccccccc', status: 'error', title: null, author: null, thumbnailUrl: null },
			],
			playlistTitle: null,
		});
		const tracks = [
			ytTrack('aaaaaaaaaaa'),
			ytTrack('bbbbbbbbbbb', { fetchedAt: now - 1000 * 60 * 60 * 24 * 40 }),
			ytTrack('ccccccccccc'),
			ytTrack('ddddddddddd', { fetchedAt: now }),
		];
		const updated = await m.refreshStaleYoutubeTracks(tracks as never);
		expect(api).toHaveBeenCalledTimes(1);
		expect(api.mock.calls[0][1].videoIds).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']);
		const u = updated as any[];
		expect(u.length).toBe(4);
		expect(u[0].youtube.title).toBe('New A');
		expect(u[0].youtube.fetchedAt).toBeGreaterThanOrEqual(now);
		expect(u[1].youtube.unavailable).toBe('removed');
		expect(u[1].youtube.title).toBe('t-bbbbbbbbbbb');
		expect(u[2]).toBe(tracks[2]); // error: unchanged, retried later
		expect(u[3]).toBe(tracks[3]); // fresh: untouched
	});

	test('lookups are split into batches of 50', async () => {
		vi.useFakeTimers();
		const m = await import('@/utility/youtube-metadata.js');
		api.mockImplementation((_ep: string, p: { videoIds: string[] }) => Promise.resolve({
			videos: p.videoIds.map(videoId => ({ videoId, status: 'available', title: 'x', author: null, thumbnailUrl: null })),
			playlistTitle: null,
		}));
		const ids = Array.from({ length: 120 }, (_, i) => `v${String(i).padStart(10, '0')}`);
		const promise = m.lookupYoutubeVideos(ids);
		await vi.runAllTimersAsync();
		const res = await promise;
		expect(api).toHaveBeenCalledTimes(3);
		expect(res.videos.size).toBe(120);
		vi.useRealTimers();
	});
});

describe('unplayable tracks are skipped', () => {
	beforeEach(() => {
		vi.resetModules();
		window.localStorage.clear();
		Object.values(yt).forEach(f => f.mockClear());
	});

	test('playTracks skips an unavailable first track, and player errors mark tracks', async () => {
		const m = await import('@/utility/audio-player.js');
		m.playTracks([ytTrack('aaaaaaaaaaa', { unavailable: 'removed' }), ytTrack('bbbbbbbbbbb'), ytTrack('ccccccccccc')] as never, 0);
		expect(m.audioPlayerState.index).toBe(1);
		expect(yt.youtubeLoad).toHaveBeenLastCalledWith('bbbbbbbbbbb', true, 0);
		expect(m.audioPlayerState.queue.length).toBe(3);

		const handlers = yt.setYoutubeHandlers.mock.calls[0][0];
		handlers.onError(150);
		const q = m.audioPlayerState.queue as any[];
		expect(q[1].youtube.unavailable).toBe('notEmbeddable');
		expect(m.audioPlayerState.index).toBe(2);
		expect(yt.youtubeLoad).toHaveBeenLastCalledWith('ccccccccccc', true, 0);

		// all remaining unplayable → stop on the track without loading it
		handlers.onError(100);
		expect(q[2].youtube.unavailable).toBe('unavailable');
		expect(m.audioPlayerState.playing).toBe(false);
		expect(m.isUnplayableTrack(q[0])).toBe(true);
	});

	test('prev skips backwards over unplayable tracks', async () => {
		const m = await import('@/utility/audio-player.js');
		m.playTracks([ytTrack('aaaaaaaaaaa'), ytTrack('bbbbbbbbbbb', { unavailable: 'private' }), ytTrack('ccccccccccc')] as never, 2);
		m.prev();
		expect(m.audioPlayerState.index).toBe(0);
	});
});

describe('playlist id parsing', () => {
	test('extractYoutubePlaylistId', async () => {
		const { extractYoutubePlaylistId } = await import('@/utility/youtube-iframe-api.js');
		expect(extractYoutubePlaylistId('https://www.youtube.com/playlist?list=PLabc123')).toEqual({ id: 'PLabc123', isMusic: false });
		expect(extractYoutubePlaylistId('https://music.youtube.com/playlist?list=VLPLabc123')).toEqual({ id: 'PLabc123', isMusic: true });
		expect(extractYoutubePlaylistId('https://www.youtube.com/watch?v=abcdefghijk&list=RDabcdefghijk')).toEqual({ error: 'mix' });
		expect(extractYoutubePlaylistId('https://example.com/?list=PLabc')).toBeNull();
		expect(extractYoutubePlaylistId('PLabc123')).toEqual({ id: 'PLabc123', isMusic: false });
	});
});
