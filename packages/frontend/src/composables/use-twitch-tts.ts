/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ref, watch } from 'vue';
import * as mfm from 'mfm-js';
import type { Ref } from 'vue';
import { miLocalStorage } from '@/local-storage.js';

// 配信視聴ページのコメント読み上げ (bsky-fork 独自)。
// ブラウザから同一端末 (または LAN 内) の AivisSpeech Engine (VOICEVOX 互換 API) を
// 直接叩いて音声合成する。サーバーは関与しないため、設定は端末ごとに
// miLocalStorage へ保存する。
//
// 前提: エンジン側で CORS を許可しておく必要がある (`--cors_policy_mode all`)。
// https ページから http://127.0.0.1 への fetch は mixed content の例外
// (potentially trustworthy origin) として主要ブラウザで許可されている
//
// ## 再生パイプラインの設計 (v6)
//
// 要求仕様「読み上げ音声は常に1つ。前の読み上げが完了してから次を読む」を
// 多層の防御ではなく構造そのもので保証する。
//
// 1. 実行時状態は globalThis 上の単一オブジェクト (state) に置く。ビルドの
//    チャンク分割で本モジュールの複製が同一ページに複数ロードされても (v4 で
//    実際に4複製を確認)、全複製が同じキュー・再生器・設定を共有する。
// 2. キューを消費するのは単一の processQueue ループだけ (state.processing で排他)。
//    1件ずつ 合成 → 再生完了 を await するため、ループ構造自体が直列性を保証する。
//    再生だけを別ロックで囲む多重の排他層 (v4-v5) は撤去した。
// 3. 再生は Web Audio API (AudioContext + AudioBufferSourceNode)。v5 までの
//    HTMLAudioElement は、環境要因 (メディア要素へ介入する拡張機能等) により
//    play() が AbortError ("media was removed from the document") となり1件も
//    再生できない事象が実地で発生した。Web Audio は DOM にメディア要素を作らない
//    ためこの失敗クラスが構造的に存在せず、blob URL の寿命管理も不要で、
//    再生時間はデコード済み PCM (audioBuffer.duration) から確定できる。
// 4. 完了判定は source.onended + 「音声長 + 1秒」タイマーの二重化 (settle は
//    一度きり)。どちらが先でも1回だけ次へ進み、イベント取り逃しでも止まらない。
// 5. タブ間は Web Locks の「読み上げオーナー」ロックで排他する。これは同一
//    ブラウザプロファイル内にしか効かない: OBS の CEF (カスタムブラウザドック /
//    ブラウザソース) や別ブラウザ・別端末で視聴ページを開いて TTS を有効化すると
//    コード側では検知も抑止もできず多重再生になる。読み上げを有効にするのは
//    1箇所だけ、という運用が前提

export type TwitchTtsSettings = {
	enabled: boolean;
	engineUrl: string;
	styleId: number | null;
	speedScale: number;
	volumeScale: number;
};

export type TtsSpeakerStyle = {
	speakerName: string;
	styleName: string;
	styleId: number;
};

const DEFAULT_SETTINGS: TwitchTtsSettings = {
	enabled: false,
	engineUrl: 'http://127.0.0.1:10101',
	styleId: null,
	speedScale: 1.0,
	volumeScale: 1.0,
};

// これを超える長文は打ち切って「以下略」を付けて読む (ライブ用途では1件が長いとキューが詰まるため)
const MAX_READ_LENGTH = 100;
const MAX_QUEUE_LENGTH = 10;
// 読み上げ済みコメント ID の記憶数 (同一コメントの二度読み防止用)
const SPOKEN_KEYS_MAX = 200;
// エンジンへの合成リクエストの上限時間。エンジンのハング等でキューが永久に
// 停止しないようにする (正常時の合成は数秒、初回のモデルロードでも収まる余裕を持たせる)
const SYNTHESIS_TIMEOUT_MS = 30000;
// AudioContext.resume() の待ち時間上限。自動再生ポリシーでブロックされている間、
// resume() は解決しないまま保留され続けるため、race で切り上げて判定する
const RESUME_TIMEOUT_MS = 1000;
// onended を取り逃した場合に完了扱いにするまでの猶予 (音声長に加算)
const PLAYBACK_END_GRACE_MS = 1000;

