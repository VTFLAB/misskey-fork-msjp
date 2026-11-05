/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 端末内翻訳 (bsky-fork 独自)。PLaMo 3 Translate 0.8B (GGUF Q4_K_M) を、wllama (llama.cpp の
// WASM 版、WebGPU backend) でブラウザ内で動かす。
// - npm の wllama はまだ PLaMo 3 の tokenizer (plamo3) に対応していないため、upstream master を
//   build したものを packages/frontend/vendor/wllama/ に同梱している (経緯は同ディレクトリの README.md)。
// - モデルはこのサーバーが /plamo-model/ で配信し (backend の PlamoModelService が取得して持つ)、
//   wllama が OPFS にキャッシュする。利用者のブラウザは Hugging Face へ接続しない。
// - WebGPU で動かせる端末だけで使う。CPU 実行は COOP/COEP 無しだとシングルスレッドになり遅いため、
//   呼び出し側 (note-translator.ts) がブラウザ内蔵の Translator API、サーバーの翻訳の順に切り替える。
// - PLaMo Community License 第4条により、利用箇所に「Built with PLaMo」を表示する。

import { reactive } from 'vue';
import type { Wllama } from '../../vendor/wllama/esm/index.js';
import { miLocalStorage } from '@/local-storage.js';
import { $i } from '@/i.js';

// backend の core/plamo/PlamoModelService.ts の PLAMO_MODEL と同じモデルを指す
const MODEL_REVISION = '03891e907db8a43c97d3a7c75add125cc6d1f96a';
const MODEL_FILE = 'plamo-3-translate-0.8b-Q4_K_M.gguf';
// モデルはこのサーバーが配信する (利用者のブラウザから Hugging Face へは接続しない)
export const PLAMO_MODEL_URL = `${window.location.origin}/plamo-model/${MODEL_REVISION}/${MODEL_FILE}`;
export const PLAMO_MODEL_SIZE_MB = 573;
// PLaMo Community License 第4条 (再配布時にライセンスのコピーを渡す)。このサーバーの静的アセットに置いてある
export const PLAMO_LICENSE_URL = `${window.location.origin}/static-assets/plamo/LICENSE.${(miLocalStorage.getItem('lang') ?? navigator.language).startsWith('ja') ? 'ja' : 'en'}.txt`;

// モデルカードの「対応言語」にある 53 言語の言語コード
const SUPPORTED_LANGS = new Set([
	'ja', 'en', 'zh-hans', 'zh-hant', 'ko', 'ar', 'az', 'be', 'bg', 'bn', 'ca', 'ceb', 'de', 'es', 'et', 'eu', 'fa',
	'fr', 'gu', 'he', 'hi', 'hr', 'hu', 'hy', 'id', 'it', 'jv', 'ka', 'kk', 'km', 'lt', 'lv', 'ml', 'mr', 'ms', 'my',
	'ne', 'nl', 'pa', 'pl', 'ru', 'si', 'sk', 'sl', 'sr', 'sw', 'ta', 'te', 'th', 'tl', 'ur', 'uz', 'vi',
]);

// 学習時の最大長は入出力合計 32,768 tokens。swa_full で全層の KV cache を n_ctx 分持つため 4,096 に抑え、
// 長文は 600 字ごとに行単位で分割する (入力 600 字 + 出力 2,048 tokens が収まり、長文でも最初の訳文が早く出る)。
const N_CTX = 4096;
const CHUNK_CHARS = 600;
const MAX_OUTPUT_TOKENS = 2048;
// 1 回に GPU へ送るトークン数。ブラウザの WebGPU は prefill が遅く、既定 (512) のまま数百トークンを送ると
// 1 回の処理が長くなり、ggml_backend_webgpu_wait_queue で ggml_abort になった (2026-11-05、約 1,000 字の入力)。
const N_BATCH = 64;
const STOP = ['<|plamo:tag|>', '<|plamo:bos|>'];

export type PlamoPhase = 'idle' | 'downloading' | 'loading' | 'ready' | 'failed';

// ノートの翻訳欄にダウンロード・読み込みの進捗を出すための状態 (モデルは端末に 1 つなので全体で共有する)
export const plamoStatus = reactive<{ phase: PlamoPhase; progress: number }>({
	phase: 'idle',
	progress: 0,
});

/**
 * Misskey の言語設定 (ja-JP, zh-TW など) を PLaMo の言語コードに変換する。対応外なら null。
 */
export function toPlamoLang(lang: string): string | null {
	const lower = lang.toLowerCase();
	if (lower.startsWith('zh')) {
		return /^zh-(tw|hk|mo|hant)/.test(lower) ? 'zh-hant' : 'zh-hans';
	}
	const base = lower.split('-')[0];
	const alias: Record<string, string> = { fil: 'tl', iw: 'he', in: 'id' };
	const code = alias[base] ?? base;
	return SUPPORTED_LANGS.has(code) ? code : null;
}

function supportsJspi(): boolean {
	return 'Suspending' in WebAssembly;
}

function supportsMemory64(): boolean {
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		new WebAssembly.Memory({ address: 'i64', initial: BigInt(1) } as any);
		return true;
	} catch {
		return false;
	}
}

