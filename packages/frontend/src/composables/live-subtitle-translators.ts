/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { reactive } from 'vue';

// ライブ字幕の確定文翻訳 (bsky-fork 独自)。すべてクライアントサイドで完結させる
// (サーバーは翻訳処理をしない、契約 doc/live-streaming/subtitle-contract.md 参照)。
// 5エンジン (local / local-wasm / google / gas / deepl) を FIFO キュー・並列1・
// 同一文キャッシュで共通に扱う。個々のエンジン実装は translateWith() 以下。

export type LiveSubtitleTranslatorEngine = 'local' | 'local-wasm' | 'google' | 'gas' | 'deepl';

export type TranslatorEngineState = 'idle' | 'checking' | 'downloading' | 'ready' | 'unsupported' | 'error';

export type TranslatorStatus = {
	state: TranslatorEngineState;
	// local / local-wasm のモデルダウンロード進捗 (0-100)。対象外のときは null
	downloadProgress: number | null;
	// UI側でエンジン別のi18nメッセージに変換するための機械可読な理由コード
	errorReason: 'unsupported' | 'network' | 'cors' | 'not-configured' | 'bad-response' | 'rate-limited' | null;
	lastErrorDetail: string | null;
};

function initialStatus(): TranslatorStatus {
	return { state: 'idle', downloadProgress: null, errorReason: null, lastErrorDetail: null };
}

export const translatorStatuses = reactive<Record<LiveSubtitleTranslatorEngine, TranslatorStatus>>({
	local: initialStatus(),
	'local-wasm': initialStatus(),
	google: initialStatus(),
	gas: initialStatus(),
	deepl: initialStatus(),
});

function setStatus(engine: LiveSubtitleTranslatorEngine, patch: Partial<TranslatorStatus>) {
	Object.assign(translatorStatuses[engine], patch);
}

export class DeeplCorsError extends Error {
	constructor() {
		super('DeepL does not allow direct browser requests (CORS)');
		this.name = 'DeeplCorsError';
	}
}

export type TranslateOptions = {
	targetLang: string;
	gasUrl?: string;
	deeplApiKey?: string;
};

// --- local: Chrome内蔵 on-device Translator API (Chrome 138+) ---
//
// Chrome側は同時生存セッション数に上限があり、TranslatorInstance.destroy() で明示的に
// 手放す必要がある (型定義 live-subtitle.d.ts 参照)。以前はtargetLangごとにインスタンスを
// Mapへ無期限に貯め続け、破棄しないまま切替を繰り返すとセッションが蓄積して新規create()が
// 失敗する/古いインスタンスがブラウザ側で失効する不具合があった (言語・エンジン切替→
// localへ戻すと翻訳できなくなる、という報告の原因)。常にアクティブなtargetLangのセッション
// 1本だけを生かし、切替時は古いセッションを破棄する。

const localTranslatorInstances = new Map<string, Promise<TranslatorInstance>>();
let localActiveTargetLang: string | null = null;

function destroyLocalTranslator(targetLang: string) {
	const cached = localTranslatorInstances.get(targetLang);
	localTranslatorInstances.delete(targetLang);
	if (cached == null) return;
	cached
		.then((translator) => { try { translator.destroy?.(); } catch { /* 既に破棄済み等は無視 */ } })
		.catch(() => { /* create自体が失敗していたインスタンスは破棄不要 */ });
}

