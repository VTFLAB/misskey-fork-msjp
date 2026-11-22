/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ラジオウィジェットの再生 (bsky-fork 独自)。ページを移っても鳴り続けるよう、ウィジェットの外 (このモジュール) に持つ。
//
// 音量の自動調整: 鳴らす音声を AudioWorklet (radio-leveler.worklet.ts、中身は radio-loudness.ts) に通し、
// 鳴らしながら BS.1770 のラウドネスを測って目標にそろえる。音声は 1.5 秒遅らせて出すので、補正は聞こえる前の
// 音で決まる。鳴り始めからそろった音量で出し、急に大きくなる部分も聞こえる前に下げる。ピークは -1 dBFS に抑える。
// 2026-11-21 の版は、局の音声の先頭数秒を別に取得してデコードして測っていた。補正が届くまで数秒かかり、
// 先頭の数秒が局の普段の大きさと違うと外れたので、2026-11-22 にこの方式へ変えた。
// その前に試した AnalyserNode での測定は、ある環境で 16 dB 小さく測れた (原因は未特定)。いまの方式は
// 出す音そのものを測って補正するので、測った音と聞こえる音が食い違うことはない。
//
// 安全のための約束 (大きな音は耳とスピーカーを傷める):
// - 測らずに音を出さない。AudioWorklet の読み込みが終わるまでは、音声をどこにもつながない
// - 持ち上げは +12 dB まで。下げる変化は速く、上げる変化はゆっくり行う
// - AudioWorklet が使えないときと、音量を測れない経路 (plain) では、控えめな音量で鳴らす
//
// 音声の経路は 3 つあり、この順に試す:
// - direct: ブラウザが局から直接受ける (crossOrigin=anonymous)。局が CORS を許可していれば測れる
// - proxy: サーバーが中継する (/radio-garden-stream/)。CORS を許可しない局と http の局はこれで測れる
// - plain: CORS なしで局から直接受ける。サーバーが局につなげなかったときの最後の手段で、音量は測れない
//
// 負荷: 止めている間は AudioContext を止め、音声の接続も切る。測定は鳴らしている音声にかける計算だけで、
// 局への接続は増やさない。

import { reactive } from 'vue';
import levelerWorkletUrl from '@/utility/radio-leveler.worklet?worker&url';
import type { RadioChannel } from '@/utility/radio-garden.js';
import type { LevelerMessage, LevelerProcessorOptions, LevelerStats } from '@/utility/radio-loudness.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { claimAudioFocus, registerAudioFocus, releaseAudioFocus } from '@/utility/audio-focus.js';
import { LEVELER_PROCESSOR_NAME, LIMITER_THRESHOLD_DB, dbToGain } from '@/utility/radio-loudness.js';
import { channelSubtitle } from '@/utility/radio-garden.js';

export type RadioRoute = 'direct' | 'proxy' | 'plain';
export type RadioStatus = 'idle' | 'connecting' | 'playing' | 'error';

export const RADIO_TARGET_OPTIONS = [-14, -18, -23] as const;
const DEFAULT_TARGET_LUFS = -18;
// 音量を測れない経路 (plain) と、AudioWorklet が使えないときの下げ幅
const UNMEASURED_DB = -12;

// 初期音量を 80% から 30% に下げたとき (2026-11-21) に、保存済みの音量も一度だけ初期値に戻すためキーを変えた
const VOLUME_KEY = 'mkRadioVolume2';
// 初めて聴く人がいきなり大きな音を聞かないよう、初期音量は控えめにする
const DEFAULT_VOLUME = 0.3;
const NORMALIZE_KEY = 'mkRadioNormalize';
const TARGET_KEY = 'mkRadioTargetLufs';
const LOUDNESS_KEY = 'mkRadioLoudness';
const LAST_CHANNEL_KEY = 'mkRadioLastChannel';
const LOUDNESS_MAX_ENTRIES = 300;

// 音量をそろえる処理 (AudioWorklet) の読み込みを待つ上限。過ぎたら測らずに控えめな音量で鳴らす
const LEVELER_LOAD_TIMEOUT_MS = 5 * 1000;
// 局ごとの大きさを記録するのは、これだけ測れてから。記録はこの間隔より頻繁にしない
const SAVE_MIN_MEASURED_SEC = 5;
const SAVE_INTERVAL_MS = 20 * 1000;
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
	volume: readNumber(VOLUME_KEY, DEFAULT_VOLUME, 0, 1),
	muted: false,
	normalize: readStorage(NORMALIZE_KEY) !== 'false',
	targetLufs: readNumber(TARGET_KEY, DEFAULT_TARGET_LUFS, -30, -6),
	measuredLufs: null as number | null,
	// 'measuring': 測っている (音が出るまで、または測れる大きさの音がまだ来ていない)、
	// 'failed': AudioWorklet が使えず測れない (控えめに鳴らしている)
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
	source: MediaElementAudioSourceNode;
	volume: GainNode;
	// AudioWorklet を読み込めたら true。読み込み終わるまでは source を何にもつながない
	ready: Promise<boolean>;
};

