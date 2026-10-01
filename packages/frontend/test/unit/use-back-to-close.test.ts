/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, test, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { render, cleanup } from '@testing-library/vue';
import { useBackToClose } from '@/composables/use-back-to-close.js';

function mountWith(hash: `#${string}`, onBack: (isOpen: { value: boolean }) => unknown) {
	const isOpen = ref(true);
	render(defineComponent({
		setup() {
			useBackToClose({ hash, isOpen: () => isOpen.value, onBack: () => onBack(isOpen) });
			return () => h('div');
		},
	}));
	return isOpen;
}

const closeOnBack = (isOpen: { value: boolean }) => {
	isOpen.value = false;
};

// ブラウザの戻る操作: 1 つ前の履歴 (積む前に記録した hash) に戻り、popstate が届く
const hashes: string[] = [];
function userBack() {
	hashes.pop();
	window.history.replaceState(null, '', hashes.at(-1) ?? '#');
	window.dispatchEvent(new PopStateEvent('popstate'));
}

async function settle() {
	await nextTick();
	await Promise.resolve();
	await nextTick();
}

describe('useBackToClose', () => {
	let pushState: MockInstance<typeof window.history.pushState>;
	let back: MockInstance<() => void>;

	beforeEach(() => {
		hashes.length = 0;
		const original = window.history.pushState.bind(window.history);
		pushState = vi.spyOn(window.history, 'pushState').mockImplementation((data, unused, url) => {
			hashes.push(String(url));
			original(data, unused, url);
		});
		back = vi.spyOn(window.history, 'back').mockImplementation(() => userBack());
	});

	afterEach(() => {
		cleanup();
		pushState.mockRestore();
		back.mockRestore();
		window.history.replaceState(null, '', '#');
	});

	test('pushes a history entry while open and calls onBack on back', async () => {
		const onBack = vi.fn(closeOnBack);
		mountWith('#test-modal', onBack);
		expect(window.location.hash).toBe('#test-modal');
		userBack();
		await settle();
		expect(onBack).toHaveBeenCalledTimes(1);
		expect(back).not.toHaveBeenCalled();
	});

	test('re-pushes the entry when closing is cancelled', async () => {
		const onBack = vi.fn(async () => {});
		mountWith('#test-modal', onBack);
		userBack();
		await settle();
		expect(onBack).toHaveBeenCalledTimes(1);
		expect(window.location.hash).toBe('#test-modal');
	});

	test('closing by other means pops the entry', async () => {
		const isOpen = mountWith('#test-modal', () => {});
		isOpen.value = false;
		await settle();
		expect(back).toHaveBeenCalledTimes(1);
		expect(window.location.hash).toBe('');
	});

	test('back closes only the topmost of stacked entries', async () => {
		const onBackForm = vi.fn(closeOnBack);
		const onBackPicker = vi.fn(closeOnBack);
		const form = mountWith('#post-form', onBackForm);
		const picker = mountWith('#emoji-picker', onBackPicker);

		userBack();
		await settle();
		expect(onBackPicker).toHaveBeenCalledTimes(1);
		expect(onBackForm).not.toHaveBeenCalled();
		expect(picker.value).toBe(false);
		expect(form.value).toBe(true);
		expect(window.location.hash).toBe('#post-form');

		userBack();
		await settle();
		expect(onBackForm).toHaveBeenCalledTimes(1);
	});

	test('closing the top entry by other means does not close the one below', async () => {
		const onBackForm = vi.fn(closeOnBack);
		const form = mountWith('#post-form', onBackForm);
		const picker = mountWith('#emoji-picker', () => {});
		picker.value = false;
		await settle();
		expect(back).toHaveBeenCalledTimes(1);
		expect(onBackForm).not.toHaveBeenCalled();
		expect(form.value).toBe(true);
		expect(window.location.hash).toBe('#post-form');
	});
});
