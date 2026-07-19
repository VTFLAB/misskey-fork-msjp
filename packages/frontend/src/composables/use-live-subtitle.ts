/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import { miLocalStorage } from '@/local-storage.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import type { LiveSubtitleTranslatorEngine } from '@/composables/live-subtitle-translators.js';
import { enqueueTranslation } from '@/composables/live-subtitle-translators.js';

// ライブ字幕: 音声認識 + クライアントサイド翻訳 + publish の統合 composable (bsky-fork 独自)。
// 配信ページ (live-stream.watch.vue) の配信者専用機能で、契約は
// doc/live-streaming/subtitle-contract.md Phase C を参照。
// サーバーは /api/twitch/subtitle/publish 経由でイベントを中継するだけで、
// 認識・翻訳はすべてこのファイル (と live-subtitle-translators.ts) でクライアント側完結する。

export type LiveSubtitleAsrEngine = 'webspeech' | 'wasm';

export type LiveSubtitleSettings = {
	engine: LiveSubtitleAsrEngine;
	// Chrome 139+ の on-device 音声認識強制 (対応環境のみ有効)
	processLocally: boolean;
	micDeviceId: string | null;
	translatorEngine: LiveSubtitleTranslatorEngine;
	targetLang: string;
	gasUrl: string;
	// miLocalStorageのみに保存、サーバーには送らない
	deeplApiKey: string;
};

const DEFAULT_SETTINGS: LiveSubtitleSettings = {
	engine: 'webspeech',
	processLocally: false,
	micDeviceId: null,
	translatorEngine: 'local',
	targetLang: 'en',
	gasUrl: '',
	deeplApiKey: '',
};

