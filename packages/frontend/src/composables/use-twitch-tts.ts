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
	return plain
		.replace(/https?:\/\/\S+/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MAX_READ_LENGTH);
}

// 読み上げキュー: 順次 1 件ずつ合成・再生する。詰まり防止のため上限を超えたら
// 古いものから捨てる (ライブ用途なので取りこぼしより遅延の方が害が大きい)
const queue: string[] = [];
let playing = false;
let currentAudio: HTMLAudioElement | null = null;

export function enqueueTtsSpeech(text: string) {
	const readable = toReadableText(text);
	if (readable.length === 0) return;
	queue.push(readable);
	if (queue.length > MAX_QUEUE_LENGTH) queue.splice(0, queue.length - MAX_QUEUE_LENGTH);
	if (!playing) void processQueue();
}

export function stopTtsSpeech() {
	queue.length = 0;
	if (currentAudio != null) {
		currentAudio.pause();
		currentAudio = null;
	}
	playing = false;
}

async function processQueue() {
	playing = true;
	try {
		while (queue.length > 0) {
			const text = queue.shift()!;
			try {
				await synthesizeAndPlay(text);
			} catch (err) {
				// エンジン停止中などの失敗は読み上げをスキップして続行する (配信の妨げにしない)
				console.warn('TTS synthesis failed:', err);
			}
		}
	} finally {
		playing = false;
	}
}

async function synthesizeAndPlay(text: string): Promise<void> {
	const settings = twitchTtsSettings.value;
	if (settings.styleId == null) return;
	const base = settings.engineUrl.replace(/\/$/, '');
	const speaker = encodeURIComponent(String(settings.styleId));

	const queryRes = await window.fetch(`${base}/audio_query?speaker=${speaker}&text=${encodeURIComponent(text)}`, { method: 'POST' });
	if (!queryRes.ok) throw new Error(`/audio_query returned ${queryRes.status}`);
	const audioQuery = await queryRes.json();
	audioQuery.speedScale = settings.speedScale;
	audioQuery.volumeScale = settings.volumeScale;

	const synthRes = await window.fetch(`${base}/synthesis?speaker=${speaker}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(audioQuery),
	});
	if (!synthRes.ok) throw new Error(`/synthesis returned ${synthRes.status}`);
	const wav = await synthRes.blob();

	const url = URL.createObjectURL(wav);
	try {
		await new Promise<void>((resolve, reject) => {
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
}