/**
 * 同期で判定できる前提条件。メニューに「翻訳」を出すかの判定にも使う。
 * - 同梱の wllama は JSPI と Memory64 を要求する (互換 build は同梱しない)
 * - Firefox は WebGPU が極端に遅く (Llamas on the Web, arXiv 2605.20706)、iOS / iPadOS はタブの
 *   メモリが 500MB 未満でモデルが載らないため対象外
 * - navigator.deviceMemory が分かる端末では 4GB 未満を対象外にする
 */
export function isPlamoEnvironmentSupported(): boolean {
	if (typeof navigator === 'undefined' || !('gpu' in navigator)) return false;
	const ua = navigator.userAgent;
	if (/Firefox\//.test(ua)) return false;
	if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return false;
	if (!supportsJspi() || !supportsMemory64()) return false;
	const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
	if (deviceMemory != null && deviceMemory < 4) return false;
	return true;
}

let adapterCheck: Promise<boolean> | null = null;

const ADAPTER_TIMEOUT_MS = 5000;
// 生成中に次のトークンが来ないまま経過したら、止まったとみなす時間 (長い入力の prefill も含む)
const STALL_TIMEOUT_MS = 60000;

/**
 * WebGPU のアダプターが実際に取れるかを確かめる (navigator.gpu があっても null のことがある)。
 * requestAdapter() が返らない環境でも翻訳全体が止まらないよう、時間を区切る。
 */
export function hasWebGpuAdapter(): Promise<boolean> {
	adapterCheck ??= (async () => {
		try {
			const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
			if (gpu == null) return false;
			const timeout = new Promise<null>(resolve => window.setTimeout(() => resolve(null), ADAPTER_TIMEOUT_MS));
			return (await Promise.race([gpu.requestAdapter(), timeout])) != null;
		} catch {
			return false;
		}
	})();
	return adapterCheck;
}

let wllamaPromise: Promise<Wllama> | null = null;
let loadPromise: Promise<Wllama> | null = null;
// llama.cpp が WebGPU のアダプターを取れずに CPU で動き出したことを示すログ
let webGpuFailed = false;
// WebGPU で動かせなかった、または生成が失敗した端末では、このページでは以後 PLaMo を使わない
let unusable = false;

export function isPlamoUnusable(): boolean {
	return unusable;
}

/**
 * モデルのダウンロードか読み込みを始めている (または読み込み済み) か。
 */
export function isPlamoModelLoading(): boolean {
	return loadPromise != null;
}

function getWllama(): Promise<Wllama> {
	wllamaPromise ??= (async () => {
		const { Wllama } = await import('../../vendor/wllama/esm/index.js');
		const inspect = (...args: unknown[]) => {
			if (args.some(a => typeof a === 'string' && a.includes('ggml_webgpu: Failed'))) webGpuFailed = true;
		};
		const w = new Wllama({
			default: new URL('../../vendor/wllama/esm/wasm/wllama.wasm', import.meta.url).href,
		}, {
			logger: {
				debug: inspect,
				log: inspect,
				warn: (...args: unknown[]) => { inspect(...args); console.warn(...args); },
				error: (...args: unknown[]) => { inspect(...args); console.error(...args); },
			},
		});
		// 互換モードは別の wasm を CDN から取りに行くので使わない (対象外の端末は呼び出し側で除外済み)
		w.setCompat(null);
		return w;
	})();
	return wllamaPromise;
}

async function resetWllama(): Promise<void> {
	const w = wllamaPromise != null ? await wllamaPromise.catch(() => null) : null;
	wllamaPromise = null;
	loadPromise = null;
	if (w != null) await w.exit().catch(() => { /* already stopped */ });
}

// モデルの配信はログイン中のユーザーに限る (backend の PlamoModelServerService)
function authHeaders(): Record<string, string> {
	return $i?.token != null ? { Authorization: `Bearer ${$i.token}` } : {};
}

let modelOnServer = false;

/**
 * サーバーがモデルを配信できる状態か (サーバーが取得を終えるまでは 503 になる)。取れると分かった後は確かめ直さない。
 */
export async function isPlamoModelOnServer(): Promise<boolean> {
	if (modelOnServer) return true;
	try {
		const res = await window.fetch(PLAMO_MODEL_URL, { method: 'HEAD', cache: 'no-store', headers: authHeaders() });
		modelOnServer = res.ok;
	} catch {
		modelOnServer = false;
	}
	return modelOnServer;
}

/**
 * モデルが端末にダウンロード済みか (ダウンロードを終えたものだけ。途中のものは含まない)。
 */
export async function isPlamoModelCached(): Promise<boolean> {
	const w = await getWllama();
	const models = await w.modelManager.getModels();
	return models.some(m => m.url === PLAMO_MODEL_URL);
}

/**
 * モデルのファイルが端末に残っているか (途中で止まったダウンロードも含む)。設定画面の削除ボタン用。
 */
export async function hasPlamoModelFiles(): Promise<boolean> {
	const w = await getWllama();
	const name = await w.cacheManager.getNameFromURL(PLAMO_MODEL_URL);
	return (await w.cacheManager.list()).some(e => e.name === name);
}

function loadModel(): Promise<Wllama> {
	if (loadPromise != null) return loadPromise;
	loadPromise = (async () => {
		const w = await getWllama();
		webGpuFailed = false;
		plamoStatus.phase = 'downloading';
		plamoStatus.progress = 0;
		await w.loadModelFromUrl(PLAMO_MODEL_URL, {
			headers: authHeaders(),
			n_ctx: N_CTX,
			n_batch: N_BATCH,
			n_ubatch: N_BATCH,
			// PLaMo 3 は sliding window attention を使うため、llama-server は長いプロンプトの処理後に途中状態
			// (context checkpoint) を GPU から読み出して保存する。翻訳では使わない読み出しなので、swa_full で
			// KV cache を全長にして保存を作らせない。
			swa_full: true,
			progressCallback: ({ loaded, total }) => {
				plamoStatus.progress = total > 0 ? Math.min(100, Math.floor(loaded / total * 100)) : 0;
				if (total > 0 && loaded >= total) plamoStatus.phase = 'loading';
			},
		});
		if (webGpuFailed) {
			unusable = true;
			throw new Error('llama.cpp could not use WebGPU');
		}
		plamoStatus.phase = 'ready';
		// ストレージが逼迫したときにモデルが消されないよう永続化を求める (拒否されても動作は同じ)
		navigator.storage?.persist?.().catch(() => { /* not granted */ });
		return w;
	})();
	loadPromise.catch(async () => {
		plamoStatus.phase = 'failed';
		await resetWllama();
	});
	return loadPromise;
}

// 投稿に PFML3 の特殊トークンの文字列 (<|plamo:tag|> など。どれも「<|plamo:」で始まる) が含まれていても、
// 制御用として解釈させない。「|」を外した <plamo:tag> の形でモデルに渡し、訳文では元に戻す。
// 2026-11-05 の比較では、先頭の「<」を全角にする方法だとモデルが制御の形を真似て途中で訳を止め、
// 「|」を外す方法では本文を最後まで訳した。
const RESERVED = '<|plamo:';

export function escapePlamoControl(text: string): string {
	let escaped = text.replace(/<\|plamo:([^|<>]*)\|>/g, '<plamo:$1>');
	while (escaped.includes(RESERVED)) escaped = escaped.replaceAll(RESERVED, '<plamo:');
	return escaped;
}

export function restorePlamoControl(text: string): string {
	return text.replace(/<plamo:([^|<>\s]*)>/g, '<|plamo:$1|>');
}

export function buildPlamoPrompt(text: string, targetLang: string): string {
	return '<|plamo:tag|>dataset<|plamo:msg|>translation'
		+ '<|plamo:tag|>input<|plamo:msg|>' + escapePlamoControl(text)
		+ '<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>' + targetLang + '<|plamo:msg|>';
}

export function splitPlamoChunks(text: string): string[] {
	if (text.length <= CHUNK_CHARS) return [text];
	const chunks: string[] = [];
	let current: string | null = null;
	for (const line of text.split('\n')) {
		if (current == null) {
			current = line;
		} else if (current.length + 1 + line.length > CHUNK_CHARS) {
			chunks.push(current);
			current = line;
		} else {
			current = `${current}\n${line}`;
		}
	}
	if (current != null) chunks.push(current);
	return chunks;
}

// chunk の前後の空白・改行はモデルに渡さず、訳文の前後にそのまま付け直す (段落の区切りを保つ)
function splitSurroundingSpace(chunk: string): { lead: string; core: string; trail: string } {
	const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(chunk);
	return m == null ? { lead: '', core: chunk, trail: '' } : { lead: m[1], core: m[2], trail: m[3] };
}

class PlamoStalledError extends Error {
	constructor() {
		super('PLaMo translation stalled');
		this.name = 'PlamoStalledError';
	}
}

// 生成中に llama.cpp が異常終了した (WebGPU の ggml_abort など)。GPU のリセットを伴うことがあり、
// ブラウザはその後しばらく WebGPU を使わせなくなるので、呼び出し側は端末内翻訳をオフにする
class PlamoGpuCrashError extends Error {
	constructor(cause: unknown) {
		super('PLaMo generation crashed', { cause });
		this.name = 'PlamoGpuCrashError';
	}
}

/**
 * 端末内翻訳を続けると同じ失敗を繰り返すおそれがある失敗か (GPU 側の異常終了か停止)。
 */
export function isPlamoCrash(err: unknown): boolean {
	return err instanceof PlamoGpuCrashError || err instanceof PlamoStalledError;
}

export class PlamoModelNotDownloadedError extends Error {
	constructor() {
		super('the PLaMo model is not on this device');
		this.name = 'PlamoModelNotDownloadedError';
	}
}

// wllama は 1 度に 1 件しか生成しないので、翻訳要求とモデルの削除を順番に処理する
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
	const result = queue.then(job, job);
	queue = result.catch(() => { /* the caller handles the error */ });
	return result;
}

