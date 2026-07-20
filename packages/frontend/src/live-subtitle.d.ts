/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ライブ字幕機能 (bsky-fork 独自) が使う、TypeScript の lib.dom.d.ts に
// まだ含まれていない実験的ブラウザ API の最小限のアンビエント型定義。
// Web Speech API (webkitSpeechRecognition) と Chrome 内蔵翻訳 API (Translator) が対象。

// SpeechRecognitionAlternative / SpeechRecognitionResult / SpeechRecognitionResultList は
// TypeScript 5.9 の lib.dom.d.ts に取り込まれたため、ここでは宣言しない (二重定義になる)。

interface SpeechRecognitionErrorEvent extends Event {
	readonly error: string;
	readonly message: string;
}

interface SpeechRecognitionEvent extends Event {
	readonly resultIndex: number;
	readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognition extends EventTarget {
	lang: string;
	continuous: boolean;
	interimResults: boolean;
	maxAlternatives: number;
	// Chrome 139+ の on-device 認識強制オプション (非標準)
	processLocally?: boolean;
	start(): void;
	stop(): void;
	abort(): void;
	onstart: ((this: SpeechRecognition, ev: Event) => unknown) | null;
	onend: ((this: SpeechRecognition, ev: Event) => unknown) | null;
	onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => unknown) | null;
	onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => unknown) | null;
}

interface SpeechRecognitionStatic {
	new (): SpeechRecognition;
	// Chrome 139+: on-device 認識モデルの利用可否を確認する静的メソッド (非標準)
	available?: (options: { langs: string[]; processLocally?: boolean }) => Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'>;
}

interface Window {
	SpeechRecognition?: SpeechRecognitionStatic;
	webkitSpeechRecognition?: SpeechRecognitionStatic;
}

// Chrome 138+ の on-device 翻訳 API (非標準、Translator API)
type TranslatorAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface TranslatorDownloadProgressEvent extends Event {
	readonly loaded: number;
}

interface TranslatorCreateMonitor extends EventTarget {
	addEventListener(type: 'downloadprogress', listener: (ev: TranslatorDownloadProgressEvent) => void, options?: boolean | AddEventListenerOptions): void;
	addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
}

interface TranslatorInstance {
	translate(text: string): Promise<string>;
	destroy?(): void;
}

interface TranslatorStatic {
	availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<TranslatorAvailability>;
	create(options: {
		sourceLanguage: string;
		targetLanguage: string;
		monitor?: (m: TranslatorCreateMonitor) => void;
	}): Promise<TranslatorInstance>;
}

interface Window {
	Translator?: TranslatorStatic;
}
