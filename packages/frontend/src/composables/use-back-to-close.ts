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
 *
 * 投稿フォームの上に絵文字ピッカーを開いた場合のように複数が重なったときは、戻る 1 回で一番手前のものだけを閉じる。
 */

type Entry = {
	hash: string;
	pushed: boolean;
	mounted: boolean;
	isOpen: () => boolean;
	onBack: () => unknown;
};

// 履歴を積んでいるもの (開いた順)
const stack: Entry[] = [];
// こちらから history.back() を呼んで、まだ popstate が届いていない数
let pendingBacks = 0;

function pushEntry(entry: Entry): void {
	if (entry.pushed) return;
	window.history.pushState(null, '', entry.hash);
	entry.pushed = true;
	stack.push(entry);
}

function popEntry(entry: Entry): void {
	if (!entry.pushed) return;
	entry.pushed = false;
	const i = stack.indexOf(entry);
	if (i === -1) return;
	stack.splice(i, 1);
	// 手前に別のものが積まれているときに戻すと、そちらの履歴を消してしまうので戻さない
	if (i !== stack.length) return;
	pendingBacks++;
	window.history.back();
}

async function onPopState(): Promise<void> {
	if (pendingBacks > 0) {
		pendingBacks--;
		return;
	}
	const top = stack.at(-1);
	// MkLightbox など他の仕組みの履歴が戻っただけのときは、URL は一番手前のものの hash に戻っている
	if (top == null || window.location.hash === top.hash) return;
	top.pushed = false;
	stack.pop();
	await top.onBack();
	// 閉じるのを取りやめた (アップロード中の確認でキャンセルした等) ときは、次の戻る操作に備えて積み直す
	if (top.mounted && top.isOpen()) pushEntry(top);
}

// router.ts とは import が循環する (ページ → 部品 → この composable) ので、リスナーは初回の使用時に登録する
let listening = false;

function listen(): void {
	if (listening) return;
	listening = true;

	window.addEventListener('popstate', () => {
		onPopState().catch(() => {});
	});

	// ページを移動したら積んだ履歴は移動前の側に残るので、以後は取り除かない
	mainRouter.addListener('push', () => {
		for (const entry of stack) entry.pushed = false;
		stack.length = 0;
	});
}

export function useBackToClose(opts: {
	hash: `#${string}`;
	isOpen: () => boolean;
	onBack: () => unknown;
}): void {
	listen();

	const entry: Entry = {
		hash: opts.hash,
		pushed: false,
		mounted: true,
		isOpen: opts.isOpen,
		onBack: opts.onBack,
	};

	watch(opts.isOpen, (isOpen) => {
		if (isOpen) {
			pushEntry(entry);
		} else {
			popEntry(entry);
		}
	}, { immediate: true });

	onBeforeUnmount(() => {
		entry.mounted = false;
		popEntry(entry);
	});
}