let graph: Graph | null = null;
let graphUnavailable = false;
// いま source の後ろにつないでいる処理。局を鳴らすたび (つなぎ直しも含む) に作り直す
let leveler: AudioWorkletNode | null = null;
// AudioWorklet のノードが作れなかった、または処理中に例外を出した。以後は測らずに鳴らす
let levelerFailed = false;
let fallbackNodes: AudioNode[] = [];
let fallbackGain: GainNode | null = null;
// いまの処理から最後に届いた測定値。つなぎ直すときに引き継ぎ、局を離れるときに記録する
let lastStats: LevelerStats | null = null;
let lastSavedAt = 0;
let plainEl: HTMLAudioElement | null = null;
// いま音を出している要素。これ以外の要素からのイベントは無視する
let activeEl: HTMLAudioElement | null = null;
let playSeq = 0;
let reconnectCount = 0;
let reconnectTimer: number | null = null;
let stallTimer: number | null = null;
let playingSince = 0;
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

async function loadLeveler(ctx: AudioContext): Promise<boolean> {
	try {
		// 安全でない接続 (http) では audioWorklet が無い
		if (!('audioWorklet' in ctx)) return false;
		await ctx.audioWorklet.addModule(levelerWorkletUrl);
		return true;
	} catch (err) {
		console.warn('[radio] the loudness worklet is unavailable', err);
		return false;
	}
}

