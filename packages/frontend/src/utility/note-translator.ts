/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ノートの翻訳の振り分け (bsky-fork 独自)。次の順に試し、使えなければ次へ進む。
// 1. 端末内の PLaMo 3 Translate (WebGPU が使える端末、plamo-translator.ts)
// 2. ブラウザ内蔵の Translator API (Chrome 138+)。言語パックが未取得で、サーバーの翻訳が使えるときは 3 へ進む
// 3. サーバーの翻訳 (notes/translate、DeepL)
// upstream の実験的な設定 experimental.enableWebTranslatorApi は使わない (2 は常に 3 より先に試す)。

import { reactive } from 'vue';
import * as Misskey from 'misskey-js';
import type { Ref } from 'vue';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { instance } from '@/instance.js';
import { miLocalStorage } from '@/local-storage.js';
import * as os from '@/os.js';
import { prefer } from '@/preferences.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { detectTextLang } from '@/utility/detect-text-lang.js';
import {
	PLAMO_MODEL_SIZE_MB,
	hasWebGpuAdapter,
	isPlamoEnvironmentSupported,
	isPlamoCrash,
	isPlamoModelCached,
	isPlamoModelLoading,
	isPlamoModelOnServer,
	isPlamoUnusable,
	toPlamoLang,
	translateWithPlamo,
} from '@/utility/plamo-translator.js';

export type NoteTranslation = Misskey.entities.NotesTranslateResponse & {
	// 'plamo' のときは翻訳欄に「Built with PLaMo」を表示する
	engine?: 'plamo' | 'browser' | 'server';
};

// PLaMo の結果を待っているノート。翻訳欄のダウンロード・読み込みの進捗は、このノートにだけ出す
export const plamoWaitingNoteIds = reactive(new Set<string>());

// 「今回は使わない」を選んだら、このページを開いている間は確認を出さずに次の手段を使う
let plamoDeclinedThisSession = false;

type LanguageDetectorStatic = {
	availability(): Promise<string>;
	create(): Promise<{ detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]> }>;
};

function getLanguageDetector(): LanguageDetectorStatic | null {
	return (window as unknown as { LanguageDetector?: LanguageDetectorStatic }).LanguageDetector ?? null;
}

function isInBrowserTranslationAvailable(): boolean {
	return getLanguageDetector() != null && window.Translator != null;
}

function canUseServerTranslation(): boolean {
	return $i != null && $i.policies.canUseTranslator && instance.translatorAvailable;
}

function currentTargetLang(): string {
	return miLocalStorage.getItem('lang') ?? navigator.language;
}

function canUsePlamo(targetLang: string): boolean {
	return $i != null && prefer.s['plamoTranslator.enabled'] && isPlamoEnvironmentSupported() && !isPlamoUnusable() && toPlamoLang(targetLang) != null;
}

/**
 * ノートのメニューに「翻訳」を出すか。
 */
export function canTranslateNotes(): boolean {
	return (canUsePlamo(currentTargetLang()) && !plamoDeclinedThisSession) || isInBrowserTranslationAvailable() || canUseServerTranslation();
}

function baseLang(lang: string): string {
	return lang.toLowerCase().split('-')[0];
}

type DetectedLang = {
	lang: string;
	// ブラウザの言語判定の結果か。簡易判定 (detect-text-lang.ts) のときは false で、同じ言語とみなして翻訳を省く判断には使わない
	reliable: boolean;
};

async function detectSourceLang(text: string): Promise<DetectedLang | null> {
	const detector = getLanguageDetector();
	if (detector != null) {
		try {
			if (await detector.availability() === 'available') {
				const [top] = await (await detector.create()).detect(text);
				if (top != null && top.detectedLanguage !== 'und' && top.confidence >= 0.5) return { lang: top.detectedLanguage, reliable: true };
			}
		} catch {
			// 判定できなければ文字の種類で判定する
		}
	}
	const lang = detectTextLang(text);
	return lang == null ? null : { lang, reliable: false };
}

async function confirmModelDownload(): Promise<boolean> {
	const { canceled, result } = await os.actions({
		type: 'question',
		title: i18n.ts._plamoTranslator.downloadTitle,
		text: i18n.tsx._plamoTranslator.downloadText({ size: PLAMO_MODEL_SIZE_MB }),
		actions: [
			{ value: 'download', text: i18n.ts._plamoTranslator.download, primary: true },
			{ value: 'later', text: i18n.ts._plamoTranslator.notThisTime },
			{ value: 'never', text: i18n.ts._plamoTranslator.never },
		],
	});
	if (canceled || result === 'later') {
		plamoDeclinedThisSession = true;
		return false;
	}
	if (result === 'never') {
		prefer.commit('plamoTranslator.enabled', false);
		return false;
	}
	return result === 'download';
}

type TranslateTarget = {
	noteId: string;
	text: string;
	targetLang: string;
	translation: Ref<NoteTranslation | null>;
	translating: Ref<boolean>;
};