async function getLocalTranslator(targetLang: string): Promise<TranslatorInstance> {
	if (localActiveTargetLang !== targetLang) {
		// 言語切替: 古いセッションは全て破棄してから新しいセッションだけを生かす
		for (const staleLang of [...localTranslatorInstances.keys()]) {
			if (staleLang !== targetLang) destroyLocalTranslator(staleLang);
		}
		localActiveTargetLang = targetLang;
	}

	const cached = localTranslatorInstances.get(targetLang);
	if (cached != null) return cached;

	// この生成処理が完了する頃には既に別の言語へ切り替わっている場合、その古い結果で
	// 現在の状態表示を上書きしてしまわないためのガード
	const isCurrent = () => localActiveTargetLang === targetLang;

	const promise = (async () => {
		if (typeof window === 'undefined' || window.Translator == null) {
			if (isCurrent()) setStatus('local', { state: 'unsupported', errorReason: 'unsupported' });
			throw new Error('Translator API is not available in this browser');
		}
		if (isCurrent()) setStatus('local', { state: 'checking', errorReason: null });
		const availability = await window.Translator.availability({ sourceLanguage: 'ja', targetLanguage: targetLang });
		if (availability === 'unavailable') {
			if (isCurrent()) setStatus('local', { state: 'unsupported', errorReason: 'unsupported' });
			throw new Error(`Translator unavailable for ja -> ${targetLang}`);
		}
		if (availability === 'downloadable' || availability === 'downloading') {
			if (isCurrent()) setStatus('local', { state: 'downloading', downloadProgress: 0 });
		} else {
			if (isCurrent()) setStatus('local', { state: 'ready', downloadProgress: 100 });
		}
		const translator = await window.Translator.create({
			sourceLanguage: 'ja',
			targetLanguage: targetLang,
			monitor: (m) => {
				m.addEventListener('downloadprogress', (ev) => {
					if (isCurrent()) setStatus('local', { state: 'downloading', downloadProgress: Math.round(ev.loaded * 100) });
				});
			},
		});
		if (isCurrent()) setStatus('local', { state: 'ready', downloadProgress: 100 });
		return translator;
	})();
	localTranslatorInstances.set(targetLang, promise);
	promise.catch(() => localTranslatorInstances.delete(targetLang));
	return promise;
}

async function translateLocal(text: string, targetLang: string): Promise<string> {
	const translator = await getLocalTranslator(targetLang);
	return translator.translate(text);
}

// --- local-wasm: transformers.js + OPUS-MT (完全ローカル、WASM固定) ---
// バンドルサイズ影響を避けるため dynamic import で遅延ロードする。
// 対応言語ペアは ja->en のみ (Xenova/opus-mt-ja-en)。他言語ペアの opus-mt-ja-* は
// 品質・可用性が不安定なため今回は対象外 (TODO: 需要が出たら追加検討)。
const LOCAL_WASM_SUPPORTED_TARGET_LANGS = new Set(['en']);
const LOCAL_WASM_MODEL_ID = 'Xenova/opus-mt-ja-en';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let localWasmPipelinePromise: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getLocalWasmPipeline(): Promise<any> {
	if (localWasmPipelinePromise != null) return localWasmPipelinePromise;
	setStatus('local-wasm', { state: 'downloading', downloadProgress: 0 });
	localWasmPipelinePromise = (async () => {
		// TODO(拡張点): 依存を CDN ではなく pnpm ワークスペース依存として追加している
		// (@huggingface/transformers)。将来的に device: 'webgpu' を試す場合は
		// 契約上 WASM 固定の方針を見直す必要がある (翻訳系はWebGPUで不安定なため)
		const { pipeline } = await import('@huggingface/transformers');
		const translator = await pipeline('translation', LOCAL_WASM_MODEL_ID, {
			device: 'wasm',
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			progress_callback: (progress: any) => {
				if (progress?.status === 'progress' && typeof progress.progress === 'number') {
					setStatus('local-wasm', { state: 'downloading', downloadProgress: Math.round(progress.progress) });
				}
			},
		});
		setStatus('local-wasm', { state: 'ready', downloadProgress: 100 });
		return translator;
	})();
	localWasmPipelinePromise.catch((err) => {
		localWasmPipelinePromise = null;
		setStatus('local-wasm', { state: 'error', errorReason: 'bad-response', lastErrorDetail: String(err) });
	});
	return localWasmPipelinePromise;
}

async function translateLocalWasm(text: string, targetLang: string): Promise<string> {
	if (!LOCAL_WASM_SUPPORTED_TARGET_LANGS.has(targetLang)) {
		setStatus('local-wasm', { state: 'unsupported', errorReason: 'unsupported' });
		throw new Error(`local-wasm engine only supports ja -> en (requested ${targetLang})`);
	}
	const translator = await getLocalWasmPipeline();
	const result = await translator(text);
	const first = Array.isArray(result) ? result[0] : result;
	const out = first?.translation_text ?? first?.generated_text;
	if (typeof out !== 'string') throw new Error('local-wasm translation returned no text');
	return out;
}

