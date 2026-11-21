/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ラジオウィジェットの再生 (bsky-fork 独自)。ページを移っても鳴り続けるよう、ウィジェットの外 (このモジュール) に持つ。
//
// 音量の自動調整: 局の音声の先頭数秒を別に取得して無音のままデコードし、BS.1770 の積分ラウドネス (LUFS) を
// 測って、目標との差だけゲインで打ち消す (radio-loudness.ts)。再生中も数分ごとに測り直す。
// 再生中の音声を Web Audio のアナライザーで測る方法は、環境によって 16 dB 小さく測れて大きい局をさらに
// 持ち上げたので使わない (2026-11-21)。
//
// 安全のための約束 (大きな音は耳とスピーカーを傷める):
// - 局を選んだ直後は測り終えるまで小さく鳴らす。下げる変化はすぐ、上げる変化は数秒かけて行う
// - 持ち上げは +12 dB まで。後段のリミッターでピークを -1 dBFS に抑える
// - 音量を測れない経路 (plain) では控えめな音量で鳴らす
//
// 音声の経路は 3 つあり、この順に試す:
// - direct: ブラウザが局から直接受ける (crossOrigin=anonymous)。局が CORS を許可していれば測れる
// - proxy: サーバーが中継する (/radio-garden-stream/)。CORS を許可しない局と http の局はこれで測れる
// - plain: CORS なしで局から直接受ける。サーバーが局につなげなかったときの最後の手段で、音量は測れない
//
// 負荷: 止めている間は AudioContext を止め、音声の接続も切る。測定は数分に 1 回、数秒分の音声を読むだけ。

import { reactive } from 'vue';
import type { RadioChannel } from '@/utility/radio-garden.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { claimAudioFocus, registerAudioFocus, releaseAudioFocus } from '@/utility/audio-focus.js';
import { combineLoudness, correctionDb, dbToGain, integratedLoudness, startGainDb } from '@/utility/radio-loudness.js';
import { channelSubtitle } from '@/utility/radio-garden.js';

export type RadioRoute = 'direct' | 'proxy' | 'plain';
export type RadioStatus = 'idle' | 'connecting' | 'playing' | 'error';

export const RADIO_TARGET_OPTIONS = [-14, -18, -23] as const;
const DEFAULT_TARGET_LUFS = -18;
// 音量を測れない経路 (plain) で鳴らすときの下げ幅
const UNMEASURED_DB = -12;

const VOLUME_KEY = 'mkRadioVolume';
const NORMALIZE_KEY = 'mkRadioNormalize';
const TARGET_KEY = 'mkRadioTargetLufs';
const LOUDNESS_KEY = 'mkRadioLoudness';
const LAST_CHANNEL_KEY = 'mkRadioLastChannel';
const LOUDNESS_MAX_ENTRIES = 300;

// 測定に読む音声の上限 (128 kbps で約 10 秒) と待つ時間の上限
const MEASURE_MAX_BYTES = 160 * 1024;
const MEASURE_MAX_MS = 6000;
// これより短い音声しか読めなかったら、測れなかったものとする
const MEASURE_MIN_SEC = 1.5;
// 2 回目は早めに測って推定を固め、その後は数分ごとに測り直す
const SECOND_MEASURE_MS = 30 * 1000;
const REMEASURE_INTERVAL_MS = 3 * 60 * 1000;
// まとめる測定値の数
const MEASUREMENTS_KEPT = 5;
const MEASURE_RETRY_MS = 15 * 1000;
const CONNECT_TIMEOUT_MS = 15 * 1000;
const STALL_TIMEOUT_MS = 20 * 1000;
const RECONNECT_DELAYS_MS = [1000, 3000, 8000];

