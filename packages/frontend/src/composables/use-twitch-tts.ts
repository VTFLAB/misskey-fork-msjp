/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ref, watch } from 'vue';
import * as mfm from 'mfm-js';
import { miLocalStorage } from '@/local-storage.js';

// 配信視聴ページのコメント読み上げ (bsky-fork 独自)。
// ブラウザから同一端末 (または LAN 内) の AivisSpeech Engine (VOICEVOX 互換 API) を
// 直接叩いて音声合成する。サーバーは関与しないため、設定は端末ごとに
// miLocalStorage へ保存する。
//
// 前提: エンジン側で CORS を許可しておく必要がある (`--cors_policy_mode all`)。
// https ページから http://127.0.0.1 への fetch は mixed content の例外
// (potentially trustworthy origin) として主要ブラウザで許可されている

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

function load(): TwitchTtsSettings {
	try {
		const raw = miLocalStorage.getItem('twitchTts');
		if (raw == null) return { ...DEFAULT_SETTINGS };
		return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

// モジュールシングルトン: 設定ダイアログとチャットコンポーネントで同じ状態を共有する
export const twitchTtsSettings = ref<TwitchTtsSettings>(load());

watch(twitchTtsSettings, () => {
	miLocalStorage.setItem('twitchTts', JSON.stringify(twitchTtsSettings.value));
}, { deep: true });

// 読み上げを無効化したら再生中の音声とキューを即座に破棄する
// (テスト再生は有効化状態に関わらず動かしたいので、キュー処理側では判定しない)
watch(() => twitchTtsSettings.value.enabled, (enabled) => {
	if (!enabled) stopTtsSpeech();
});

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
 * MFM や URL を読み上げ用の平文に落とす。読めない装飾・URL・絵文字は除去する
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

// 読み上げキュー: 順次 1 件ずつ合成・再生する。詰まり防止のため上限を超えたら
// 古いものから捨てる (ライブ用途なので取りこぼしより遅延の方が害が大きい)
const queue: string[] = [];
// 実行中の処理ループ。boolean フラグではなく Promise 自体を持つことで、ループの
// 生存と1対1で対応させる。旧実装は stopTtsSpeech() がフラグ (playing) を即座に
// false へ戻していたため、走行中のループが await から復帰する前に新しいコメントが
// 2本目のループを起動し、複数コメントがほぼ同時に届いた際に読み上げが二重に
// 再生されるレースがあった (ループ終了時のみ null に戻すことで構造的に排除)
let processing: Promise<void> | null = null;
let currentAudio: HTMLAudioElement | null = null;
// 読み上げ済みコメント ID (二度読み防止)。視聴ページが複数コンポーネントから
// 同じコメントイベントを受けた場合でも 1 回だけ読む
const spokenKeys = new Set<string>();
const spokenKeyOrder: string[] = [];
// タブ間排他 (Web Locks)。視聴ページを複数タブ・ウィンドウで開いた場合、それぞれの
// ページが独立に合成・再生して音声が重なるため、「読み上げオーナー」ロックを
// 最初に取得した 1 ページだけが発話する。オーナーのページを閉じるとロックは自動解放され、
// 次に読み上げようとしたページが新しいオーナーになる
let ownerLockHeld = false;

async function ensureTtsOwnership(): Promise<boolean> {
	if (!('locks' in navigator)) return true; // 非対応環境はページ内直列化のみで動かす
	if (ownerLockHeld) return true;
	return await new Promise<boolean>(resolve => {
		void navigator.locks.request('twitchTtsOwner', { ifAvailable: true }, lock => {
			if (lock == null) {
				resolve(false); // 他のタブがオーナー
				return;
			}
			ownerLockHeld = true;
			resolve(true);
			// ページが閉じられるまでロックを保持し続ける (自動解放に任せる)
			return new Promise<never>(() => {});
		});
	});
}

// 進行中の合成リクエストを中断するための AbortController。
// stopTtsSpeech() で abort することで、AivisSpeech Engine 側の
// ONNX Runtime 推論プロセスの蓄積を防ぐ (ページ離脱後もリクエストが
// 残り続けてエンジン側のリソースが解放されない問題の対策)
let currentAbortController: AbortController | null = null;

/**
 * @param dedupeKey 指定した場合、同じキーでの読み上げは1回に抑止する (コメント ID を渡す)。
 * テスト再生など重複排除が不要な呼び出しでは省略する
 */
export function enqueueTtsSpeech(text: string, dedupeKey?: string) {
	if (dedupeKey != null) {
		if (spokenKeys.has(dedupeKey)) return;
		spokenKeys.add(dedupeKey);
		spokenKeyOrder.push(dedupeKey);
		if (spokenKeyOrder.length > SPOKEN_KEYS_MAX) spokenKeys.delete(spokenKeyOrder.shift()!);
	}
	const readable = toReadableText(text);
	if (readable.length === 0) return;
	queue.push(readable);
	if (queue.length > MAX_QUEUE_LENGTH) queue.splice(0, queue.length - MAX_QUEUE_LENGTH);
	startProcessing();
}

function startProcessing() {
	if (processing != null) return;
	processing = processQueue().finally(() => {
		processing = null;
		// ループ終了と同時に新規エントリが積まれた微小レースの自己回復
		// (積んだ側は processing != null を見て起動をスキップしている可能性がある)
		if (queue.length > 0) startProcessing();
	});
}

export function stopTtsSpeech() {
	// キューを空にして現在の合成・再生を中断する。processing はここでは触らない:
	// 走行中のループはキューが空になったのを確認して自然終了する (それまで新しい
	// ループは起動しないため、読み上げの二重再生は起こらない)
	queue.length = 0;
	if (currentAudio != null) {
		// 再生完了判定 (onpause ハンドラ) が「明示停止」と識別できるよう、
		// currentAudio を外してから pause する (順序が逆だと停止時に完了待ちがハングする)
		const audio = currentAudio;
		currentAudio = null;
		audio.pause();
	}
	// 進行中の AivisSpeech Engine への fetch を中断し、
	// エンジン側の推論プロセスが残続しないようにする
	if (currentAbortController != null) {
		currentAbortController.abort();
		currentAbortController = null;
	}
}

async function processQueue() {
	while (queue.length > 0) {
		// 他のタブが読み上げオーナーの間はこのページでは発話しない (音声の重複防止)。
		// 同じコメントはオーナー側のページにも届いてそちらで読まれる
		if (!await ensureTtsOwnership()) {
			queue.length = 0;
			return;
		}
		// ownership 待ちの await 中に stopTtsSpeech() でキューが空にされている場合がある
		const text = queue.shift();
		if (text == null) return;
		try {
			await synthesizeAndPlay(text);
		} catch (err) {
			// エンジン停止中などの失敗は読み上げをスキップして続行する (配信の妨げにしない)
			console.warn('TTS synthesis failed:', err);
		}
	}
}

async function synthesizeAndPlay(text: string): Promise<void> {
	const settings = twitchTtsSettings.value;
	if (settings.styleId == null) return;
	const base = settings.engineUrl.replace(/\/$/, '');
	const speaker = encodeURIComponent(String(settings.styleId));

	// この1件の合成〜再生サイクルで共有する AbortController。
	// stopTtsSpeech() や次の stopTtsSpeech() 呼出で中断される
	const ac = new AbortController();
	currentAbortController = ac;
	try {
		const queryRes = await window.fetch(`${base}/audio_query?speaker=${speaker}&text=${encodeURIComponent(text)}`, {
			method: 'POST',
			signal: ac.signal,
		});
		if (!queryRes.ok) throw new Error(`/audio_query returned ${queryRes.status}`);
		const audioQuery = await queryRes.json();
		audioQuery.speedScale = settings.speedScale;
		audioQuery.volumeScale = settings.volumeScale;

		const synthRes = await window.fetch(`${base}/synthesis?speaker=${speaker}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(audioQuery),
			signal: ac.signal,
		});
		if (!synthRes.ok) throw new Error(`/synthesis returned ${synthRes.status}`);
		const wav = await synthRes.blob();

		const url = URL.createObjectURL(wav);
		try {
			await new Promise<void>((resolve, reject) => {
				// 万一前の音声が残っていても重ねない (キュー直列化に対する最後の防波堤)。
				// currentAudio を外してから pause する (stopTtsSpeech と同じ明示停止の作法)
				if (currentAudio != null) {
					const prev = currentAudio;
					currentAudio = null;
					prev.pause();
				}
				const audio = new window.Audio(url);
				currentAudio = audio;

				// 完了判定は一度きり (settled) に束ね、イベントの重複・順序ゆれの影響を受けないようにする
				let settled = false;
				let watchdogTimer: number | null = null;
				const settle = (err?: Error) => {
					if (settled) return;
					settled = true;
					if (watchdogTimer != null) window.clearTimeout(watchdogTimer);
					if (err != null) reject(err);
					else resolve();
				};

				audio.onended = () => settle();
				audio.onerror = () => settle(new Error('audio playback failed'));
				// 'pause' は再生完了の証拠にならない (完了前に発火するケースがあり、これを完了扱いに
				// すると音声が鳴っている最中に次の読み上げが始まり二重再生になる)。
				// 「再生し終わった (ended)」または「明示停止 (stopTtsSpeech が currentAudio を
				// 外してから pause する)」の場合のみ先へ進む
				audio.onpause = () => {
					if (audio.ended || currentAudio !== audio) settle();
				};
				// 最終保証のウォッチドッグ: メタデータから実際の音声長を取り、
				// 「音声長 + 3秒」まで ended が来なければ完了扱いにして先へ進む
				// (イベント取り逃しでキューが永久に止まるのを防ぐ。音声長より先に
				// 次へ進むことは無いため、二重再生はこの経路からは起こらない)
				audio.onloadedmetadata = () => {
					if (settled || !Number.isFinite(audio.duration)) return;
					watchdogTimer = window.setTimeout(() => settle(), audio.duration * 1000 + 3000);
				};
				audio.play().catch(err => settle(err instanceof Error ? err : new Error(String(err))));
			});
		} finally {
			currentAudio = null;
			URL.revokeObjectURL(url);
		}
	} finally {
		if (currentAbortController === ac) currentAbortController = null;
	}
}