// --- google: translate.googleapis.com 直fetch (非公式エンドポイント) ---

async function translateGoogle(text: string, targetLang: string): Promise<string> {
	const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
	let res: Response;
	try {
		res = await window.fetch(url);
	} catch (err) {
		setStatus('google', { state: 'error', errorReason: 'network', lastErrorDetail: String(err) });
		throw err;
	}
	if (res.status === 429) {
		setStatus('google', { state: 'error', errorReason: 'rate-limited' });
		throw new Error('google translate rate limited (429)');
	}
	if (!res.ok) {
		setStatus('google', { state: 'error', errorReason: 'bad-response', lastErrorDetail: `HTTP ${res.status}` });
		throw new Error(`google translate returned ${res.status}`);
	}
	// レスポンス形式: [[[translated, original, null, null, 3], ...], null, "ja", ...]
	// セグメントごとに分割されて返ってくることがあるため、先頭配列を全結合する
	let data: unknown;
	try {
		data = await res.json();
	} catch (err) {
		setStatus('google', { state: 'error', errorReason: 'bad-response', lastErrorDetail: String(err) });
		throw err;
	}
	if (!Array.isArray(data) || !Array.isArray(data[0])) {
		setStatus('google', { state: 'error', errorReason: 'bad-response' });
		throw new Error('unexpected google translate response shape');
	}
	const joined = (data[0] as unknown[])
		.map(seg => (Array.isArray(seg) && typeof seg[0] === 'string') ? seg[0] : '')
		.join('');
	setStatus('google', { state: 'ready', errorReason: null });
	return joined;
}

// --- gas: ユーザー自前デプロイの Google Apps Script WebApp ---
// GAS は preflight (OPTIONS) を返せないため、GET (simple request) のみで叩く。

async function translateGas(text: string, targetLang: string, gasUrl: string | undefined): Promise<string> {
	if (gasUrl == null || gasUrl.trim() === '') {
		setStatus('gas', { state: 'error', errorReason: 'not-configured' });
		throw new Error('GAS WebApp URL is not configured');
	}
	const separator = gasUrl.includes('?') ? '&' : '?';
	const url = `${gasUrl}${separator}text=${encodeURIComponent(text)}&source=ja&target=${encodeURIComponent(targetLang)}`;
	let res: Response;
	try {
		res = await window.fetch(url, { method: 'GET' });
	} catch (err) {
		setStatus('gas', { state: 'error', errorReason: 'network', lastErrorDetail: String(err) });
		throw err;
	}
	if (!res.ok) {
		setStatus('gas', { state: 'error', errorReason: 'bad-response', lastErrorDetail: `HTTP ${res.status}` });
		throw new Error(`gas endpoint returned ${res.status}`);
	}
	let data: { code?: number; text?: string };
	try {
		data = await res.json();
	} catch (err) {
		setStatus('gas', { state: 'error', errorReason: 'bad-response', lastErrorDetail: String(err) });
		throw err;
	}
	if (data.text == null) {
		setStatus('gas', { state: 'error', errorReason: 'bad-response', lastErrorDetail: `code=${data.code}` });
		throw new Error('gas response missing text field');
	}
	setStatus('gas', { state: 'ready', errorReason: null });
	return data.text;
}

// --- deepl: Free/Pro APIキー、ブラウザ直fetch (CORSで拒否される可能性あり) ---

const DEEPL_TARGET_LANG: Record<string, string> = {
	en: 'EN-US',
	ko: 'KO',
	'zh-CN': 'ZH-HANS',
	'zh-TW': 'ZH-HANT',
};

