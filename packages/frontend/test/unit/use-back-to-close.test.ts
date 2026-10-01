/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, test, expect, vi, afterEach } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { render, cleanup } from '@testing-library/vue';
import { useBackToClose } from '@/composables/use-back-to-close.js';

function mountWith(onBack: (isOpen: { value: boolean }) => unknown) {
	const isOpen = ref(true);
	render(defineComponent({
		setup() {
			useBackToClose({ hash: '#test-modal', isOpen: () => isOpen.value, onBack: () => onBack(isOpen) });
			return () => h('div');
		},
	}));
	return isOpen;
}

function goBack() {
	window.history.replaceState(null, '', '#');
	window.dispatchEvent(new PopStateEvent('popstate'));
}

describe('useBackToClose', () => {
	afterEach(() => {
		cleanup();
		window.history.replaceState(null, '', '#');
	});

	test('pushes a history entry while open and calls onBack on back', async () => {
		const onBack = vi.fn((isOpen: { value: boolean }) => {
			isOpen.value = false;
		});
		mountWith(onBack);
		expect(window.location.hash).toBe('#test-modal');
		goBack();
		await nextTick();
		expect(onBack).toHaveBeenCalledTimes(1);
	});

	test('re-pushes the entry when closing is cancelled', async () => {
		const onBack = vi.fn(async () => {});
		mountWith(onBack);
		goBack();
		await nextTick();
		await Promise.resolve();
		expect(onBack).toHaveBeenCalledTimes(1);
		expect(window.location.hash).toBe('#test-modal');
	});

	test('closing by other means pops the entry', async () => {
		const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
		try {
			const isOpen = mountWith(() => {});
			isOpen.value = false;
			await nextTick();
			expect(back).toHaveBeenCalledTimes(1);
		} finally {
			back.mockRestore();
		}
	});
});