async function tryPlamo(t: TranslateTarget): Promise<boolean> {
	if (plamoDeclinedThisSession || !canUsePlamo(t.targetLang)) return false;
	const plamoLang = toPlamoLang(t.targetLang);
	if (plamoLang == null || !(await hasWebGpuAdapter())) return false;

	try {
		// 翻訳元と翻訳先が同じなら本文をそのまま出す (ダウンロードの確認より先に判定する)
		const source = await detectSourceLang(t.text);
		if (source != null && source.reliable && baseLang(source.lang) === baseLang(plamoLang)) {
			t.translation.value = { sourceLang: source.lang, text: t.text };
			return true;
		}

		// ダウンロード済みか、別のノートの翻訳でダウンロード中なら確認しない。ダウンロードを許すのは、
		// ここで確認を取ったときだけにする (進行中のダウンロードが失敗したり、設定画面で削除されたりした後に、
		// 確認なしで取り直さないため。読み込み中・読み込み済みなら translateWithPlamo はそのまま進む)
		let allowDownload = false;
		if (!isPlamoModelLoading() && !(await isPlamoModelCached())) {
			// サーバーがまだモデルを用意できていなければ、確認を出さずに次の手段を使う
			if (!(await isPlamoModelOnServer())) return false;
			if (!(await confirmModelDownload())) return false;
			allowDownload = true;
		}

		const sourceLabel = source?.lang ?? i18n.ts._plamoTranslator.unknownLanguage;
		plamoWaitingNoteIds.add(t.noteId);
		try {
			const translated = await translateWithPlamo(t.text, plamoLang, {
				allowDownload,
				onPartial: (partial) => {
					t.translating.value = false;
					t.translation.value = { sourceLang: sourceLabel, text: partial, engine: 'plamo' };
				},
			});
			t.translation.value = { sourceLang: sourceLabel, text: translated, engine: 'plamo' };
		} finally {
			plamoWaitingNoteIds.delete(t.noteId);
		}
		return true;
	} catch (err) {
		console.warn('on-device translation (PLaMo) failed, trying the next translator', err);
		if (isPlamoCrash(err)) {
			// GPU 側の異常終了の後に同じ翻訳を繰り返させない。設定から再びオンにできる
			prefer.commit('plamoTranslator.enabled', false);
			os.toast(i18n.ts._plamoTranslator.disabledAfterError);
		}
		t.translation.value = null;
		t.translating.value = true;
		return false;
	}
}

async function tryBrowserTranslator(t: TranslateTarget): Promise<boolean> {
	const detector = getLanguageDetector();
	const translatorApi = window.Translator;
	if (detector == null || translatorApi == null) return false;
	// 言語パックのダウンロードが要るときは、サーバーの翻訳が使えるならそちらを使う
	const needsDownload = (availability: string) => availability !== 'available';
	try {
		const detectorAvailability = await detector.availability();
		if (detectorAvailability === 'unavailable') return false;
		if (needsDownload(detectorAvailability) && canUseServerTranslation()) return false;

		const [top] = await (await detector.create()).detect(t.text);
		const sourceLang = top?.detectedLanguage;
		const targetLang = baseLang(t.targetLang);
		if (sourceLang == null || sourceLang === 'und') return false;
		if (baseLang(sourceLang) === targetLang) {
			t.translation.value = { sourceLang, text: t.text };
			return true;
		}

		const availability = await translatorApi.availability({ sourceLanguage: sourceLang, targetLanguage: targetLang });
		if (availability === 'unavailable') return false;
		if (needsDownload(availability) && canUseServerTranslation()) return false;

		const translator = await translatorApi.create({ sourceLanguage: sourceLang, targetLanguage: targetLang });
		try {
			t.translation.value = { sourceLang, text: await translator.translate(t.text), engine: 'browser' };
		} finally {
			translator.destroy?.();
		}
		return true;
	} catch (err) {
		console.warn('in-browser translation failed, trying the next translator', err);
		return false;
	}
}

/**
 * ノートを翻訳して translation に入れる。
 */
export async function translateNote(note: Misskey.entities.Note, text: string, translation: Ref<NoteTranslation | null>, translating: Ref<boolean>, targetLang: string): Promise<void> {
	if (text.trim() === '') return;
	const t: TranslateTarget = { noteId: note.id, text, targetLang, translation, translating };
	translating.value = true;
	try {
		if (await tryPlamo(t)) return;
		if (await tryBrowserTranslator(t)) return;
		if (canUseServerTranslation()) {
			try {
				const res = await misskeyApi('notes/translate', { noteId: note.id, targetLang });
				translation.value = res != null ? { ...res, engine: 'server' } : null;
			} catch (err) {
				console.warn('server translation failed', err);
				os.alert({ type: 'error', text: i18n.ts.somethingHappened });
			}
			return;
		}
		os.alert({ type: 'error', text: i18n.ts._plamoTranslator.unavailable });
	} finally {
		translating.value = false;
	}
}