async function translateDeepl(text: string, targetLang: string, apiKey: string | undefined): Promise<string> {
	if (apiKey == null || apiKey.trim() === '') {
		setStatus('deepl', { state: 'error', errorReason: 'not-configured' });
		throw new Error('DeepL API key is not configured');
	}
	// Free プランのキーは `:fx` サフィックスで見分けられる (DeepL公式仕様)
	const isFree = apiKey.trim().endsWith(':fx');
	const base = isFree ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
	const deeplTargetLang = DEEPL_TARGET_LANG[targetLang] ?? targetLang.toUpperCase();
	try {
		const res = await window.fetch(`${base}/v2/translate`, {
			method: 'POST',
			headers: {
				'Authorization': `DeepL-Auth-Key ${apiKey.trim()}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ text: [text], target_lang: deeplTargetLang, source_lang: 'JA' }),
		});
		if (!res.ok) {
			setStatus('deepl', { state: 'error', errorReason: 'bad-response', lastErrorDetail: `HTTP ${res.status}` });
			throw new Error(`deepl returned ${res.status}`);
		}
		const data = await res.json() as { translations?: { text: string }[] };
		const translated = data.translations?.[0]?.text;
		if (translated == null) {
			setStatus('deepl', { state: 'error', errorReason: 'bad-response' });
			throw new Error('deepl response missing translation');
		}
		setStatus('deepl', { state: 'ready', errorReason: null });
		return translated;
	} catch (err) {
		// DeepL はブラウザからの直接リクエストを許可していない仕様のため、実測では
		// TypeError ("Failed to fetch" 等、CORS由来) になる。ここを握りつぶさず
		// 専用エラーとしてUIに伝える (契約: 「使用できません」と明示する)
		if (err instanceof TypeError) {
			setStatus('deepl', { state: 'error', errorReason: 'cors', lastErrorDetail: err.message });
			throw new DeeplCorsError();
		}
		throw err;
	}
}

async function translateWith(engine: LiveSubtitleTranslatorEngine, text: string, options: TranslateOptions): Promise<string> {
	switch (engine) {
		case 'local': return translateLocal(text, options.targetLang);
		case 'local-wasm': return translateLocalWasm(text, options.targetLang);
		case 'google': return translateGoogle(text, options.targetLang);
		case 'gas': return translateGas(text, options.targetLang, options.gasUrl);
		case 'deepl': return translateDeepl(text, options.targetLang, options.deeplApiKey);
	}
}

// --- FIFOキュー・並列1・同一文キャッシュ ---
// 認識結果はTTS/字幕表示のために連投されるため、同じ確定文が短時間に何度も来ても
// 翻訳APIを叩き直さない (キャッシュキーはエンジン+targetLang+原文)

const translationCache = new Map<string, string>();
type QueueTask = { key: string; run: () => Promise<void> };
const translationQueue: QueueTask[] = [];
let queueRunning = false;

async function pumpQueue() {
	if (queueRunning) return;
	queueRunning = true;
	try {
		while (translationQueue.length > 0) {
			const task = translationQueue.shift()!;
			await task.run();
		}
	} finally {
		queueRunning = false;
	}
}

/**
 * 確定文を翻訳キューに積む。並列1・同一文キャッシュ付き。
 * 翻訳失敗時は null を返す (呼び出し側は原文が既に表示済みなのでスキップしてよい)
 */
export function enqueueTranslation(engine: LiveSubtitleTranslatorEngine, text: string, options: TranslateOptions): Promise<string | null> {
	const cacheKey = `${engine}:${options.targetLang}:${text}`;
	const cached = translationCache.get(cacheKey);
	if (cached != null) return Promise.resolve(cached);

	return new Promise((resolve) => {
		translationQueue.push({
			key: cacheKey,
			run: async () => {
				try {
					const translated = await translateWith(engine, text, options);
					translationCache.set(cacheKey, translated);
					if (translationCache.size > 500) {
						const firstKey = translationCache.keys().next().value;
						if (firstKey != null) translationCache.delete(firstKey);
					}
					resolve(translated);
				} catch (err) {
					console.warn(`live subtitle translation failed (${engine}):`, err);
					resolve(null);
				}
			},
		});
		void pumpQueue();
	});
}

export function resetTranslatorStatus(engine: LiveSubtitleTranslatorEngine) {
	Object.assign(translatorStatuses[engine], initialStatus());
}
