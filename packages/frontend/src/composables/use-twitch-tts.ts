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

const MAX_READ_LENGTH = 150;
const MAX_QUEUE_LENGTH = 10;

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
				case 'url': return '';
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
	// MFM を通らない生テキスト (Twitch 由来) にも URL が混ざるため重ねて除去する
	const readable = plain
		.replace(/https?:\/\/\S+/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MAX_READ_LENGTH);
	return normalizeReadableExpressions(readable);
}

/**
 * ネットスラング的な表現を読み上げ向けの日本語に置換する。
 * - w の連続 (笑い): 全体または末尾にある場合「わらわら」(全角・半角・大小文字不問、文字数不問)。
 *   英単語の一部 (wow 等) を巻き込まないよう、直前が英字の場合は置換しない
 * - 8 の連続 (拍手): 全体・先頭・末尾にある場合「ぱちぱちぱち」(全角・半角、2文字以上)。
 *   数値 (1888 / 8880円 / 88.8 等) を巻き込まないよう、隣接して数字や小数点がある場合は置換しない
 */
function normalizeReadableExpressions(text: string): string {
	return text
		.replace(/(?<![A-Za-zＡ-Ｚａ-ｚ])[wWｗＷ]+$/u, 'わらわら')
		.replace(/^[8８]{2,}(?![0-9０-９.．,，])/u, 'ぱちぱちぱち')
		.replace(/(?<![0-9０-９.．,，])[8８]{2,}$/u, 'ぱちぱちぱち');
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
// 進行中の合成リクエストを中断するための AbortController。
// stopTtsSpeech() で abort することで、AivisSpeech Engine 側の
// ONNX Runtime 推論プロセスの蓄積を防ぐ (ページ離脱後もリクエストが
// 残り続けてエンジン側のリソースが解放されない問題の対策)
let currentAbortController: AbortController | null = null;

export function enqueueTtsSpeech(text: string) {
	const readable = toReadableText(text);
	if (readable.length === 0) return;
	queue.push(readable);
	if (queue.length > MAX_QUEUE_LENGTH) queue.splice(0, queue.length - MAX_QUEUE_LENGTH);
	if (processing == null) {
		processing = processQueue().finally(() => {
			processing = null;
		});
	}
}

export function stopTtsSpeech() {
	// キューを空にして現在の合成・再生を中断する。processing はここでは触らない:
	// 走行中のループはキューが空になったのを確認して自然終了する (それまで新しい
	// ループは起動しないため、読み上げの二重再生は起こらない)
	queue.length = 0;
	if (currentAudio != null) {
		currentAudio.pause();
		currentAudio = null;
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
		const text = queue.shift()!;
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
				// 万一前の音声が残っていても重ねない (キュー直列化に対する最後の防波堤)
				if (currentAudio != null) currentAudio.pause();
				const audio = new window.Audio(url);
				currentAudio = audio;
				audio.onended = () => resolve();
				audio.onerror = () => reject(new Error('audio playback failed'));
				// stopTtsSpeech() で pause された場合も次へ進む
				audio.onpause = () => resolve();
				audio.play().catch(reject);
			});
		} finally {
			currentAudio = null;
			URL.revokeObjectURL(url);
		}
	} finally {
		if (currentAbortController === ac) currentAbortController = null;
	}
}
