/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onBeforeUnmount, watch } from 'vue';
import { mainRouter } from '@/router.js';

/**
 * Android の戻るボタン (ブラウザの戻る) で画面上の要素を閉じられるようにする (bsky-fork 独自、MkLightbox と同じ方式)。
 *
 * 開いている間だけ URL の末尾に hash を付けた履歴を 1 つ積み、戻る操作でその履歴が消えたら onBack を呼ぶ。
 * 戻る操作以外 (閉じるボタン・Esc など) で閉じたときは、積んだ履歴を取り除く。
 * hash だけの変化ではページは作り直されない (RouterView は同じルート・同じ props なら何もしない)。
 */
export function useBackToClose(opts: {
	hash: `#${string}`;
	isOpen: () => boolean;
	onBack: () => unknown;
}): void {
	let pushed = false;

	function push(): void {
		if (pushed) return;
		window.history.pushState(null, '', opts.hash);
		pushed = true;
	}

	function pop(): void {
		if (!pushed) return;
		pushed = false;
		// ページ遷移などで既に別の履歴に移っているときは戻さない
		if (window.location.hash === opts.hash) window.history.back();
	}

	async function onPopState(): Promise<void> {
		if (!pushed || window.location.hash === opts.hash) return;
		pushed = false;
		await opts.onBack();
		// 閉じるのを取りやめた (下書き破棄の確認でキャンセルした等) ときは、次の戻る操作に備えて積み直す
		if (opts.isOpen()) push();
	}

	// ページを移動したら積んだ履歴は移動前の側に残るので、以後は取り除かない
	mainRouter.useListener('push', () => {
		pushed = false;
	});

	window.addEventListener('popstate', onPopState);

	watch(opts.isOpen, (isOpen) => {
		if (isOpen) {
			push();
		} else {
			pop();
		}
	}, { immediate: true });

	onBeforeUnmount(() => {
		window.removeEventListener('popstate', onPopState);
		pop();
	});
}