async function generate(w: Wllama, text: string, targetLang: string, onDelta: (generated: string) => void): Promise<string> {
	// worker が応答しなくなると wllama は abortSignal を確かめないので、時間切れは Promise.race で判定し、
	// 待ち続けている createCompletion は捨てて worker ごと作り直す
	let timer = 0;
	let rejectStalled: (err: Error) => void = () => { /* set below */ };
	const stalledPromise = new Promise<never>((_, reject) => { rejectStalled = reject; });
	const arm = () => {
		window.clearTimeout(timer);
		timer = window.setTimeout(() => rejectStalled(new PlamoStalledError()), STALL_TIMEOUT_MS);
	};
	let generated = '';
	let finishReason = null as string | null;
	arm();
	const completion = w.createCompletion({
		prompt: buildPlamoPrompt(text, targetLang),
		max_tokens: MAX_OUTPUT_TOKENS,
		temperature: 0,
		stop: STOP,
		stream: true,
		onData: (data) => {
			arm();
			const choice = data.choices[0];
			generated += choice?.text ?? '';
			if (choice?.finish_reason != null) finishReason = choice.finish_reason;
			onDelta(generated);
		},
	});
	completion.catch(() => { /* handled through the race below, or abandoned after a stall */ });
	try {
		await Promise.race([completion, stalledPromise]);
	} catch (err) {
		// llama.cpp が異常終了した (ggml_abort など) 場合や止まった場合、worker は使えないので作り直し、
		// このページでは以後使わない
		unusable = true;
		await resetWllama();
		throw err instanceof PlamoStalledError ? err : new PlamoGpuCrashError(err);
	} finally {
		window.clearTimeout(timer);
	}
	// 長さの上限で打ち切られた訳文は、完成した訳文として出さない
	if (finishReason === 'length') throw new Error('PLaMo translation was cut off at the length limit');
	return generated.trimEnd();
}