function loadSettings(): LiveSubtitleSettings {
	try {
		const raw = miLocalStorage.getItem('liveSubtitle');
		if (raw == null) return { ...DEFAULT_SETTINGS };
		return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

// モジュールシングルトン: ダイアログを閉じても配信ページ滞在中は認識・翻訳・publishが
// 継続する必要があるため、tts設定 (use-twitch-tts.ts) と同じくモジュールレベルで保持する
export const liveSubtitleSettings = ref<LiveSubtitleSettings>(loadSettings());

watch(liveSubtitleSettings, () => {
	miLocalStorage.setItem('liveSubtitle', JSON.stringify(liveSubtitleSettings.value));
}, { deep: true });

export type LiveSubtitleAsrStatus = 'idle' | 'starting' | 'listening' | 'restarting' | 'error' | 'unsupported';

export const liveSubtitleRunning = ref(false);
export const liveSubtitleAsrStatus = ref<LiveSubtitleAsrStatus>('idle');
export const liveSubtitleAsrErrorMessage = ref<string | null>(null);
// ライブプレビュー用: 現在認識中/確定した原文 (UIのプレビュー表示に使う。isFinal=falseの間は未確定)
export const liveSubtitleCurrentCaption = ref<{ text: string; isFinal: boolean } | null>(null);
export const liveSubtitleCurrentTranslation = ref<string | null>(null);

// --- ASRバックエンド抽象化 ---
// 主経路: Web Speech API。フォールバック (WASM) は今回のスコープではインターフェースの
// 用意までとし、実推論は未実装 (下記 WasmRecognizerStub 参照)

export type SubtitleRecognitionResult = {
	id: string;
	text: string;
	isFinal: boolean;
};

export interface RecognizerBackend {
	readonly kind: LiveSubtitleAsrEngine;
	isSupported(): boolean;
	setHandlers(handlers: {
		onResult: (result: SubtitleRecognitionResult) => void;
		onError: (code: string) => void;
		onEnd: () => void;
	}): void;
	start(opts: { deviceId: string | null; processLocally: boolean }): void;
	stop(): void;
}

class WebSpeechRecognizer implements RecognizerBackend {
	readonly kind: LiveSubtitleAsrEngine = 'webspeech';
	private recognition: SpeechRecognition | null = null;
	private handlers: Parameters<RecognizerBackend['setHandlers']>[0] | null = null;
	private resultIds = new Map<number, string>();

	private getCtor(): SpeechRecognitionStatic | null {
		if (typeof window === 'undefined') return null;
		return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
	}

	isSupported(): boolean {
		return this.getCtor() != null;
	}

	setHandlers(handlers: Parameters<RecognizerBackend['setHandlers']>[0]) {
		this.handlers = handlers;
	}

	start(opts: { deviceId: string | null; processLocally: boolean }) {
		const Ctor = this.getCtor();
		if (Ctor == null) {
			this.handlers?.onError('unsupported');
			return;
		}
		// Web Speech API は入力デバイスを明示指定する標準手段を持たず、常にOSデフォルトの
		// マイクを使う (ブラウザ実装依存)。opts.deviceId はUI上の選択肢としては保持するが、
		// このバックエンドでは反映できない (将来のWASMバックエンド用に settings に温存する)
		void opts.deviceId;
		this.resultIds.clear();
		const recognition = new Ctor();
		recognition.lang = 'ja-JP';
		recognition.continuous = true;
		recognition.interimResults = true;
		if (opts.processLocally) {
			try {
				recognition.processLocally = true;
			} catch {
				// 非対応ブラウザでは代入自体が無視される場合がある。onerror 側で拾う
			}
		}
		recognition.onresult = (ev: SpeechRecognitionEvent) => {
			for (let i = ev.resultIndex; i < ev.results.length; i++) {
				const result = ev.results[i];
				let id = this.resultIds.get(i);
				if (id == null) {
					id = crypto.randomUUID();
					this.resultIds.set(i, id);
				}
				const text = result.length > 0 ? result.item(0).transcript : '';
				this.handlers?.onResult({ id, text, isFinal: result.isFinal });
				if (result.isFinal) this.resultIds.delete(i);
			}
		};
		recognition.onerror = (ev: SpeechRecognitionErrorEvent) => {
			this.handlers?.onError(ev.error);
		};
		recognition.onend = () => {
			this.recognition = null;
			this.handlers?.onEnd();
		};
		this.recognition = recognition;
		try {
			recognition.start();
		} catch (err) {
			// start() を短時間に連打すると InvalidStateError が飛ぶことがある (再起動競合)
			this.handlers?.onError(err instanceof Error ? err.message : 'start-failed');
		}
	}

	stop() {
		const recognition = this.recognition;
		this.recognition = null;
		try {
			recognition?.stop();
		} catch {
			// 既に停止している場合は無視
		}
	}
}

// WASM ASR フォールバック (未実装スタブ)。Web Speech API 非対応環境
// (Firefox / Safari 等) 向けに、将来 sherpa-onnx WASM zipformer-ja-reazonspeech
// (第一候補) または vosk-browser ja (パッケージング困難な場合の代替) を実装する拡張点。
// 実装時にやること:
//   1. isSupported() を true にする (常時 or WASM/SharedArrayBuffer 対応判定)
//   2. start() で getUserMedia({ deviceId: opts.deviceId ?? undefined }) → AudioWorklet
//      で PCM フレームを取り出し、モデルへストリーミング推論
//   3. モデルファイルは Cache Storage に遅延ロード (初回のみダウンロード)
//   4. 認識結果を onResult ({id, text, isFinal}) で通知 (WebSpeechRecognizer と同じ契約)
class WasmRecognizerStub implements RecognizerBackend {
	readonly kind: LiveSubtitleAsrEngine = 'wasm';

	isSupported(): boolean {
		return false;
	}

	setHandlers() {
		// noop: 未実装
	}

	start(_opts: { deviceId: string | null; processLocally: boolean }) {
		void _opts;
		throw new Error('WASM ASR backend is not implemented yet (Phase C scope: interface only)');
	}

	stop() {
		// noop
	}
}

const webSpeechRecognizer = new WebSpeechRecognizer();
const wasmRecognizerStub = new WasmRecognizerStub();

function getRecognizer(engine: LiveSubtitleAsrEngine): RecognizerBackend {
	return engine === 'wasm' ? wasmRecognizerStub : webSpeechRecognizer;
}

// --- publishバッチング ---
// interim は id 単位に最新状態のみ保持して 100〜200ms間隔でまとめ送り、
// final / translation / clear は即時フラッシュする (contract: rate limit 600/分に収める)

type SubtitleEvent = Misskey.entities.TwitchSubtitlePublishRequest['events'][number];

const PUBLISH_INTERVAL_MS = 150;
const MAX_EVENTS_PER_REQUEST = 30;

const pendingInterim = new Map<string, SubtitleEvent>();
const immediateQueue: SubtitleEvent[] = [];
let publishTimer: number | null = null;
let flushing = false;

async function flushSubtitleEvents() {
	if (flushing) return;
	if (pendingInterim.size === 0 && immediateQueue.length === 0) return;
	flushing = true;
	try {
		const events: SubtitleEvent[] = [
			...Array.from(pendingInterim.values()),
			...immediateQueue.splice(0, immediateQueue.length),
		];
		pendingInterim.clear();
		for (let i = 0; i < events.length; i += MAX_EVENTS_PER_REQUEST) {
			const chunk = events.slice(i, i + MAX_EVENTS_PER_REQUEST);
			try {
				await misskeyApi('twitch/subtitle/publish', { events: chunk });
			} catch (err) {
				console.warn('live subtitle publish failed:', err);
			}
		}
	} finally {
		flushing = false;
	}
}

function ensurePublishTimer() {
	if (publishTimer != null) return;
	publishTimer = window.setInterval(() => { void flushSubtitleEvents(); }, PUBLISH_INTERVAL_MS);
}

function stopPublishTimer() {
	if (publishTimer != null) {
		window.clearInterval(publishTimer);
		publishTimer = null;
	}
}

function queueCaption(id: string, text: string, isFinal: boolean) {
	pendingInterim.set(id, { type: 'caption', id, text, isFinal });
	if (isFinal) void flushSubtitleEvents();
}

function queueTranslation(id: string, text: string, lang: string) {
	immediateQueue.push({ type: 'translation', id, text, lang });
	void flushSubtitleEvents();
}

function queueClear() {
	// clear は interim の途中状態を追い越して即クリアさせたいので pendingInterim も捨てる
	pendingInterim.clear();
	immediateQueue.push({ type: 'clear' });
	void flushSubtitleEvents();
}

// --- 音声認識イベントハンドリング ---

function handleRecognitionResult(result: SubtitleRecognitionResult) {
	liveSubtitleCurrentCaption.value = { text: result.text, isFinal: result.isFinal };
	if (result.text.trim() === '') return;
	queueCaption(result.id, result.text, result.isFinal);

	if (!result.isFinal) return;

	// 確定文のみ翻訳する (contract: final文のみ)
	const settings = liveSubtitleSettings.value;
	enqueueTranslation(settings.translatorEngine, result.text, {
		targetLang: settings.targetLang,
		gasUrl: settings.gasUrl,
		deeplApiKey: settings.deeplApiKey,
	}).then((translated) => {
		if (translated == null) return; // 失敗はスキップ (原文は既にcaptionで表示済み)
		liveSubtitleCurrentTranslation.value = translated;
		queueTranslation(result.id, translated, settings.targetLang);
	});
}

// --- 自動再起動 (指数バックオフ) ---

let restartTimer: number | null = null;
let consecutiveErrorCount = 0;
const RESTART_BASE_DELAY_MS = 500;
const RESTART_MAX_DELAY_MS = 30_000;

function clearRestartTimer() {
	if (restartTimer != null) {
		window.clearTimeout(restartTimer);
		restartTimer = null;
	}
}

function scheduleRestart() {
	if (!liveSubtitleRunning.value) return;
	clearRestartTimer();
	const delay = Math.min(RESTART_BASE_DELAY_MS * (2 ** consecutiveErrorCount), RESTART_MAX_DELAY_MS);
	liveSubtitleAsrStatus.value = 'restarting';
	restartTimer = window.setTimeout(() => {
		if (!liveSubtitleRunning.value) return;
		startRecognitionOnly();
	}, delay);
}

function startRecognitionOnly() {
	const settings = liveSubtitleSettings.value;
	const recognizer = getRecognizer(settings.engine);
	if (!recognizer.isSupported()) {
		liveSubtitleAsrStatus.value = 'unsupported';
		liveSubtitleAsrErrorMessage.value = settings.engine === 'wasm'
			? 'wasm-not-implemented'
			: 'webspeech-unsupported';
		liveSubtitleRunning.value = false;
		return;
	}
	recognizer.setHandlers({
		onResult: (result) => {
			// 結果を受け取れたなら回線は正常に機能している。バックオフをリセットする
			consecutiveErrorCount = 0;
			liveSubtitleAsrStatus.value = 'listening';
			handleRecognitionResult(result);
		},
		onError: (code) => {
			liveSubtitleAsrErrorMessage.value = code;
			// 権限拒否・マイク未接続はリトライしても解決しないため自動再起動を止める
			if (code === 'not-allowed' || code === 'audio-capture' || code === 'unsupported') {
				liveSubtitleAsrStatus.value = 'error';
				liveSubtitleRunning.value = false;
				return;
			}
			consecutiveErrorCount++;
		},
		onEnd: () => {
			// continuous=true でもブラウザ都合で onend が飛ぶことがあるため、
			// 明示停止でない限り (running=trueのまま) 自動再起動する
			if (liveSubtitleRunning.value) scheduleRestart();
		},
	});
	liveSubtitleAsrStatus.value = 'starting';
	liveSubtitleAsrErrorMessage.value = null;
	recognizer.start({ deviceId: settings.micDeviceId, processLocally: settings.processLocally });
}

// --- 公開API ---

export function startLiveSubtitle() {
	if (liveSubtitleRunning.value) return;
	liveSubtitleRunning.value = true;
	consecutiveErrorCount = 0;
	liveSubtitleCurrentCaption.value = null;
	liveSubtitleCurrentTranslation.value = null;
	ensurePublishTimer();
	queueClear();
	startRecognitionOnly();
}

export function stopLiveSubtitle() {
	if (!liveSubtitleRunning.value && liveSubtitleAsrStatus.value === 'idle') return;
	liveSubtitleRunning.value = false;
	clearRestartTimer();
	const recognizer = getRecognizer(liveSubtitleSettings.value.engine);
	recognizer.stop();
	liveSubtitleAsrStatus.value = 'idle';
	liveSubtitleAsrErrorMessage.value = null;
	liveSubtitleCurrentCaption.value = null;
	liveSubtitleCurrentTranslation.value = null;
	queueClear();
	stopPublishTimer();
}

/**
 * マイク入力デバイス一覧 (UIのマイク選択用)。ラベル取得のため事前に
 * getUserMedia の許可が下りている必要がある場合がある (呼び出しはUI操作契機に限る)
 */
export async function listMicDevices(): Promise<MediaDeviceInfo[]> {
	if (typeof navigator === 'undefined' || navigator.mediaDevices?.enumerateDevices == null) return [];
	const devices = await navigator.mediaDevices.enumerateDevices();
	return devices.filter(d => d.kind === 'audioinput');
}

export type ProcessLocallyAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unknown';

/**
 * Chrome 139+ の on-device 音声認識 (processLocally) が使えるか確認する
 */
export async function checkProcessLocallyAvailable(): Promise<ProcessLocallyAvailability> {
	if (typeof window === 'undefined') return 'unknown';
	const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
	if (Ctor?.available == null) return 'unknown';
	try {
		return await Ctor.available({ langs: ['ja-JP'], processLocally: true });
	} catch {
		return 'unknown';
	}
}

export function isWebSpeechSupported(): boolean {
	return webSpeechRecognizer.isSupported();
}
