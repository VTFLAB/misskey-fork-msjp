/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, test, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
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
	// 描画直後の非同期の更新 (ResizeObserver など) が終わってから操作する
	await new Promise(resolve => window.setTimeout(resolve, 0));
	return { result };
}

describe('audio player dock on mobile width', () => {
	// happy-dom の history.back() は非同期に完了し、後のテストで popstate が届いてしまうので、同期的に戻して popstate を送る
	let back: MockInstance<() => void>;

	beforeEach(() => {
		window.localStorage.clear();
		back = vi.spyOn(window.history, 'back').mockImplementation(() => {
			window.history.replaceState(null, '', '#');
			window.dispatchEvent(new PopStateEvent('popstate'));
		});
	});

	afterEach(() => {
		cleanup();
		// 別のテストで描画した要素がクエリに引っかからないよう、残ったものも取り除く
		document.body.innerHTML = '';
		back.mockRestore();
		window.history.replaceState(null, '', '#');
		player.clear();
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

	test('the back button collapses the expanded view', async () => {
		const { result } = await renderDock(400);
		await fireEvent.click(result.getAllByLabelText('プレイヤーを開く')[0]);
		await nextTick();
		expect(window.location.hash).toBe('#audio-player');

		// 戻る操作で履歴が 1 つ前に戻った状態を再現する
		window.history.replaceState(null, '', '#');
		window.dispatchEvent(new PopStateEvent('popstate'));
		await nextTick();
		expect(result.queryByLabelText('プレイヤーをしまう')).toBeNull();
	});

	test('collapsing with the button pops the pushed history entry', async () => {
		const { result } = await renderDock(400);
		await fireEvent.click(result.getAllByLabelText('プレイヤーを開く')[0]);
		await nextTick();
		await fireEvent.click(result.getByLabelText('プレイヤーをしまう'));
		await nextTick();
		expect(back).toHaveBeenCalledTimes(1);
	});

	test('dragging the collapsed button saves its position and does not trigger a click', async () => {
		const { result } = await renderDock(400);
		const root = result.getByRole('region');
		const playing = player.audioPlayerState.playing;
		const playButton = result.getByLabelText(playing ? '一時停止' : '再生');
		await fireEvent.pointerDown(playButton, { pointerId: 1, isPrimary: true, button: 0, clientX: 300, clientY: 600 });
		window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 100, clientY: 200 }));
		await nextTick();
		expect(root.style.transform).toContain('translate(');
		window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 100, clientY: 200 }));
		await fireEvent.click(playButton);
		await nextTick();
		expect(player.audioPlayerState.playing).toBe(playing);
		const saved = JSON.parse(window.localStorage.getItem('mkGlobalAudioPlayerDockPosition')!);
		expect(saved.side === 'left' || saved.side === 'right').toBe(true);
		expect(typeof saved.bottom).toBe('number');
		expect(root.style.transform).toBe('');
	});

	test('keeps the existing mini player on desktop width', async () => {
		const { result } = await renderDock(1280);
		expect(result.queryByLabelText('プレイヤーを開く')).toBeNull();
		expect(result.queryByLabelText('プレイヤーをしまう')).toBeNull();
		expect(result.getAllByLabelText('キュー・プレイリスト').length).toBeGreaterThan(0);
	});
});
