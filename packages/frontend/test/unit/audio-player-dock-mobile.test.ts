/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/vue';
import { nextTick } from 'vue';
import { components } from '@/components/index.js';
import { directives } from '@/directives/index.js';
import * as player from '@/utility/audio-player.js';
import Dock from '@/ui/_common_/audio-player-dock.vue';

const { attachYoutubeHost, detachYoutubeHost } = vi.hoisted(() => ({
	attachYoutubeHost: vi.fn(),
	detachYoutubeHost: vi.fn(),
}));
vi.mock('@/utility/audio-player-youtube.js', () => ({
	attachYoutubeHost,
	detachYoutubeHost,
	setYoutubeHandlers: vi.fn(),
	youtubeLoad: vi.fn(),
	youtubePlay: vi.fn(),
	youtubePause: vi.fn(),
	youtubeStop: vi.fn(),
	youtubeSeek: vi.fn(),
	youtubeSetVolume: vi.fn(),
	youtubeSetMuted: vi.fn(),
}));
vi.mock('@/i.js', async (importOriginal) => ({ ...await importOriginal<typeof import('@/i.js')>(), $i: null }));
vi.mock('@/utility/audio-playlists.js', async (importOriginal) => ({
	...await importOriginal<typeof import('@/utility/audio-playlists.js')>(),
	schedulePlaylistMaintenance: vi.fn(),
}));

const ytTrack = { kind: 'youtube', id: 'yt:abcdefghijk', youtube: { videoId: 'abcdefghijk', title: 'YT', author: 'ch', thumbnailUrl: null, url: 'https://www.youtube.com/watch?v=abcdefghijk', service: 'youtube' } };

async function renderDock(width: number) {
	window.innerWidth = width;
	player.playTracks([ytTrack as never], 0);
	const result = render(Dock, { global: { directives, components } });
	await nextTick();
	return { result };
}

describe('audio player dock on mobile width', () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	afterEach(() => {
		cleanup();
		player.closeDock();
		attachYoutubeHost.mockClear();
		detachYoutubeHost.mockClear();
	});

	test('starts collapsed and toggles to the expanded view with the queue docked', async () => {
		const { result } = await renderDock(400);

		expect(result.queryByRole('tablist')).toBeNull();
		expect(result.queryByLabelText('プレイヤーをしまう')).toBeNull();

		await fireEvent.click(result.getAllByLabelText('プレイヤーを開く')[0]);
		expect(result.getByLabelText('プレイヤーをしまう')).toBeTruthy();
		expect(result.getByText('1曲')).toBeTruthy();

		await fireEvent.click(result.getByLabelText('プレイヤーをしまう'));
		expect(result.queryByLabelText('プレイヤーをしまう')).toBeNull();
		expect(result.getAllByLabelText('プレイヤーを開く').length).toBeGreaterThan(0);
	});

	test('keeps the same YouTube host element across mode switches', async () => {
		const { result } = await renderDock(400);
		expect(attachYoutubeHost).toHaveBeenCalledTimes(1);

		await fireEvent.click(result.getAllByLabelText('プレイヤーを開く')[0]);
		await fireEvent.click(result.getByLabelText('プレイヤーをしまう'));

		expect(attachYoutubeHost).toHaveBeenCalledTimes(1);
		expect(detachYoutubeHost).not.toHaveBeenCalled();
	});

	test('expands when opened from the navigation', async () => {
		const { result } = await renderDock(400);
		player.showDock();
		await nextTick();
		expect(result.getByLabelText('プレイヤーをしまう')).toBeTruthy();
	});

	test('keeps the existing mini player on desktop width', async () => {
		const { result } = await renderDock(1280);
		expect(result.queryByLabelText('プレイヤーを開く')).toBeNull();
		expect(result.queryByLabelText('プレイヤーをしまう')).toBeNull();
		expect(result.getAllByLabelText('キュー・プレイリスト').length).toBeGreaterThan(0);
	});
});
