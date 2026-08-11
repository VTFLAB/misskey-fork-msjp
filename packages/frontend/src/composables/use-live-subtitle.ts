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
	// Chrome 142+ / Edge 150+ (Canary/Dev, flag要) の on-device 音声認識強制 (対応環境のみ有効)
	processLocally: boolean;
	micDeviceId: string | null;
	translatorEngine: LiveSubtitleTranslatorEngine;
	targetLang: string;
	gasUrl: string;
	// miLocalStorageのみに保存、サーバーには送らない
	deeplApiKey: string;
	// WASM ASR (Whisper) のモデルID上書き。空文字ならデフォルト (onnx-community/whisper-base) を使う。
	// 配布元 (HuggingFace) 障害時や、自前ミラーへ切り替えたい場合の逃げ道
	wasmAsrModelOverride: string;
};

const DEFAULT_SETTINGS: LiveSubtitleSettings = {
	engine: 'webspeech',
	processLocally: false,
	micDeviceId: null,
	translatorEngine: 'local',
	targetLang: 'en',
	gasUrl: '',
	deeplApiKey: '',
	wasmAsrModelOverride: '',
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
// 主経路: Web Speech API。フォールバック: WASM (Whisper、下記 WasmRecognizer 参照。
// 選定経緯・トレードオフはそのクラスのコメントを参照)

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
	start(opts: { deviceId: string | null; processLocally: boolean; stream?: MediaStream }): void;
	stop(): void;
}

/**
 * getUserMedia() の失敗を、既存の音声認識エラーコード体系 (SpeechRecognitionErrorEvent.error 相当)
 * にマッピングする。呼び出し側 (subtitle-panel.vue) はこのコードを liveSubtitleAsrErrorMessage に
 * そのまま格納すれば、Web Speech 側のエラー表示と同じ分岐で表示できる。
 */
export function mapGetUserMediaErrorCode(err: unknown): string {
	if (err instanceof DOMException) {
		if (err.name === 'NotAllowedError' || err.name === 'SecurityError') return 'not-allowed';
		if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError' || err.name === 'DevicesNotFoundError') return 'audio-capture';
		return err.name;
	}
	return 'unknown';
}

export type MicPermissionState = 'unknown' | 'granted' | 'denied' | 'prompt';

/**
 * navigator.permissions.query({name:'microphone'}) の現在状態を取得する。
 * Safari 等 permissions API 非対応環境では 'unknown' を返す (getUserMedia 自体は別途試せる)。
 * onChange が渡された場合、状態が変わるたびに呼び出す (呼び出し側で reactive ref を更新する用途)。
 */
