/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/vue';
import { defineComponent, h, reactive, ref, toHandlers } from 'vue';
import type { Component, Ref } from 'vue';
import type * as Misskey from 'misskey-js';
import { components } from '@/components/index.js';
import { directives } from '@/directives/index.js';
import { i18n } from '@/i18n.js';
import { Autocomplete } from '@/utility/autocomplete.js';

type PopupImpl = (component: Component, props: Record<string, unknown>, events: Record<string, (...args: unknown[]) => void>) => { dispose: () => void };

const mocks = vi.hoisted(() => ({
	popup: null as PopupImpl | null,
	selectUser: vi.fn(),
}));

// Do not spread importOriginal() here: the real os.ts imports components that
// import utility/autocomplete.ts, which then binds the real popup() instead of this mock.
vi.mock('@/os.js', () => ({
	popup: (...args: Parameters<PopupImpl>) => mocks.popup!(...args),
	selectUser: (...args: unknown[]) => mocks.selectUser(...args),
	claimZIndex: () => 1000,
}));

describe('メンションのサジェストの「ユーザーを選択」', () => {
	let textarea: HTMLTextAreaElement;

	beforeEach(() => {
		// Render the popup for real and unmount it on dispose, as the app does,
		// so events emitted by an already disposed suggestion are dropped.
		mocks.popup = (component, props, events) => {
			const state = reactive(props);
			const { unmount } = render(defineComponent({
				render: () => h(component, { ...state, ...toHandlers(events) }),
			}), { global: { directives, components } });
			return { dispose: unmount };
		};
		textarea = document.createElement('textarea');
		document.body.appendChild(textarea);
	});

	afterEach(() => {
		cleanup();
		textarea.remove();
		mocks.selectUser.mockReset();
	});

	async function chooseUserAfterTyping(input: string, user: Partial<Misskey.entities.UserDetailed>): Promise<{ text: Ref<string | number | null> }> {
		const text = ref<string | number | null>(input);
		new Autocomplete(textarea, text);
		textarea.value = input;
		textarea.setSelectionRange(input.length, input.length);
		textarea.dispatchEvent(new Event('input'));

		mocks.selectUser.mockResolvedValue(user);
		await fireEvent.click(await screen.findByText(i18n.ts.selectUser));
		return { text };
	}

	test('ダイアログで選んだローカルユーザーを挿入する', async () => {
		const { text } = await chooseUserAfterTyping('hello @', { id: 'u1', username: 'alice', host: null });

		await vi.waitFor(() => expect(text.value).toBe('hello @alice '));
		expect(mocks.selectUser).toHaveBeenCalledWith({ includeSelf: true });
		expect(screen.queryByText(i18n.ts.selectUser)).toBeNull();
	});

	test('ダイアログで選んだリモートユーザーをホスト付きで挿入する', async () => {
		const { text } = await chooseUserAfterTyping('@', { id: 'u2', username: 'bob', host: 'example.com' });

		await vi.waitFor(() => expect(text.value).toBe('@bob@example.com '));
	});
});
