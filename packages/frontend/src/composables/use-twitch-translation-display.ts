/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ref, watch } from 'vue';
import { miLocalStorage } from '@/local-storage.js';

// 配信視聴ページのコメント翻訳表示 / 投稿翻訳 (bsky-fork 独自)。
// 実際の翻訳自体はサーバー側 (TwitchTranslationService) が行う。ここで保持するのは
// 「表示するか」「投稿を翻訳して送るか」という端末ごとの好みのみで、TTS 設定
// (use-twitch-tts.ts) と同じく miLocalStorage シングルトン ref パターンを踏襲する。

export type TwitchTranslationDisplaySettings = {
	// 視聴者側: 翻訳済みコメントを原文の下に表示するか
	showTranslation: boolean;
	// 投稿者側: 送信するコメントの翻訳をサーバーに依頼するか (comments/create の translate パラメータ)
	translateMyComment: boolean;
};

const DEFAULT_SETTINGS: TwitchTranslationDisplaySettings = {
	showTranslation: true,
	translateMyComment: false,
};

function load(): TwitchTranslationDisplaySettings {
	try {
		const raw = miLocalStorage.getItem('twitchTranslationDisplay');
		if (raw == null) return { ...DEFAULT_SETTINGS };
		return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

// モジュールシングルトン: チャットコンポーネント内の複数箇所 (表示切替ボタン・
// 投稿フォーム) で同じ状態を共有する
export const twitchTranslationDisplaySettings = ref<TwitchTranslationDisplaySettings>(load());

watch(twitchTranslationDisplaySettings, () => {
	miLocalStorage.setItem('twitchTranslationDisplay', JSON.stringify(twitchTranslationDisplaySettings.value));
}, { deep: true });