export async function queryMicPermissionState(onChange?: (state: MicPermissionState) => void): Promise<MicPermissionState> {
	if (typeof navigator === 'undefined' || navigator.permissions?.query == null) return 'unknown';
	try {
		const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
		if (onChange != null) {
			status.onchange = () => onChange(status.state as MicPermissionState);
		}
		return status.state as MicPermissionState;
	} catch {
		return 'unknown';
	}
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
			// onerror 後は onend が必ずしも発火しない (aborted / 一部内部状態)。
			// ここで null 化しておかないと、後続の start() が stale なインスタンスを
			// 参照する恐れがあるため、常に null 化する (onend での再 null 化は無害)。
			// オーケストレータ側 (Change 1) で onerror 自体が再起動をスケジュールするため、
			// onend が来なくても再起動が保証される。
			this.recognition = null;
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

// WASM ASR フォールバック。Web Speech API 非対応環境 (Firefox / Brave 等) 向け。
//
// 選定経緯 (詳細は doc/live-streaming/subtitle-contract.md 実装時の調査記録を参照):
// - 第一候補 sherpa-onnx WASM zipformer-ja-reazonspeech は npm 配布されておらず
//   (npm の "sherpa-onnx" パッケージは Node ネイティブアドオン用で browser WASM 版は
//   emscripten で自前ビルドしCDN scriptタグ相当で読み込む前提のため導入基準(a)を満たさない)、
//   本forkでは不採用。
// - 次点 vosk-browser は npm 配布・dynamic import 可能だが、公式 Vosk 日本語モデル配布元
//   (alphacephei.com) が Access-Control-Allow-Origin を返さずクライアント直fetchが
//   CORSで失敗する (実測済み、基準(d)不成立)。HuggingFace上の代替ミラーも見当たらない。
// - 採用: 既に翻訳(local-wasm)で使用中の @huggingface/transformers (Apache-2.0) +
//   Whisper 多言語モデル (onnx-community/whisper-base、ベースは openai/whisper で MIT)。
//   HuggingFaceは実測でCORS許可 (Access-Control-Allow-Origin をorigin反射) 済み、
//   pnpm依存として既存、Cache Storageへの自動キャッシュも標準機能。
//   真のトークンストリーミングではなく「発話区間をエネルギーベースVADで区切りながら
//   区間ごとに再デコードし、部分結果として都度上書き→無音検知で確定」という擬似ストリーミング
//   (whisper-web等の実装と同型)。日本語精度は概ねWeb Speechと同等以上だが、確定までの
//   レイテンシはWeb Speechより大きい (UIに注記する)。
const WASM_ASR_DEFAULT_MODEL = 'onnx-community/whisper-base';
const WASM_ASR_PARTIAL_INTERVAL_MS = 1500;
const WASM_ASR_SILENCE_FINALIZE_MS = 900;
const WASM_ASR_MAX_UTTERANCE_MS = 20_000;
const WASM_ASR_VAD_RMS_THRESHOLD = 0.012;

export type WasmAsrStatusState = 'idle' | 'loading' | 'downloading' | 'ready' | 'error';

export type WasmAsrStatus = {
	state: WasmAsrStatusState;
	downloadProgress: number | null;
	errorDetail: string | null;
};

export const wasmAsrStatus = ref<WasmAsrStatus>({ state: 'idle', downloadProgress: null, errorDetail: null });

type WhisperTranscriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;

let wasmAsrPipelinePromise: Promise<WhisperTranscriber> | null = null;
let wasmAsrPipelineModelId: string | null = null;

async function getWasmAsrPipeline(modelId: string): Promise<WhisperTranscriber> {
	if (wasmAsrPipelinePromise != null && wasmAsrPipelineModelId === modelId) return wasmAsrPipelinePromise;
	wasmAsrPipelineModelId = modelId;
	wasmAsrStatus.value = { state: 'loading', downloadProgress: 0, errorDetail: null };
	wasmAsrPipelinePromise = (async () => {
		const { pipeline } = await import('@huggingface/transformers');
		const transcriber = await pipeline('automatic-speech-recognition', modelId, {
			device: 'wasm',
			dtype: 'q8',
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			progress_callback: (progress: any) => {
				if (progress?.status === 'progress' && typeof progress.progress === 'number') {
					wasmAsrStatus.value = { state: 'downloading', downloadProgress: Math.round(progress.progress), errorDetail: null };
				}
			},
		} as never) as unknown as WhisperTranscriber;
		wasmAsrStatus.value = { state: 'ready', downloadProgress: 100, errorDetail: null };
		return transcriber;
	})();
	wasmAsrPipelinePromise.catch((err) => {
		wasmAsrPipelinePromise = null;
		wasmAsrPipelineModelId = null;
		wasmAsrStatus.value = { state: 'error', downloadProgress: null, errorDetail: String(err) };
	});
	return wasmAsrPipelinePromise;
}

// AudioWorklet プロセッサ本体。静的アセットを追加せず Blob URL 経由で読み込む
// (ビルド構成に手を入れない/依存を増やさないための最小実装)
const PCM_CAPTURE_PROCESSOR_SRC = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
	process(inputs) {
		const input = inputs[0];
		if (input && input[0] && input[0].length > 0) {
			this.port.postMessage(input[0].slice(0));
		}
		return true;
	}
}
registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
`;

function resampleTo16k(chunks: Float32Array[], sourceRate: number): Float32Array {
	let totalLen = 0;
	for (const c of chunks) totalLen += c.length;
	const merged = new Float32Array(totalLen);
	let offset = 0;
	for (const c of chunks) {
		merged.set(c, offset);
		offset += c.length;
	}
	if (sourceRate === 16000 || merged.length === 0) return merged;
	const ratio = sourceRate / 16000;
	const newLen = Math.max(1, Math.floor(merged.length / ratio));
	const out = new Float32Array(newLen);
	for (let i = 0; i < newLen; i++) {
		const srcIdx = i * ratio;
		const idx0 = Math.floor(srcIdx);
		const idx1 = Math.min(idx0 + 1, merged.length - 1);
		const frac = srcIdx - idx0;
		out[i] = merged[idx0] * (1 - frac) + merged[idx1] * frac;
	}
	return out;
}

function rms(chunk: Float32Array): number {
	if (chunk.length === 0) return 0;
	let sum = 0;
	for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
	return Math.sqrt(sum / chunk.length);
}

class WasmRecognizer implements RecognizerBackend {
	readonly kind: LiveSubtitleAsrEngine = 'wasm';
	private handlers: Parameters<RecognizerBackend['setHandlers']>[0] | null = null;
	private audioCtx: AudioContext | null = null;
	private workletNode: AudioWorkletNode | null = null;
	private sourceNode: MediaStreamAudioSourceNode | null = null;
	private stream: MediaStream | null = null;
	private ownsStream = false;
	private running = false;
	private busy = false;
	private utteranceChunks: Float32Array[] = [];
	private utteranceId: string | null = null;
	private hasSpeech = false;
	private lastVoiceActivityAt = 0;
	private utteranceStartedAt = 0;
	private partialTimer: number | null = null;

	isSupported(): boolean {
		return typeof window !== 'undefined'
			&& typeof AudioContext !== 'undefined'
			&& typeof AudioWorkletNode !== 'undefined'
			&& typeof WebAssembly !== 'undefined';
	}

	setHandlers(handlers: Parameters<RecognizerBackend['setHandlers']>[0]) {
		this.handlers = handlers;
	}

	start(opts: { deviceId: string | null; processLocally: boolean; stream?: MediaStream }) {
		void opts.processLocally; // on-deviceは常時 (WASM実行のため意味を持たない)
		this.running = true;
		void this.startAsync(opts);
	}

	private async startAsync(opts: { deviceId: string | null; stream?: MediaStream }) {
		try {
			const modelId = liveSubtitleSettings.value.wasmAsrModelOverride.trim() || WASM_ASR_DEFAULT_MODEL;
			const transcriberPromise = getWasmAsrPipeline(modelId);

			let stream = opts.stream ?? null;
			if (stream != null) {
				this.ownsStream = true;
			} else {
				stream = await navigator.mediaDevices.getUserMedia({
					audio: opts.deviceId ? { deviceId: { exact: opts.deviceId } } : true,
				});
				this.ownsStream = true;
			}
			if (!this.running) {
				stream.getTracks().forEach(t => t.stop());
				return;
			}
			this.stream = stream;

			const audioCtx = new AudioContext();
			this.audioCtx = audioCtx;
			const blobUrl = URL.createObjectURL(new Blob([PCM_CAPTURE_PROCESSOR_SRC], { type: 'application/javascript' }));
			try {
				await audioCtx.audioWorklet.addModule(blobUrl);
			} finally {
				URL.revokeObjectURL(blobUrl);
			}
			if (!this.running) {
				await audioCtx.close();
				return;
			}
			const sourceNode = audioCtx.createMediaStreamSource(stream);
			const workletNode = new AudioWorkletNode(audioCtx, 'pcm-capture-processor');
			this.sourceNode = sourceNode;
			this.workletNode = workletNode;
			this.resetUtterance();
			workletNode.port.onmessage = (ev: MessageEvent<Float32Array>) => {
				this.onAudioChunk(ev.data, audioCtx.sampleRate);
			};
			sourceNode.connect(workletNode);

			// モデルのロードを待ってからストリーミング推論を開始する (待機中も音声は蓄積している)
			await transcriberPromise;
			if (!this.running) return;

			this.partialTimer = window.setInterval(() => { void this.maybeRunPartial(audioCtx.sampleRate); }, WASM_ASR_PARTIAL_INTERVAL_MS);
		} catch (err) {
			this.handlers?.onError(err instanceof DOMException ? mapGetUserMediaErrorCode(err) : 'wasm-init-failed');
			this.teardownAudio();
			this.running = false;
		}
	}

	private resetUtterance() {
		this.utteranceChunks = [];
		this.utteranceId = crypto.randomUUID();
		this.hasSpeech = false;
		this.utteranceStartedAt = Date.now();
		this.lastVoiceActivityAt = Date.now();
	}

	private onAudioChunk(chunk: Float32Array, _sampleRate: number) {
		void _sampleRate;
		if (!this.running) return;
		this.utteranceChunks.push(chunk);
		if (rms(chunk) >= WASM_ASR_VAD_RMS_THRESHOLD) {
			this.hasSpeech = true;
			this.lastVoiceActivityAt = Date.now();
		}
	}

	private async maybeRunPartial(sampleRate: number) {
		if (!this.running || this.busy) return;
		const now = Date.now();
		const silentFor = now - this.lastVoiceActivityAt;
		const utteranceAgeMs = now - this.utteranceStartedAt;

		if (!this.hasSpeech) {
			// 無音のまま長時間 (VADが一度も発話を検知しない) の場合はバッファを捨てて肥大化を防ぐ
			if (this.utteranceChunks.length > 0 && utteranceAgeMs > WASM_ASR_SILENCE_FINALIZE_MS * 2) {
				this.utteranceChunks = [];
				this.utteranceStartedAt = now;
			}
			return;
		}

		const shouldFinalize = silentFor >= WASM_ASR_SILENCE_FINALIZE_MS || utteranceAgeMs >= WASM_ASR_MAX_UTTERANCE_MS;
		// 発話ID・音声バッファをこの時点でスナップショットする (await中に resetUtterance() が
		// 呼ばれても、この推論結果は今回の発話に対して発行されるようにするため)
		const utteranceId = this.utteranceId;
		if (utteranceId == null) return;
		this.busy = true;
		try {
			const audio = resampleTo16k(this.utteranceChunks.slice(), sampleRate);
			if (audio.length < 1600) return; // 100ms未満は推論しない
			const modelId = liveSubtitleSettings.value.wasmAsrModelOverride.trim() || WASM_ASR_DEFAULT_MODEL;
			const transcriber = await getWasmAsrPipeline(modelId);
			const result = await transcriber(audio, {
				language: 'japanese',
				task: 'transcribe',
				chunk_length_s: 30,
			});
			const text = (Array.isArray(result) ? result[0]?.text : result?.text) ?? '';
			if (!this.running) return;
			this.handlers?.onResult({ id: utteranceId, text: text.trim(), isFinal: shouldFinalize });
			if (shouldFinalize && this.utteranceId === utteranceId) this.resetUtterance();
		} catch (err) {
			console.warn('wasm ASR transcription failed:', err);
		} finally {
			this.busy = false;
		}
	}

	private teardownAudio() {
		if (this.partialTimer != null) {
			window.clearInterval(this.partialTimer);
			this.partialTimer = null;
		}
		try { this.sourceNode?.disconnect(); } catch { /* noop */ }
		try { this.workletNode?.disconnect(); } catch { /* noop */ }
		this.sourceNode = null;
		this.workletNode = null;
		if (this.audioCtx != null) {
			void this.audioCtx.close();
			this.audioCtx = null;
		}
		if (this.ownsStream) {
			this.stream?.getTracks().forEach(t => t.stop());
		}
		this.stream = null;
		this.ownsStream = false;
	}

	stop() {
		this.running = false;
		this.teardownAudio();
	}
}

const webSpeechRecognizer = new WebSpeechRecognizer();
const wasmRecognizer = new WasmRecognizer();

function getRecognizer(engine: LiveSubtitleAsrEngine): RecognizerBackend {
	return engine === 'wasm' ? wasmRecognizer : webSpeechRecognizer;
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

// --- ウォッチドッグ (Change 4) ---
// Web Speech API は長時間セッション中、onresult/onerror/onend いずれも発火しない
// 「サイレント停止」を起こすことがある (ブラウザのリソース管理 / バックグラウンドタブ throttling /
// オンデバイスモデルのハング)。ユーザー報告の「エラー無しに listening のまま停止」はこれ。
// 定期的に「最後の結果受信時刻」をチェックし、猶予を超えたら強制再起動する。
// WASM エンジンも同一の onResult 経由で結果を出すため、バックエンド非依存でカバーできる。
let watchdogTimer: number | null = null;
let lastRecognitionEventAt = 0;
// 結果が全く来ないままこの時間を超えたら停滞と判定して強制再起動する (猶予は大きめ)。
const WATCHDOG_TIMEOUT_MS = 30_000;
// チェック間隔。10s ごとに staleness を確認する (setTimeout の自前再 arms で実装)。
const WATCHDOG_INTERVAL_MS = 10_000;

function clearWatchdog() {
	if (watchdogTimer != null) {
		window.clearTimeout(watchdogTimer);
		watchdogTimer = null;
	}
}

function ensureWatchdog() {
	clearWatchdog();
	if (!liveSubtitleRunning.value) return;
	// 自前再 arms する setTimeout (setInterval と等価だが、コールバック内で liveSubtitleRunning を
	// 再評価できる分、停止時の無駄発火を消しやすい)
	const arm = () => {
		if (!liveSubtitleRunning.value) {
			watchdogTimer = null;
			return;
		}
		// listening 中のみ停滞判定 (starting/restarting 中はイベントが来なくても正常)
		if (liveSubtitleAsrStatus.value === 'listening') {
			const silentFor = Date.now() - lastRecognitionEventAt;
			if (silentFor > WATCHDOG_TIMEOUT_MS) {
				// 強制再起動: 死んでいる可能性がある認識インスタンスを破棄して、即時再起動。
				// backoff は膨らませない (ウォッチドッグ発火は「実エラー」ではない)。
				// エラーメッセージは設定しない (UI には 'restarting' 状態のみ出す)。
				const recognizer = getRecognizer(liveSubtitleSettings.value.engine);
				recognizer.stop();
				consecutiveErrorCount = 0;
				scheduleRestart();
			}
		}
		watchdogTimer = window.setTimeout(arm, WATCHDOG_INTERVAL_MS);
	};
	watchdogTimer = window.setTimeout(arm, WATCHDOG_INTERVAL_MS);
}

// マイク許可拒否系のエラーコード。リトライしても解決しないため自動再起動を止め、
// 明示的にUIへ「サイト設定でマイクを許可してください」を出させる (契約: タスク1)
const MIC_PERMISSION_ERROR_CODES = new Set(['not-allowed', 'service-not-allowed']);
// その他、リトライしても解決しない終端エラー
const TERMINAL_ERROR_CODES = new Set(['audio-capture', 'unsupported', 'wasm-init-failed']);

export function isMicPermissionErrorCode(code: string | null): boolean {
	return code != null && MIC_PERMISSION_ERROR_CODES.has(code);
}

// startLiveSubtitle() に渡された、権限確定用に事前取得済みのストリーム (WASMエンジン用)。
// 一度 recognizer.start() へ渡したら使い切りで捨てる (再起動時は自前で再取得させる)
let pendingInitialStream: MediaStream | null = null;

function startRecognitionOnly() {
	const settings = liveSubtitleSettings.value;
	const recognizer = getRecognizer(settings.engine);
	if (!recognizer.isSupported()) {
		liveSubtitleAsrStatus.value = 'unsupported';
		liveSubtitleAsrErrorMessage.value = settings.engine === 'wasm'
			? 'wasm-unsupported'
			: 'webspeech-unsupported';
		liveSubtitleRunning.value = false;
		return;
	}
	recognizer.setHandlers({
		onResult: (result) => {
			// 結果を受け取れたなら回線は正常に機能している。バックオフをリセットする
			consecutiveErrorCount = 0;
			// --- Change 4: ウォッチドッグ用タイムスタンプ更新 ---
			// onresult/onerror/onend いずれも発火しない「サイレント停止」を検知するため、
			// 最後に結果を受け取った時刻を記録する (ウォッチドッグが this を参照して比較する)
			lastRecognitionEventAt = Date.now();
			liveSubtitleAsrStatus.value = 'listening';
			handleRecognitionResult(result);
		},
		onError: (code) => {
			liveSubtitleAsrErrorMessage.value = code;
			// 権限拒否・マイク未接続・非対応はリトライしても解決しないため自動再起動を止める
			if (MIC_PERMISSION_ERROR_CODES.has(code) || TERMINAL_ERROR_CODES.has(code)) {
				liveSubtitleAsrStatus.value = 'error';
				liveSubtitleRunning.value = false;
				return;
			}
			// --- Change 1: onerror 自身で再起動をスケジュールする ---
			// Web Speech API は onerror の後に必ずしも onend を発火しない (aborted や一部内部状態)。
			// 従来は onerror → consecutiveErrorCount++ のみで、onend 依存で scheduleRestart していたため、
			// onend が来ないと再起動されず「listening のまま停止」になる (本バグの主因)。
			// ここで直接 scheduleRestart を呼ぶことで onend 非依存の回復を保証する。
			// (onend が後続で来ても scheduleRestart 内の clearRestartTimer でタイマー重複は解消される)
			//
			// --- Change 2: no-speech はバックオフ対象外 ---
			// no-speech は continuous=true の長時間セッションで「無音が続いた」だけの正常イベント。
			// 従来は consecutiveErrorCount++ されていたため、数回の no-speech で再起動遅延が 30s まで
			// 指数膨張し「停止したように見える」症状を引き起こしていた。ここでは backoff を増やさず、
			// 即時リセット (consecutiveErrorCount = 0) して short delay で再起動させる。
			if (code === 'no-speech') {
				consecutiveErrorCount = 0;
			} else {
				consecutiveErrorCount++;
			}
			scheduleRestart();
		},
		onEnd: () => {
			// continuous=true でもブラウザ都合で onend が飛ぶことがあるため、
			// 明示停止でない限り (running=trueのまま) 自動再起動する
			if (liveSubtitleRunning.value) scheduleRestart();
		},
	});
	liveSubtitleAsrStatus.value = 'starting';
	liveSubtitleAsrErrorMessage.value = null;
	const stream = pendingInitialStream ?? undefined;
	pendingInitialStream = null;
	recognizer.start({ deviceId: settings.micDeviceId, processLocally: settings.processLocally, stream });
	// 認識開始と同時にウォッチドッグを arms する (前回の認識インスタンスが残したタイマーがあれば上書き)
	ensureWatchdog();
}

// --- 公開API ---

/**
 * @param stream 呼び出し側 (subtitle-panel.vue のStartボタンハンドラ) がユーザージェスチャー内で
 *   事前取得した MediaStream。webspeechエンジンでは権限確定用途のみで使われず (Web Speech は
 *   自前でマイクを掴むため未使用)、wasmエンジンではそのまま音声取得に使い回す。
 */
export function startLiveSubtitle(stream?: MediaStream) {
	if (liveSubtitleRunning.value) {
		stream?.getTracks().forEach(t => t.stop());
		return;
	}
	liveSubtitleRunning.value = true;
	consecutiveErrorCount = 0;
	liveSubtitleCurrentCaption.value = null;
	liveSubtitleCurrentTranslation.value = null;
	pendingInitialStream = stream ?? null;
	ensurePublishTimer();
	queueClear();
	startRecognitionOnly();
}

export function stopLiveSubtitle() {
	if (!liveSubtitleRunning.value && liveSubtitleAsrStatus.value === 'idle') return;
	liveSubtitleRunning.value = false;
	clearRestartTimer();
	clearWatchdog();
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
 * Chrome 142+ / Edge 150+ (Canary/Dev, flag要) の on-device 音声認識 (processLocally) が使えるか確認する
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