// AudioContext は利用者の操作の中で作らないと止まったままになるので、再生の操作から同期的に呼ぶ
function ensureGraph(): Graph | null {
	if (graph != null || graphUnavailable) return graph;
	try {
		const ctx = new AudioContext({ latencyHint: 'playback' });
		const el = createElement(true);
		const source = ctx.createMediaElementSource(el);
		const volume = ctx.createGain();
		volume.connect(ctx.destination);
		graph = { ctx, el, source, volume, ready: loadLeveler(ctx) };
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

function postToLeveler(message: LevelerMessage): void {
	leveler?.port.postMessage(message);
}

function waitLeveler(g: Graph): Promise<boolean> {
	return Promise.race([
		g.ready,
		new Promise<boolean>(resolve => window.setTimeout(() => resolve(false), LEVELER_LOAD_TIMEOUT_MS)),
	]);
}

function createLeveler(g: Graph, priorLufs: number | null): AudioWorkletNode | null {
	const processorOptions: LevelerProcessorOptions = {
		targetLufs: radioState.targetLufs,
		enabled: radioState.normalize,
		priorLufs,
	};
	try {
		return new AudioWorkletNode(g.ctx, LEVELER_PROCESSOR_NAME, {
			numberOfInputs: 1,
			numberOfOutputs: 1,
			outputChannelCount: [2],
			// モノラルの局も左右に広げて受ける (左右のスピーカーから鳴る音として測る)
			channelCount: 2,
			channelCountMode: 'explicit',
			channelInterpretation: 'speakers',
			processorOptions,
		});
	} catch (err) {
		console.warn('[radio] cannot create the loudness worklet node', err);
		levelerFailed = true;
		return null;
	}
}

// source の後ろに音量をそろえる処理をつなぐ。available が false (AudioWorklet が使えない) なら、
// 測らずに控えめな音量で鳴らし、ピークだけ抑える
function attachProcessing(g: Graph, available: boolean, priorLufs: number | null): void {
	detachProcessing();
	const node = available && !levelerFailed ? createLeveler(g, priorLufs) : null;
	if (node != null) {
		node.port.onmessage = (ev: MessageEvent<LevelerStats>) => {
			if (node === leveler) onLevelerStats(ev.data);
		};
		// 処理の中で例外が出ると無音になるので、測らない経路に切り替えて鳴らし続ける
		node.onprocessorerror = () => {
			if (node !== leveler) return;
			console.warn('[radio] the loudness worklet stopped with an error');
			levelerFailed = true;
			attachProcessing(g, false, null);
		};
		g.source.connect(node).connect(g.volume);
		leveler = node;
		radioState.measureState = 'measuring';
	} else {
		const gain = g.ctx.createGain();
		// つないだ瞬間から下げた音量で通す
		gain.gain.value = dbToGain(radioState.normalize ? UNMEASURED_DB : 0);
		const limiter = g.ctx.createDynamicsCompressor();
		limiter.threshold.value = LIMITER_THRESHOLD_DB;
		limiter.knee.value = 0;
		limiter.ratio.value = 20;
		limiter.attack.value = 0.003;
		limiter.release.value = 0.25;
		g.source.connect(gain).connect(limiter).connect(g.volume);
		fallbackGain = gain;
		fallbackNodes = [gain, limiter];
		radioState.measureState = 'failed';
		applyFallbackGain(true);
	}
}

function detachProcessing(): void {
	if (leveler != null) {
		postToLeveler({ type: 'dispose' });
		leveler.port.onmessage = null;
		leveler.disconnect();
		leveler = null;
	}
	for (const node of fallbackNodes) node.disconnect();
	fallbackNodes = [];
	fallbackGain = null;
	graph?.source.disconnect();
}

function onLevelerStats(stats: LevelerStats): void {
	lastStats = stats;
	radioState.measuredLufs = stats.lufs;
	radioState.gainDb = stats.gainDb;
	radioState.measureState = stats.primed && stats.lufs != null ? 'done' : 'measuring';
	if (Date.now() - lastSavedAt > SAVE_INTERVAL_MS) saveCurrentLoudness();
}

// いまの局で測った大きさを記録する (次に選んだとき、測った値より大きければ最初から使う)
function saveCurrentLoudness(): void {
	const channel = radioState.channel;
	if (channel == null || lastStats?.lufs == null || lastStats.measuredSec < SAVE_MIN_MEASURED_SEC) return;
	lastSavedAt = Date.now();
	saveLoudness(channel.id, lastStats.lufs);
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

// AudioWorklet が使えないときの固定の補正。切っても急に大きくならないよう、上げる変化はゆっくり行う
function applyFallbackGain(immediate: boolean): void {
	if (graph == null || fallbackGain == null) return;
	const db = radioState.normalize ? UNMEASURED_DB : 0;
	radioState.gainDb = db;
	const param = fallbackGain.gain;
	const now = graph.ctx.currentTime;
	param.cancelScheduledValues(now);
	if (immediate) {
		param.setValueAtTime(dbToGain(db), now);
	} else {
		param.setValueAtTime(param.value, now);
		param.setTargetAtTime(dbToGain(db), now, radioState.normalize ? 0.05 : 2);
	}
}

// 測らない経路 (plain) の補正の表示
function updatePlainGain(): void {
	if (radioState.route === 'plain') radioState.gainDb = radioState.normalize ? UNMEASURED_DB : 0;
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

// priorLufs: 前にこの局で測った大きさ (つなぎ直しでは、直前まで測っていた値)
async function connect(channel: RadioChannel, seq: number, priorLufs: number | null): Promise<void> {
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
	// 音量をそろえる処理の読み込みを待つ (ふつうは局の情報を引いている間に終わっている)
	const levelerAvailable = graph != null ? await waitLeveler(graph) : false;
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
		if (route === 'plain') {
			detachProcessing();
			radioState.measureState = 'idle';
			updatePlainGain();
		} else if (graph != null) {
			attachProcessing(graph, levelerAvailable, priorLufs);
		}
		applyVolume();
		const result = await tryRoute(el, src);
		if (seq !== playSeq) return;
		if (result === 'ok') {
			preferredRoute.set(channel.id, route);
			radioState.status = 'playing';
			playingSince = Date.now();
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
	detachProcessing();
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
	// 直前まで測っていた大きさを引き継ぐ (測った値より大きいときだけ効くので、持ち上げすぎない)
	const prior = lastStats?.lufs ?? cachedLoudness(channel.id);
	releaseAll();
	detachProcessing();
	clearTimers();
	radioState.status = 'connecting';
	reconnectTimer = window.setTimeout(() => {
		reconnectTimer = null;
		if (seq !== playSeq) return;
		void connect(channel, seq, prior);
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
	saveCurrentLoudness();
	releaseAll();
	detachProcessing();
	clearTimers();
	lastStats = null;
	lastSavedAt = Date.now();

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

	radioState.measuredLufs = null;
	radioState.measureState = 'idle';
	radioState.gainDb = 0;
	updateMediaSession();
	void connect(channel, seq, cachedLoudness(channel.id));
}

export function stopRadio(): void {
	playSeq++;
	saveCurrentLoudness();
	releaseAll();
	detachProcessing();
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
	// 切っても急に大きくならないよう、上げる変化はゆっくり行う (AudioWorklet の中も同じ)
	postToLeveler({ type: 'config', config: { targetLufs: radioState.targetLufs, enabled } });
	applyFallbackGain(false);
	updatePlainGain();
	applyVolume();
}

export function setRadioTarget(lufs: number): void {
	radioState.targetLufs = lufs;
	writeStorage(TARGET_KEY, String(lufs));
	postToLeveler({ type: 'config', config: { targetLufs: lufs, enabled: radioState.normalize } });
}

registerAudioFocus('radio', () => stopRadio());
