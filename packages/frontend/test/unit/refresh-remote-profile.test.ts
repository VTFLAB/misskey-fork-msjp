/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { cleanup, render } from '@testing-library/vue';
import type { IPaginator } from '@/utility/paginator.js';
import { refreshRemoteProfile } from '@/utility/refresh-remote-profile.js';

vi.mock('@/i.js', () => ({ $i: { id: 'viewer' } }));

function mount(host: string | null) {
	const paginator = {
		items: ref<unknown[]>([]),
		fetching: ref(false),
		reload: vi.fn().mockResolvedValue(undefined),
	};
	const component = render(defineComponent({
		setup() {
			refreshRemoteProfile(host, paginator as unknown as IPaginator);
			return () => h('div');
		},
	}));
	return { paginator, ...component };
}

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe('refreshRemoteProfile', () => {
	test('retries an empty remote profile and stops after posts arrive', async () => {
		vi.useFakeTimers();
		const { paginator } = mount('remote.example');
		await vi.advanceTimersByTimeAsync(5000);
		expect(paginator.reload).toHaveBeenCalledTimes(1);
		paginator.items.value = [{ id: 'imported' }];
		await vi.advanceTimersByTimeAsync(60_000);
		expect(paginator.reload).toHaveBeenCalledTimes(1);
	});

	test('does not reload local profiles and stops when unmounted', async () => {
		vi.useFakeTimers();
		const local = mount(null);
		const remote = mount('remote.example');
		remote.unmount();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(local.paginator.reload).not.toHaveBeenCalled();
		expect(remote.paginator.reload).not.toHaveBeenCalled();
	});

	test('avoids concurrent requests and limits retries for an unavailable remote', async () => {
		vi.useFakeTimers();
		const { paginator } = mount('remote.example');
		paginator.fetching.value = true;
		await vi.advanceTimersByTimeAsync(5000);
		expect(paginator.reload).not.toHaveBeenCalled();
		paginator.fetching.value = false;
		await vi.advanceTimersByTimeAsync(120_000);
		expect(paginator.reload).toHaveBeenCalledTimes(11);
	});
});