function readStorage(key: string): string | null {
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeStorage(key: string, value: string): void {
	try {
		window.localStorage.setItem(key, value);
	} catch {
		// プライベートブラウジングなどで保存できなくても再生は続ける
	}
}

function readNumber(key: string, fallback: number, min: number, max: number): number {
	const raw = readStorage(key);
	const v = raw == null ? NaN : parseFloat(raw);
	return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

function readLastChannel(): RadioChannel | null {
	const raw = readStorage(LAST_CHANNEL_KEY);
	if (raw == null) return null;
	try {
		const v = JSON.parse(raw) as RadioChannel;
		return typeof v.id === 'string' && typeof v.title === 'string' ? v : null;
	} catch {
		return null;
	}
}

export const radioState = reactive({
	channel: readLastChannel(),
	// 前後の局へ切り替えるときに使う一覧 (いま表示している地点の局、検索結果、お気に入りのどれか)
	queue: [] as RadioChannel[],
	status: 'idle' as RadioStatus,
	error: null as string | null,
	route: null as RadioRoute | null,
	volume: readNumber(VOLUME_KEY, 0.8, 0, 1),
	muted: false,
	normalize: readStorage(NORMALIZE_KEY) !== 'false',
	targetLufs: readNumber(TARGET_KEY, DEFAULT_TARGET_LUFS, -30, -6),
	measuredLufs: null as number | null,
	// 'measuring': 測っている、'failed': 測れなかった (控えめに鳴らしている)
	measureState: 'idle' as 'idle' | 'measuring' | 'done' | 'failed',
	gainDb: 0,
});

// ---- 局ごとのラウドネスの記録 ----

type LoudnessEntry = [channelId: string, lufs: number];

function readLoudnessEntries(): LoudnessEntry[] {
	const raw = readStorage(LOUDNESS_KEY);
	if (raw == null) return [];
	try {
		const v = JSON.parse(raw);
		return Array.isArray(v) ? v.filter((entry): entry is LoudnessEntry => Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number') : [];
	} catch {
		return [];
	}
}

function cachedLoudness(channelId: string): number | null {
	return readLoudnessEntries().find(entry => entry[0] === channelId)?.[1] ?? null;
}

function saveLoudness(channelId: string, lufs: number): void {
	const entries = readLoudnessEntries().filter(entry => entry[0] !== channelId);
	entries.unshift([channelId, Math.round(lufs * 10) / 10]);
	writeStorage(LOUDNESS_KEY, JSON.stringify(entries.slice(0, LOUDNESS_MAX_ENTRIES)));
}

// ---- 音声の経路 ----

type Graph = {
	ctx: AudioContext;
	el: HTMLAudioElement;
	norm: GainNode;
	volume: GainNode;
};

let graph: Graph | null = null;
let graphUnavailable = false;
let plainEl: HTMLAudioElement | null = null;
// いま音を出している要素。これ以外の要素からのイベントは無視する
let activeEl: HTMLAudioElement | null = null;
let playSeq = 0;
let reconnectCount = 0;
let reconnectTimer: number | null = null;
let stallTimer: number | null = null;
let measureTimer: number | null = null;
let measureAbort: AbortController | null = null;
let playingSince = 0;
// norm に最後に設定した補正 (dB)。上げるのか下げるのかで変化の速さを変える
let appliedGainDb = 0;
// 局を選んだ直後、測り終えるまでの補正
let pendingGainDb = 0;
// いまの局で測った値 (前回の記録を含む)。radioState.measuredLufs はこれをまとめたもの
let measurements: number[] = [];
let freshMeasurements = 0;
// 局ごとに、前回つながった経路 (CORS を許可しない局で direct を毎回試さないため)
const preferredRoute = new Map<string, RadioRoute>();

function createElement(crossOrigin: boolean): HTMLAudioElement {
	const el = new Audio();
	if (crossOrigin) el.crossOrigin = 'anonymous';
	el.preload = 'none';
	el.addEventListener('error', () => onElementTrouble(el));
	el.addEventListener('ended', () => onElementTrouble(el));
	el.addEventListener('waiting', () => onElementWaiting(el));
	el.addEventListener('stalled', () => onElementWaiting(el));
	el.addEventListener('playing', () => onElementPlaying(el));
	el.addEventListener('pause', () => onElementPaused(el));
	return el;
}

// AudioContext は利用者の操作の中で作らないと止まったままになるので、再生の操作から同期的に呼ぶ
function ensureGraph(): Graph | null {
	if (graph != null || graphUnavailable) return graph;
	try {
		const ctx = new AudioContext({ latencyHint: 'playback' });
		const el = createElement(true);
		const source = ctx.createMediaElementSource(el);
		const norm = ctx.createGain();
		// 持ち上げた局のピークを 0 dBFS の手前で抑える
		const limiter = ctx.createDynamicsCompressor();
		limiter.threshold.value = -1;
		limiter.knee.value = 0;
		limiter.ratio.value = 20;
		limiter.attack.value = 0.003;
		limiter.release.value = 0.25;
		const volume = ctx.createGain();
		source.connect(norm).connect(limiter).connect(volume).connect(ctx.destination);

		graph = { ctx, el, norm, volume };
		applyVolume();
		return graph;
	} catch (err) {
		console.warn('[radio] Web Audio is unavailable', err);
		graphUnavailable = true;
		return null;
	}
}

function ensurePlainEl(): HTMLAudioElement {
	plainEl ??= createElement(false);
	return plainEl;
}

function releaseElement(el: HTMLAudioElement | null): void {
	if (el == null) return;
	if (activeEl === el) activeEl = null;
	el.pause();
	el.removeAttribute('src');
	// src を外しただけでは接続が残るブラウザがあるので、読み直させて切る
	el.load();
}

function releaseAll(): void {
	activeEl = null;
	releaseElement(graph?.el ?? null);
	releaseElement(plainEl);
}

function clearTimers(): void {
	if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
	if (stallTimer != null) window.clearTimeout(stallTimer);
	reconnectTimer = null;
	stallTimer = null;
}

function applyVolume(): void {
	const v = radioState.muted ? 0 : radioState.volume;
	if (graph != null) graph.volume.gain.setTargetAtTime(v, graph.ctx.currentTime, 0.02);
	// plain は音量を測れないので、自動調整が有効なら控えめに鳴らす
	if (plainEl != null) plainEl.volume = v * (radioState.normalize ? dbToGain(UNMEASURED_DB) : 1);
}

// いま掛けるべき補正 (dB)
function desiredGainDb(): number {
	if (!radioState.normalize) return 0;
	if (radioState.route === 'plain') return UNMEASURED_DB;
	return correctionDb(radioState.targetLufs, radioState.measuredLufs) ?? pendingGainDb;
}

// 補正を反映する。下げるときはすぐ、上げるときは数秒かけて変える。immediate は局を切り替えた直後
function applyGain(immediate: boolean): void {
	const db = desiredGainDb();
	radioState.gainDb = db;
	if (graph == null) return;
	const param = graph.norm.gain;
	const now = graph.ctx.currentTime;
	param.cancelScheduledValues(now);
	if (immediate) {
		param.setValueAtTime(dbToGain(db), now);
	} else {
		param.setValueAtTime(param.value, now);
		param.setTargetAtTime(dbToGain(db), now, db < appliedGainDb ? 0.05 : 2);
	}
	appliedGainDb = db;
}

// ---- 音量の測定 ----

function stopMeasuring(): void {
	if (measureTimer != null) window.clearTimeout(measureTimer);
	measureTimer = null;
	measureAbort?.abort();
	measureAbort = null;
}

function scheduleMeasure(channel: RadioChannel, seq: number, delayMs: number): void {
	if (measureTimer != null) window.clearTimeout(measureTimer);
	measureTimer = window.setTimeout(() => {
		measureTimer = null;
		void measureOnce(channel, seq);
	}, delayMs);
}

// 局の音声の先頭を読む。上限のバイト数か時間に達したら打ち切る (接続も切る)
async function readStreamHead(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
	const res = await window.fetch(url, { signal, cache: 'no-store', credentials: 'omit' });
	if (!res.ok || res.body == null) throw new Error(`HTTP ${res.status}`);
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	const timer = window.setTimeout(() => {
		reader.cancel().catch(() => {});
	}, MEASURE_MAX_MS);
	try {
		while (total < MEASURE_MAX_BYTES) {
			const { value, done } = await reader.read();
			if (done) break;
			chunks.push(value);
			total += value.length;
		}
	} finally {
		window.clearTimeout(timer);
		reader.cancel().catch(() => {});
	}
	const data = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		data.set(chunk, offset);
		offset += chunk.length;
	}
	return data.buffer;
}

// 音声をデコードし、K 特性 (高域のシェルフ +4 dB と 38 Hz のハイパス) を通して積分ラウドネスを出す。
// OfflineAudioContext の中だけで処理するので、音は出ない
async function loudnessOf(data: ArrayBuffer): Promise<number | null> {
	const decoder = new OfflineAudioContext(2, 1, 48000);
	const audio = await decoder.decodeAudioData(data);
	if (audio.duration < MEASURE_MIN_SEC) return null;
	const ctx = new OfflineAudioContext(audio.numberOfChannels, audio.length, audio.sampleRate);
	const source = ctx.createBufferSource();
	source.buffer = audio;
	const shelf = ctx.createBiquadFilter();
	shelf.type = 'highshelf';
	shelf.frequency.value = 1681.97;
	shelf.gain.value = 4;
	const highpass = ctx.createBiquadFilter();
	highpass.type = 'highpass';
	highpass.frequency.value = 38.14;
	highpass.Q.value = 0.5;
	source.connect(shelf).connect(highpass).connect(ctx.destination);
	source.start();
	const weighted = await ctx.startRendering();
	const channels = Array.from({ length: weighted.numberOfChannels }, (_, i) => weighted.getChannelData(i));
	// モノラルの局は左右のスピーカーから同じ音が出るので、2 チャンネル分として数える
	if (channels.length === 1) channels.push(channels[0]);
	return integratedLoudness(channels, weighted.sampleRate);
}

async function measureOnce(channel: RadioChannel, seq: number): Promise<void> {
	if (seq !== playSeq || radioState.status !== 'playing' || !radioState.normalize || radioState.route === 'plain') return;
	measureAbort?.abort();
	const controller = new AbortController();
	measureAbort = controller;
	if (radioState.measuredLufs == null) radioState.measureState = 'measuring';
	let lufs: number | null = null;
	try {
		const resolved = await misskeyApi('radio-garden/resolve', { channelId: channel.id });
		if (seq !== playSeq || controller.signal.aborted) return;
		// 再生と同じ経路で読む (direct で鳴っている局は CORS を許可しているので、直接読める)
		const url = radioState.route === 'direct' && resolved.url != null ? resolved.url : resolved.proxyUrl;
		lufs = await loudnessOf(await readStreamHead(url, controller.signal));
	} catch {
		lufs = null;
	} finally {
		if (measureAbort === controller) measureAbort = null;
	}
	if (seq !== playSeq || controller.signal.aborted) return;
	if (lufs == null) {
		// 測れないうちは小さいまま鳴らし、時間を置いて測り直す
		if (radioState.measuredLufs == null) radioState.measureState = 'failed';
		scheduleMeasure(channel, seq, radioState.measuredLufs == null ? MEASURE_RETRY_MS : REMEASURE_INTERVAL_MS);
		return;
	}
	measurements = [...measurements, lufs].slice(-MEASUREMENTS_KEPT);
	freshMeasurements++;
	const combined = combineLoudness(measurements);
	radioState.measuredLufs = combined;
	radioState.measureState = 'done';
	if (combined != null) saveLoudness(channel.id, combined);
	applyGain(false);
	scheduleMeasure(channel, seq, freshMeasurements < 2 ? SECOND_MEASURE_MS : REMEASURE_INTERVAL_MS);
}

// 1 つの経路で再生を試す。音が出たら 'ok'
function tryRoute(el: HTMLAudioElement, src: string): Promise<'ok' | 'failed' | 'notAllowed'> {
	releaseAll();
	activeEl = el;
	el.src = src;
	return new Promise(resolve => {
		let settled = false;
		const finish = (result: 'ok' | 'failed' | 'notAllowed') => {
			if (settled) return;
			settled = true;
			window.clearTimeout(timer);
			el.removeEventListener('playing', onPlaying);
			el.removeEventListener('error', onError);
			resolve(result);
		};
		const onPlaying = () => finish('ok');
		const onError = () => finish('failed');
		const timer = window.setTimeout(() => finish('failed'), CONNECT_TIMEOUT_MS);
		el.addEventListener('playing', onPlaying);
		el.addEventListener('error', onError);
		el.play().catch((err: unknown) => {
			// 自動再生の制限。src の切り替えによる AbortError は error イベントか次の試行で片が付く
			if (err instanceof DOMException && err.name === 'NotAllowedError') finish('notAllowed');
		});
	});
}

async function connect(channel: RadioChannel, seq: number): Promise<void> {
	radioState.status = 'connecting';
	radioState.error = null;

	let resolved: { url: string | null; proxyUrl: string };
	try {
		resolved = await misskeyApi('radio-garden/resolve', { channelId: channel.id });
	} catch {
		if (seq === playSeq) fail(i18n.ts._radio.unavailable);
		return;
	}
	if (seq !== playSeq) return;

	const routes: RadioRoute[] = [];
	if (graph != null) {
		if (resolved.url != null) routes.push('direct');
		routes.push('proxy');
	}
	if (resolved.url != null) routes.push('plain');
	const preferred = preferredRoute.get(channel.id);
	if (preferred != null && routes.includes(preferred)) {
		routes.splice(routes.indexOf(preferred), 1);
		routes.unshift(preferred);
	}

	for (const route of routes) {
		let src: string | null;
		if (route === 'proxy') {
			src = resolved.proxyUrl;
		} else if (route === 'plain' && routes.indexOf('plain') > 0) {
			// 局によっては音声の URL のトークンが数秒で切れるので、引き直す
			try {
				src = (await misskeyApi('radio-garden/resolve', { channelId: channel.id })).url;
			} catch {
				src = null;
			}
			if (seq !== playSeq) return;
		} else {
			src = resolved.url;
		}
		if (src == null) continue;

		const el = route === 'plain' ? ensurePlainEl() : graph?.el;
		if (el == null) continue;
		radioState.route = route;
		applyVolume();
		applyGain(true);
		const result = await tryRoute(el, src);
		if (seq !== playSeq) return;
		if (result === 'ok') {
			preferredRoute.set(channel.id, route);
			radioState.status = 'playing';
			playingSince = Date.now();
			if (route !== 'plain' && radioState.normalize) {
				scheduleMeasure(channel, seq, radioState.measuredLufs == null ? 0 : REMEASURE_INTERVAL_MS);
			}
			updateMediaSession();
			return;
		}
		if (result === 'notAllowed') {
			fail(i18n.ts._radio.pressPlayAgain);
			return;
		}
	}
	fail(i18n.ts._radio.cannotPlay);
}

function fail(message: string): void {
	releaseAll();
	stopMeasuring();
	clearTimers();
	radioState.status = 'error';
	radioState.error = message;
	radioState.route = null;
	updateMediaSession();
}

function scheduleReconnect(): void {
	if (radioState.status !== 'playing' && radioState.status !== 'connecting') return;
	const channel = radioState.channel;
	if (channel == null) return;
	// しばらく安定して鳴っていたら、つなぎ直しの回数を数え直す
	if (playingSince > 0 && Date.now() - playingSince > 60 * 1000) reconnectCount = 0;
	if (reconnectCount >= RECONNECT_DELAYS_MS.length) {
		fail(i18n.ts._radio.cannotPlay);
		return;
	}
	const delay = RECONNECT_DELAYS_MS[reconnectCount++];
	const seq = ++playSeq;
	releaseAll();
	stopMeasuring();
	clearTimers();
	radioState.status = 'connecting';
	reconnectTimer = window.setTimeout(() => {
		reconnectTimer = null;
		if (seq !== playSeq) return;
		void connect(channel, seq);
	}, delay);
}

function onElementTrouble(el: HTMLAudioElement): void {
	if (el !== activeEl || radioState.status !== 'playing') return;
	scheduleReconnect();
}

function onElementWaiting(el: HTMLAudioElement): void {
	if (el !== activeEl || radioState.status !== 'playing' || stallTimer != null) return;
	stallTimer = window.setTimeout(() => {
		stallTimer = null;
		if (el === activeEl && radioState.status === 'playing') scheduleReconnect();
	}, STALL_TIMEOUT_MS);
}

function onElementPlaying(el: HTMLAudioElement): void {
	if (el !== activeEl) return;
	if (stallTimer != null) window.clearTimeout(stallTimer);
	stallTimer = null;
}

// OS やブラウザが止めた (イヤホンを抜いた、など) ときは、こちらも止めた扱いにする
function onElementPaused(el: HTMLAudioElement): void {
	if (el !== activeEl || radioState.status !== 'playing') return;
	stopRadio();
}

// ---- Media Session (ロック画面や OS のメディア操作) ----

function setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null): void {
	try {
		navigator.mediaSession.setActionHandler(action, handler);
	} catch {
		// このブラウザでは使えない操作
	}
}

function updateMediaSession(): void {
	if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
	const channel = radioState.channel;
	if (channel != null && typeof MediaMetadata !== 'undefined') {
		navigator.mediaSession.metadata = new MediaMetadata({
			title: channel.title,
			artist: channelSubtitle(channel),
			album: 'Radio Garden',
		});
	}
	navigator.mediaSession.playbackState = radioState.status === 'playing' ? 'playing' : 'paused';
	setActionHandler('play', () => {
		if (radioState.channel != null) playRadio(radioState.channel);
	});
	setActionHandler('pause', () => stopRadio());
	setActionHandler('stop', () => stopRadio());
	setActionHandler('nexttrack', () => stepRadio(1));
	setActionHandler('previoustrack', () => stepRadio(-1));
	// 生放送なので位置の操作は無い
	setActionHandler('seekto', null);
	setActionHandler('seekbackward', null);
	setActionHandler('seekforward', null);
}

// ---- 操作 ----

export function playRadio(channel: RadioChannel, queue?: RadioChannel[]): void {
	const seq = ++playSeq;
	releaseAll();
	stopMeasuring();
	clearTimers();

	radioState.channel = channel;
	writeStorage(LAST_CHANNEL_KEY, JSON.stringify(channel));
	if (queue != null) radioState.queue = queue.slice(0, 500);
	radioState.status = 'connecting';
	radioState.error = null;
	radioState.route = null;
	reconnectCount = 0;
	playingSince = 0;

	claimAudioFocus('radio');
	const g = ensureGraph();
	g?.ctx.resume().catch(() => {});

	// 測り終えるまでは小さく鳴らす。前回の測定値は、小さくする向きのときだけ使う
	const previous = cachedLoudness(channel.id);
	pendingGainDb = startGainDb(radioState.targetLufs, previous);
	// 前回の記録は、新しく測った値とまとめるときにだけ使う (それだけで持ち上げない)
	measurements = previous != null ? [previous] : [];
	freshMeasurements = 0;
	radioState.measuredLufs = null;
	radioState.measureState = 'idle';
	applyGain(true);
	updateMediaSession();
	void connect(channel, seq);
}

export function stopRadio(): void {
	playSeq++;
	releaseAll();
	stopMeasuring();
	clearTimers();
	radioState.status = 'idle';
	radioState.error = null;
	radioState.route = null;
	if (graph != null && graph.ctx.state === 'running') graph.ctx.suspend().catch(() => {});
	releaseAudioFocus('radio');
	updateMediaSession();
}

export function isRadioActive(): boolean {
	return radioState.status === 'playing' || radioState.status === 'connecting';
}

export function toggleRadio(): void {
	if (isRadioActive()) {
		stopRadio();
	} else if (radioState.channel != null) {
		playRadio(radioState.channel);
	}
}

// 一覧の前後の局へ切り替える。一覧に今の局が無ければ先頭から
export function stepRadio(direction: 1 | -1): void {
	const queue = radioState.queue;
	if (queue.length === 0) return;
	const i = queue.findIndex(c => c.id === radioState.channel?.id);
	const next = i === -1 ? queue[0] : queue[(i + direction + queue.length) % queue.length];
	playRadio(next);
}

export function setRadioVolume(volume: number): void {
	radioState.volume = Math.min(1, Math.max(0, volume));
	if (radioState.volume > 0) radioState.muted = false;
	writeStorage(VOLUME_KEY, String(radioState.volume));
	applyVolume();
}

export function toggleRadioMute(): void {
	radioState.muted = !radioState.muted;
	applyVolume();
}

export function setRadioNormalize(enabled: boolean): void {
	radioState.normalize = enabled;
	writeStorage(NORMALIZE_KEY, String(enabled));
	// 切っても急に大きくならないよう、上げる変化はゆっくり行う
	applyGain(false);
	applyVolume();
	if (!enabled) {
		stopMeasuring();
	} else if (radioState.status === 'playing' && radioState.channel != null && radioState.route !== 'plain') {
		scheduleMeasure(radioState.channel, playSeq, 0);
	}
}

export function setRadioTarget(lufs: number): void {
	radioState.targetLufs = lufs;
	writeStorage(TARGET_KEY, String(lufs));
	applyGain(false);
}

registerAudioFocus('radio', () => stopRadio());