type TtsEngineState = {
	queue: string[];
	processing: Promise<void> | null;
	audioContext: AudioContext | null;
	currentSource: AudioBufferSourceNode | null;
	currentAbortController: AbortController | null;
	resumeRecoveryArmed: boolean;
	spokenKeys: Set<string>;
	spokenKeyOrder: string[];
	ownerLockHeld: boolean;
	versionLogged: boolean;
};

type TtsGlobal = typeof globalThis & {
	__msjpTwitchTtsState?: TtsEngineState;
	__msjpTwitchTtsSettings?: Ref<TwitchTtsSettings>;
	__msjpTwitchTtsWatched?: boolean;
};

const g = globalThis as TtsGlobal;

function load(): TwitchTtsSettings {
	try {
		const raw = miLocalStorage.getItem('twitchTts');
		if (raw == null) return { ...DEFAULT_SETTINGS };
		return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

// ページ全体のシングルトン: モジュールが複製ロードされても状態は常に1つ
const state: TtsEngineState = g.__msjpTwitchTtsState ??= {
	queue: [],
	processing: null,
	audioContext: null,
	currentSource: null,
	currentAbortController: null,
	resumeRecoveryArmed: false,
	spokenKeys: new Set(),
	spokenKeyOrder: [],
	ownerLockHeld: false,
	versionLogged: false,
};

// 設定 ref も globalThis 経由で共有する (設定ダイアログとチャットが別複製の
// モジュールを掴んでいても、同じ ref を見るようにする)
export const twitchTtsSettings: Ref<TwitchTtsSettings> = g.__msjpTwitchTtsSettings ??= ref<TwitchTtsSettings>(load());

// watcher の登録は複製をまたいで1回だけ (複数登録すると localStorage 書き込みや
// stop が複製の数だけ多重に走る)
if (!g.__msjpTwitchTtsWatched) {
	g.__msjpTwitchTtsWatched = true;

	watch(twitchTtsSettings, () => {
		miLocalStorage.setItem('twitchTts', JSON.stringify(twitchTtsSettings.value));
	}, { deep: true });

	// 読み上げを無効化したら再生中の音声とキューを即座に破棄する
	// (テスト再生は有効化状態に関わらず動かしたいので、キュー処理側では判定しない)
	watch(() => twitchTtsSettings.value.enabled, (enabled) => {
		if (!enabled) stopTtsSpeech();
	});
}

/**
 * エンジンから話者一覧を取得してスタイル単位に平坦化する (設定 UI の選択肢用)
 */
export async function fetchTtsSpeakers(engineUrl: string): Promise<TtsSpeakerStyle[]> {
	const res = await window.fetch(`${engineUrl.replace(/\/$/, '')}/speakers`);
	if (!res.ok) throw new Error(`/speakers returned ${res.status}`);
	const speakers = await res.json() as { name: string; styles: { name: string; id: number }[] }[];
	return speakers.flatMap(speaker => speaker.styles.map(style => ({
		speakerName: speaker.name,
		styleName: style.name,
		styleId: style.id,
	})));
}

/**
 * 日本語 (ひらがな・カタカナ・CJK漢字) を含むかの軽量判定。
 * backend の detect-ja-en.ts と同等の文字レンジ判定で、翻訳読み上げの
 * 「日本語コメントは即読み・非日本語は訳文を待つ」の振り分けに使う
 */
export function containsJapanese(text: string): boolean {
	return /[぀-ゟ゠-ヿ一-鿿]/.test(text);
}

/**
 * MFM や URL を読み上げ用の平文に落とす。読めない装飾・絵文字は除去し、
 * URL は「ユーアールエル省略」に読み替える
 */
export function toReadableText(text: string): string {
	let plain: string;
	try {
		const walk = (node: mfm.MfmNode): string => {
			switch (node.type) {
				case 'text': return node.props.text;
				case 'unicodeEmoji': return '';
				case 'emojiCode': return '';
				case 'mention': return node.props.username;
				case 'hashtag': return node.props.hashtag;
				case 'url': return ' ユーアールエル省略 ';
				case 'link': return node.children.map(walk).join('');
				case 'inlineCode': return node.props.code;
				case 'blockCode': return '';
				case 'search': return node.props.query;
				default: return 'children' in node && node.children != null ? node.children.map(walk).join('') : '';
			}
		};
		plain = mfm.parse(text).map(walk).join('');
	} catch {
		plain = text;
	}
	// MFM を通らない生テキスト (Twitch 由来) にも URL が混ざるため重ねて処理する。
	// URL は文字列をそのまま読むと非常に長く不快なため「ユーアールエル省略」に読み替える
	// (棒読みちゃんの標準辞書「URL省略」に倣う)
	const trimmed = plain
		.replace(/https?:\/\/\S+/g, ' ユーアールエル省略 ')
		.replace(/\s+/g, ' ')
		.trim();
	// 極端な長文は途中で打ち切り、省略したことが分かるように「以下略」を付けて読む
	const truncated = trimmed.length > MAX_READ_LENGTH;
	const readable = normalizeReadableExpressions(trimmed.slice(0, MAX_READ_LENGTH));
	return truncated ? `${readable}、以下略` : readable;
}

// ネットスラングの読み替え辞書 (配信向け読み上げソフトの定番辞書に倣った読み)。
// 英単語の一部 (workshop の gj 部分など) を巻き込まないよう、単語単位で一致した場合のみ置換する
const SLANG_DICTIONARY: [pattern: RegExp, reading: string][] = [
	[/(?<![A-Za-z])kwsk(?![A-Za-z])/gi, 'くわしく'],
	[/(?<![A-Za-z])wktk(?![A-Za-z])/gi, 'わくてか'],
	[/(?<![A-Za-z])ktkr(?![A-Za-z])/gi, 'きたこれ'],
	[/(?<![A-Za-z])gj(?![A-Za-z])/gi, 'ぐっじょぶ'],
	[/(?<![A-Za-z])thx(?![A-Za-z])/gi, 'さんくす'],
	[/(?<![A-Za-z])orz(?![A-Za-z])/gi, 'がっくり'],
	[/うp(?![A-Za-z])/gi, 'あっぷ'],
	[/おk(?![A-Za-z])/gi, 'おっけー'],
	[/^乙$/, 'おつ'],
];

/**
 * ネットスラング的な表現を読み上げ向けの日本語に置換する。
 * 先頭で NFKC 正規化を行い全角英数字を半角へ畳んでから判定する (ｗｗｗ/８８８/ｋｗｓｋ 等の全角表記を吸収)。
 * - w の連続 (笑い): 全体または末尾にある場合「わらわら」(大小文字不問、文字数不問)。
 *   英単語の一部 (wow 等) を巻き込まないよう、直前が英字の場合は置換しない
 * - 8 の連続 (拍手): 全体・先頭・末尾にある場合「ぱちぱちぱち」(2文字以上)。
 *   数値 (1888 / 8880円 / 88.8 等) を巻き込まないよう、隣接して数字や小数点がある場合は置換しない
 * - SLANG_DICTIONARY の定番スラング (kwsk / wktk / gj 等) を単語単位で読み替える
 */
function normalizeReadableExpressions(text: string): string {
	let s = text.normalize('NFKC');
	s = s
		.replace(/(?<![A-Za-z])[wW]+$/, 'わらわら')
		.replace(/^8{2,}(?![0-9.,])/, 'ぱちぱちぱち')
		.replace(/(?<![0-9.,])8{2,}$/, 'ぱちぱちぱち');
	for (const [pattern, reading] of SLANG_DICTIONARY) {
		s = s.replace(pattern, reading);
	}
	return s;
}

/**
 * 読み上げ前に翻訳結果 (commentTranslated) を待つべきコメントかの判定。
 * backend は detectJaEn(text) === 'en' の場合のみ和訳をキューするため、その判定を
 * ミラーする: 日本語を含めば即読み、絵文字ショートコード・Unicode絵文字を除いて
 * ASCII 英字が残らないテキスト (「8888」「www→わらわら」等) は翻訳が来ることが
 * 無いので待たずに即読みする (従来は一律20秒待ってから原文を読んでいた)
 */
export function shouldAwaitTranslationForTts(text: string): boolean {
	const readable = toReadableText(text);
	if (readable.length === 0) return false;
	if (containsJapanese(readable)) return false;
	const stripped = readable
		.replace(/:[a-zA-Z0-9_+-]+:/g, '')
		.replace(/\p{Extended_Pictographic}|[\uFE0F\u200D]/gu, '');
	return /[A-Za-z]/.test(stripped);
}

// タブ間排他 (Web Locks)。視聴ページを複数タブ・ウィンドウで開いた場合、それぞれの
// ページが独立に合成・再生して音声が重なるため、「読み上げオーナー」ロックを
// 最初に取得した 1 ページだけが発話する。オーナーのページを閉じるとロックは自動解放され、
// 次に読み上げようとしたページが新しいオーナーになる
async function ensureTtsOwnership(): Promise<boolean> {
	if (!('locks' in navigator)) return true; // 非対応環境はページ内直列化のみで動かす
	if (state.ownerLockHeld) return true;
	return await new Promise<boolean>(resolve => {
		void navigator.locks.request('twitchTtsOwner', { ifAvailable: true }, lock => {
			if (lock == null) {
				resolve(false); // 他のタブがオーナー
				return;
			}
			state.ownerLockHeld = true;
			resolve(true);
			// ページが閉じられるまでロックを保持し続ける (自動解放に任せる)
			return new Promise<never>(() => {});
		});
	});
}

/**
 * @param dedupeKey 指定した場合、同じキーでの読み上げは1回に抑止する (コメント ID を渡す)。
 * テスト再生など重複排除が不要な呼び出しでは省略する
 */
export function enqueueTtsSpeech(text: string, dedupeKey?: string) {
	if (!state.versionLogged) {
		state.versionLogged = true;
		// 実行中のコード世代の確認用 (SPA はリロードまで旧チャンクを使い続けるため、
		// 読み上げ不具合の切り分けでどの版が動いているかをコンソールで確認できるようにする)
		console.info('[TTS] pipeline v6: Web Audio API playback (single global queue)');
	}
	if (dedupeKey != null) {
		if (state.spokenKeys.has(dedupeKey)) return;
		state.spokenKeys.add(dedupeKey);
		state.spokenKeyOrder.push(dedupeKey);
		if (state.spokenKeyOrder.length > SPOKEN_KEYS_MAX) state.spokenKeys.delete(state.spokenKeyOrder.shift()!);
	}
	const readable = toReadableText(text);
	if (readable.length === 0) return;
	state.queue.push(readable);
	if (state.queue.length > MAX_QUEUE_LENGTH) state.queue.splice(0, state.queue.length - MAX_QUEUE_LENGTH);
	startProcessing();
}

function startProcessing() {
	if (state.processing != null) return;
	state.processing = processQueue().finally(() => {
		state.processing = null;
		// ループ終了と同時に新規エントリが積まれた微小レースの自己回復
		// (積んだ側は processing != null を見て起動をスキップしている可能性がある)
		if (state.queue.length > 0) startProcessing();
	});
}

export function stopTtsSpeech() {
	// キューを空にして現在の合成・再生を中断する。processing はここでは触らない:
	// 走行中のループはキューが空になったのを確認して自然終了する (それまで新しい
	// ループは起動しないため、読み上げの二重再生は起こらない)
	state.queue.length = 0;
	// 進行中の AivisSpeech Engine への fetch を中断し、
	// エンジン側の推論プロセスが残続しないようにする
	if (state.currentAbortController != null) {
		state.currentAbortController.abort();
		state.currentAbortController = null;
	}
	// 再生中の音声を止める。stop() で source.onended が発火し、再生待ちの
	// Promise (playBuffer 内の settle) が解決してループが先へ進む
	if (state.currentSource != null) {
		const source = state.currentSource;
		state.currentSource = null;
		try {
			source.stop();
		} catch {
			// 未 start / 停止済みの InvalidStateError は無視してよい
		}
	}
}

async function processQueue() {
	while (state.queue.length > 0) {
		// 他のタブが読み上げオーナーの間はこのページでは発話しない (音声の重複防止)。
		// 同じコメントはオーナー側のページにも届いてそちらで読まれる
		if (!await ensureTtsOwnership()) {
			state.queue.length = 0;
			return;
		}
		// ownership 待ちの await 中に stopTtsSpeech() でキューが空にされている場合がある
		const text = state.queue.shift();
		if (text == null) return;
		try {
			const played = await synthesizeAndPlay(text);
			if (!played) {
				// AudioContext が自動再生ポリシーでブロックされている。アイテムを
				// キュー先頭へ戻してループを終了し、ユーザー操作 (下の gesture リスナー)
				// または次のコメント到着を契機に再開する
				state.queue.unshift(text);
				return;
			}
		} catch (err) {
			// stopTtsSpeech による中断 (AbortError) は正常系なのでログしない。
			// エンジン停止・合成失敗などはスキップして次のコメントへ進む (配信の妨げにしない)
			if (!(err instanceof Error && err.name === 'AbortError')) {
				console.warn('[TTS] synthesis/playback failed:', err);
			}
		}
	}
}

/**
 * AudioContext を必要になった時点で生成し、running 状態を保証する。
 * 自動再生ポリシーでブロックされている場合は null を返し、次のユーザー操作での
 * 自動復旧を仕掛ける (resume() はブロック中は解決しないため race で切り上げる)
 */
async function ensureAudioContextRunning(): Promise<AudioContext | null> {
	const ctx = state.audioContext ??= new window.AudioContext();
	if (ctx.state !== 'running') {
		await Promise.race([
			ctx.resume().catch(() => undefined),
			new Promise(resolve => window.setTimeout(resolve, RESUME_TIMEOUT_MS)),
		]);
	}
	if (ctx.state !== 'running') {
		armResumeOnUserGesture();
		return null;
	}
	return ctx;
}

// 自動再生ポリシーで AudioContext がブロックされている場合の復旧経路。
// 次のクリック / キー入力 (= user activation) で resume() し、キューに残っている
// 読み上げを再開する。リスナーの多重登録は state のフラグで防ぐ
function armResumeOnUserGesture() {
	if (state.resumeRecoveryArmed) return;
	state.resumeRecoveryArmed = true;
	console.warn('[TTS] 自動再生ポリシーにより音声出力がブロックされています。ページ内を一度クリックすると読み上げを再開します');
	const onGesture = () => {
		window.removeEventListener('pointerdown', onGesture, { capture: true });
		window.removeEventListener('keydown', onGesture, { capture: true });
		state.resumeRecoveryArmed = false;
		const ctx = state.audioContext;
		if (ctx == null) return;
		void ctx.resume().then(() => {
			if (state.queue.length > 0) startProcessing();
		}).catch(() => undefined);
	};
	window.addEventListener('pointerdown', onGesture, { capture: true });
	window.addEventListener('keydown', onGesture, { capture: true });
}

/**
 * 1件を合成して再生し、再生が完了するまで待つ。
 * @returns false = AudioContext がブロックされていて再生に入れなかった (呼び出し側で再試行)
 */
async function synthesizeAndPlay(text: string): Promise<boolean> {
	const settings = twitchTtsSettings.value;
	if (settings.styleId == null) return true; // 話者未設定: 読み捨てる
	const ctx = await ensureAudioContextRunning();
	if (ctx == null) return false;

	const base = settings.engineUrl.replace(/\/$/, '');
	const speaker = encodeURIComponent(String(settings.styleId));

	// stopTtsSpeech() からの中断用。エンジンのハング対策のタイムアウトと併用する
	const ac = new AbortController();
	state.currentAbortController = ac;
	try {
		const signal = AbortSignal.any([ac.signal, AbortSignal.timeout(SYNTHESIS_TIMEOUT_MS)]);
		const queryRes = await window.fetch(`${base}/audio_query?speaker=${speaker}&text=${encodeURIComponent(text)}`, {
			method: 'POST',
			signal,
		});
		if (!queryRes.ok) throw new Error(`/audio_query returned ${queryRes.status}`);
		const audioQuery = await queryRes.json();
		audioQuery.speedScale = settings.speedScale;
		audioQuery.volumeScale = settings.volumeScale;

		const synthRes = await window.fetch(`${base}/synthesis?speaker=${speaker}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(audioQuery),
			signal,
		});
		if (!synthRes.ok) throw new Error(`/synthesis returned ${synthRes.status}`);
		const wavBytes = await synthRes.arrayBuffer();

		// 合成完了と stop の間の隙間: 中断済みなら再生せず完了扱いで抜ける
		if (ac.signal.aborted) return true;
		// resume 判定後にサスペンドへ戻る事は通常無いが、万一の場合は再試行に回す
		if (ctx.state !== 'running') return false;

		// WAV は速度 (speedScale) 適用済みで合成されるため、デコード結果の duration が
		// そのまま実再生時間になる (playbackRate は常に 1)
		const buffer = await ctx.decodeAudioData(wavBytes);
		if (ac.signal.aborted) return true;

		// 検証用ログは既定のコンソールフィルタで見えるよう info で出す
		// (debug はブラウザ既定で非表示のため実地検証時に確認できない)
		console.info(`[TTS] play start (${buffer.duration.toFixed(1)}s, queue=${state.queue.length}): "${text.slice(0, 24)}"`);
		await playBuffer(ctx, buffer);
		console.info(`[TTS] play end: "${text.slice(0, 24)}"`);
		return true;
	} finally {
		if (state.currentAbortController === ac) state.currentAbortController = null;
	}
}

/**
 * デコード済みバッファを1件再生し、再生完了 (onended または音声長+猶予の
 * タイマーの早い方、1回だけ) まで待つ。この Promise は reject しない:
 * どんな経路でも必ず解決してキューを先へ進める
 */
function playBuffer(ctx: AudioContext, buffer: AudioBuffer): Promise<void> {
	return new Promise<void>(resolve => {
		// 単一ループ構造上ここで前の音声が残っていることは無いはず。もし残っていたら
		// 直列化の前提が破れている証拠なので、ログを残した上で止めてから鳴らす
		if (state.currentSource != null) {
			console.warn('[TTS] BUG: previous source still active at play start; force-stopping');
			const prev = state.currentSource;
			state.currentSource = null;
			try {
				prev.stop();
			} catch {
				// 停止済みなら無視
			}
		}

		const source = ctx.createBufferSource();
		source.buffer = buffer;
		source.connect(ctx.destination);
		state.currentSource = source;

		let settled = false;
		let watchdogTimer: number | null = null;
		const settle = () => {
			if (settled) return;
			settled = true;
			if (watchdogTimer != null) window.clearTimeout(watchdogTimer);
			if (state.currentSource === source) state.currentSource = null;
			try {
				source.disconnect();
			} catch {
				// 切断済みなら無視
			}
			resolve();
		};

		// AudioBufferSourceNode の onended は自然終了・stop() のどちらでも発火する。
		// 万一イベントを取り逃してもタイマーが「音声長 + 猶予」で完了扱いにする
		// (音声長より前に次へ進む経路は無いので、この二重化から二重再生は生じない)
		source.onended = () => settle();
		watchdogTimer = window.setTimeout(settle, buffer.duration * 1000 + PLAYBACK_END_GRACE_MS);
		source.start();
	});
}