/**
 * PLaMo で text を targetLang (toPlamoLang の戻り値) に翻訳する。
 * allowDownload が false のときは、モデルが端末に無ければダウンロードせずに PlamoModelNotDownloadedError を投げる
 * (確認を取った後に設定画面で削除された場合など)。onPartial には生成途中の訳文全体が渡る。
 */
export function translateWithPlamo(text: string, targetLang: string, options: { allowDownload: boolean; onPartial?: (partial: string) => void }): Promise<string> {
	return enqueue(async () => {
		if (unusable) throw new Error('PLaMo is not usable on this device');
		if (loadPromise == null && !options.allowDownload && !(await isPlamoModelCached())) throw new PlamoModelNotDownloadedError();
		const w = await loadModel();
		const done: string[] = [];
		for (const chunk of splitPlamoChunks(text)) {
			const { lead, core, trail } = splitSurroundingSpace(chunk);
			if (core === '') {
				done.push(chunk);
				continue;
			}
			const translated = await generate(w, core, targetLang, (generated) => {
				options.onPartial?.(restorePlamoControl([...done, lead + generated].join('\n')));
			});
			done.push(lead + translated + trail);
		}
		return restorePlamoControl(done.join('\n'));
	});
}

/**
 * ダウンロード済み (途中のものを含む) のモデルを端末から削除する。実行中の翻訳が終わってから消す。
 */
export function deletePlamoModel(): Promise<void> {
	return enqueue(async () => {
		await resetWllama();
		const w = await getWllama();
		await w.cacheManager.delete(PLAMO_MODEL_URL);
		plamoStatus.phase = 'idle';
		plamoStatus.progress = 0;
	});
}
