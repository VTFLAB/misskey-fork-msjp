/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as os from '@/os.js';

// プレイヤーウィンドウは同時に 1 つだけ開く (ミニプレイヤー・ナビゲーションのどちらから開いても共通)
let windowOpen = false;

export async function openAudioPlayerWindow(): Promise<void> {
	if (windowOpen) return;
	windowOpen = true;
	try {
		const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkAudioPlayerWindow.vue').then(x => x.default), {}, {
			closed: () => {
				dispose();
				windowOpen = false;
			},
		});
	} catch (err) {
		// e.g. the dynamic import failed; do not leave the opener latched.
		windowOpen = false;
		throw err;
	}
}
