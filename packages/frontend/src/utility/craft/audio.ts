/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Misskey Craft の効果音。外部ファイルは使わず、発振器とノイズバッファだけで合成する。

import type { SoundId, SoundMaterial } from './types.js';

type Category = 'blocks' | 'players' | 'mobs' | 'ui' | 'ambient';

export type PlayOpts = { x?: number; y?: number; z?: number; volume?: number; pitch?: number; material?: SoundMaterial; mob?: string };

type Voice = { out: GainNode; end: number; vol: number };

/** 1 つの cue を組み立てるときの出力先と共通の音程倍率 */
type Rig = { ctx: AudioContext; dst: AudioNode; pitch: number; white: AudioBuffer; brown: AudioBuffer };

type NoiseOpts = { col?: 'white' | 'brown'; ft: BiquadFilterType; f0: number; f1?: number; q?: number; peak: number; atk?: number };
type ToneOpts = { type: OscillatorType; f0: number; f1?: number; peak: number; atk?: number; vib?: [number, number]; lp?: number };

const MAX_VOICES = 16;
const CAT_OF: Record<SoundId, Category> = {
	step: 'blocks', break: 'blocks', place: 'blocks', hit: 'blocks', fall: 'blocks',
	hurt: 'players', death: 'players', eat: 'players', burp: 'players', drink: 'players',
	attackWeak: 'players', attackStrong: 'players', attackCrit: 'players', attackKnockback: 'players', attackSweep: 'players', attackNoDamage: 'players',
	bowDraw: 'players', bowShoot: 'players', arrowHit: 'players', splash: 'players', swim: 'players', ladder: 'players',
	levelUp: 'ui', xp: 'ui', pickup: 'ui', enchant: 'ui', gachaRoll: 'ui', gachaWin: 'ui', click: 'ui', craft: 'ui', furnace: 'ui', equip: 'ui',
	mobHurt: 'mobs', mobDeath: 'mobs', mobAmbient: 'mobs', creeperFuse: 'mobs', explosion: 'mobs',
	thunder: 'ambient', rain: 'ambient',
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

function makeNoise(ctx: AudioContext, brown: boolean): AudioBuffer {
	const len = ctx.sampleRate;
	const buf = ctx.createBuffer(1, len, ctx.sampleRate);
	const ch = buf.getChannelData(0);
	let last = 0;
	for (let i = 0; i < len; i++) {
		const w = Math.random() * 2 - 1;
		if (brown) {
			last = (last + 0.02 * w) / 1.02;
			ch[i] = last * 3.5;
		} else {
			ch[i] = w;
		}
	}
	return buf;
}

function noise(r: Rig, t: number, dur: number, o: NoiseOpts): void {
	const src = r.ctx.createBufferSource();
	src.buffer = o.col === 'brown' ? r.brown : r.white;
	src.loop = true;
	src.playbackRate.value = r.pitch;
	const f = r.ctx.createBiquadFilter();
	f.type = o.ft;
	f.Q.value = o.q ?? 0.7;
	f.frequency.setValueAtTime(o.f0 * r.pitch, t);
	if (o.f1 != null) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1 * r.pitch), t + dur);
	const g = r.ctx.createGain();
	const atk = Math.min(o.atk ?? 0.004, dur * 0.5);
	g.gain.setValueAtTime(0.0001, t);
	g.gain.linearRampToValueAtTime(o.peak, t + atk);
	g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
	src.connect(f).connect(g).connect(r.dst);
	src.start(t, Math.random() * 0.5);
	src.stop(t + dur + 0.02);
}

function tone(r: Rig, t: number, dur: number, o: ToneOpts): void {
	const osc = r.ctx.createOscillator();
	osc.type = o.type;
	osc.frequency.setValueAtTime(o.f0 * r.pitch, t);
	if (o.f1 != null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1 * r.pitch), t + dur);
	const g = r.ctx.createGain();
	const atk = Math.min(o.atk ?? 0.005, dur * 0.8);
	g.gain.setValueAtTime(0.0001, t);
	g.gain.linearRampToValueAtTime(o.peak, t + atk);
	g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
	let node: AudioNode = osc;
	if (o.lp != null) {
		const f = r.ctx.createBiquadFilter();
		f.type = 'lowpass';
		f.frequency.value = o.lp;
		osc.connect(f);
		node = f;
	}
	node.connect(g).connect(r.dst);
	if (o.vib) {
		const lfo = r.ctx.createOscillator();
		lfo.frequency.value = o.vib[0];
		const lg = r.ctx.createGain();
		lg.gain.value = o.vib[1] * r.pitch;
		lfo.connect(lg).connect(osc.frequency);
		lfo.start(t);
		lfo.stop(t + dur + 0.02);
	}
	osc.start(t);
	osc.stop(t + dur + 0.02);
}

/** ブロック素材ごとの基本音 (volume / pitch は呼び出し側のイベントで掛ける) */
function blockSound(r: Rig, m: SoundMaterial, t: number): void {
	switch (m) {
		case 'stone':
			noise(r, t, 0.12, { ft: 'lowpass', f0: 1400, f1: 500, peak: 0.7 });
			tone(r, t, 0.1, { type: 'sine', f0: 140, f1: 70, peak: 0.5 });
			break;
		case 'wood':
			tone(r, t, 0.11, { type: 'triangle', f0: 240, f1: 150, peak: 0.6 });
			noise(r, t, 0.06, { ft: 'bandpass', f0: 700, q: 1.5, peak: 0.4 });
			break;
		case 'gravel':
			for (let i = 0; i < 4; i++) noise(r, t + i * 0.025, 0.05, { ft: 'bandpass', f0: rnd(1100, 2000), q: 0.8, peak: 0.45 });
			break;
		case 'grass':
			noise(r, t, 0.12, { ft: 'highpass', f0: 2600, peak: 0.4, atk: 0.02 });
			break;
		case 'sand':
			noise(r, t, 0.16, { ft: 'bandpass', f0: 3200, f1: 2400, q: 0.6, peak: 0.35, atk: 0.03 });
			break;
		case 'snow':
			noise(r, t, 0.08, { ft: 'lowpass', f0: 1800, peak: 0.45 });
			noise(r, t + 0.045, 0.08, { ft: 'lowpass', f0: 1400, peak: 0.35 });
			break;
		case 'glass':
			tone(r, t, 0.3, { type: 'sine', f0: 2400, peak: 0.3 });
			tone(r, t, 0.22, { type: 'sine', f0: 3300, peak: 0.2 });
			noise(r, t, 0.06, { ft: 'highpass', f0: 4000, peak: 0.4 });
			break;
		case 'wool':
			noise(r, t, 0.14, { col: 'brown', ft: 'lowpass', f0: 600, peak: 0.9, atk: 0.02 });
			break;
		case 'metal':
			tone(r, t, 0.35, { type: 'square', f0: 820, peak: 0.12 });
			tone(r, t, 0.3, { type: 'sine', f0: 1240, peak: 0.25 });
			noise(r, t, 0.04, { ft: 'highpass', f0: 3000, peak: 0.3 });
			break;
		case 'crop':
			noise(r, t, 0.1, { ft: 'bandpass', f0: 2000, f1: 4500, q: 0.9, peak: 0.4, atk: 0.02 });
			break;
		case 'water':
			for (let i = 0; i < 3; i++) tone(r, t + i * 0.05, 0.1, { type: 'sine', f0: rnd(350, 500), f1: rnd(800, 1200), peak: 0.25 });
			noise(r, t, 0.2, { ft: 'bandpass', f0: 1500, q: 0.7, peak: 0.25, atk: 0.02 });
			break;
		default:
			break;
	}
}

/** mode: 0 = 環境音、1 = 被ダメージ、2 = 死亡 */
function mobSound(r: Rig, mob: string, mode: 0 | 1 | 2, t: number): void {
	const k = mode === 1 ? 0.6 : mode === 2 ? 1.6 : 1;
	r.pitch *= mode === 1 ? 1.25 : mode === 2 ? 0.8 : 1;
	switch (mob) {
		case 'skeleton':
			// 骨の鳴る音。高すぎると耳障りなので中音域の短いクリックにする
			for (let i = 0; i < 4 + mode * 2; i++) noise(r, t + i * 0.05, 0.025, { ft: 'bandpass', f0: rnd(900, 1800), q: 2.5, peak: mode === 0 ? 0.3 : 0.5 });
			break;
		case 'spider':
			noise(r, t, 0.4 * k, { ft: 'bandpass', f0: 1800, q: 0.8, peak: mode === 0 ? 0.2 : 0.35, atk: 0.06 });
			tone(r, t, 0.3 * k, { type: 'sawtooth', f0: 200, f1: 150, peak: 0.1, lp: 900 });
			break;
		case 'creeper':
			noise(r, t, 0.35 * k, { ft: 'highpass', f0: 3500, f1: 2500, peak: 0.5, atk: 0.04 });
			break;
		case 'cow':
			tone(r, t, 0.9 * k, { type: 'sawtooth', f0: 130, f1: 85, peak: 0.45, atk: 0.08, lp: 520, vib: [6, 6] });
			break;
		case 'pig':
			tone(r, t, 0.14 * k, { type: 'sawtooth', f0: 320, f1: 220, peak: 0.4, lp: 1300 });
			tone(r, t + 0.16 * k, 0.16 * k, { type: 'sawtooth', f0: 280, f1: 170, peak: 0.4, lp: 1300 });
			break;
		case 'sheep':
			tone(r, t, 0.6 * k, { type: 'triangle', f0: 380, f1: 330, peak: 0.45, atk: 0.04, vib: [28, 45] });
			break;
		case 'chicken':
			for (let i = 0; i < 3; i++) tone(r, t + i * 0.08, 0.04, { type: 'square', f0: 1900, f1: 1400, peak: 0.2, lp: 3000 });
			break;
		case 'wolf':
			tone(r, t, 0.7 * k, { type: 'sawtooth', f0: 95, f1: 70, peak: 0.4, atk: 0.05, lp: 420, vib: [14, 6] });
			noise(r, t, 0.6 * k, { ft: 'bandpass', f0: 300, q: 1, peak: 0.3, atk: 0.05 });
			break;
		case 'bear':
			tone(r, t, 1.2 * k, { type: 'sawtooth', f0: 75, f1: 48, peak: 0.55, atk: 0.1, lp: 650, vib: [9, 4] });
			noise(r, t, 1.0 * k, { col: 'brown', ft: 'lowpass', f0: 500, peak: 0.6, atk: 0.1 });
			break;
		default: // zombie ほか
			tone(r, t, 0.9 * k, { type: 'sawtooth', f0: 115, f1: 78, peak: 0.45, atk: 0.1, lp: 700, vib: [5, 8] });
			break;
	}
}

function cue(r: Rig, id: SoundId, opts: PlayOpts): void {
	const t = r.ctx.currentTime + 0.005;
	switch (id) {
		case 'step': case 'break': case 'place': case 'hit': case 'fall':
			blockSound(r, opts.material ?? 'stone', t);
			break;
		case 'hurt':
			noise(r, t, 0.18, { ft: 'bandpass', f0: 900, f1: 500, q: 1.2, peak: 0.5 });
			tone(r, t, 0.22, { type: 'sine', f0: 320, f1: 160, peak: 0.5 });
			break;
		case 'death':
			noise(r, t, 0.5, { ft: 'bandpass', f0: 800, f1: 250, q: 1, peak: 0.45 });
			tone(r, t, 0.9, { type: 'sine', f0: 300, f1: 70, peak: 0.5, atk: 0.02 });
			break;
		case 'eat':
			noise(r, t, 0.07, { ft: 'bandpass', f0: 1800, q: 1.2, peak: 0.6 });
			noise(r, t + 0.07, 0.06, { ft: 'bandpass', f0: 1300, q: 1.2, peak: 0.5 });
			break;
		case 'burp':
			tone(r, t, 0.35, { type: 'square', f0: 110, f1: 55, peak: 0.25, lp: 500 });
			break;
		case 'drink':
			for (let i = 0; i < 3; i++) tone(r, t + i * 0.09, 0.07, { type: 'sine', f0: 300 + i * 40, f1: 700 + i * 80, peak: 0.25 });
			break;
		case 'attackWeak':
			noise(r, t, 0.12, { ft: 'bandpass', f0: 1500, f1: 3000, q: 0.8, peak: 0.35, atk: 0.03 });
			break;
		case 'attackStrong':
			noise(r, t, 0.18, { ft: 'bandpass', f0: 1000, f1: 2600, q: 0.8, peak: 0.55, atk: 0.04 });
			tone(r, t + 0.04, 0.1, { type: 'sine', f0: 150, f1: 80, peak: 0.35 });
			break;
		case 'attackCrit':
			noise(r, t, 0.16, { ft: 'bandpass', f0: 1200, f1: 3200, q: 0.8, peak: 0.5, atk: 0.03 });
			tone(r, t + 0.03, 0.25, { type: 'sine', f0: 2200, peak: 0.3 });
			tone(r, t + 0.03, 0.2, { type: 'sine', f0: 3300, peak: 0.15 });
			break;
		case 'attackKnockback':
			noise(r, t, 0.16, { ft: 'bandpass', f0: 900, f1: 2200, q: 0.8, peak: 0.5, atk: 0.03 });
			tone(r, t + 0.03, 0.2, { type: 'sine', f0: 110, f1: 45, peak: 0.7 });
			break;
		case 'attackSweep':
			noise(r, t, 0.32, { ft: 'bandpass', f0: 700, f1: 3500, q: 0.7, peak: 0.45, atk: 0.08 });
			break;
		case 'attackNoDamage':
			noise(r, t, 0.1, { ft: 'bandpass', f0: 2000, f1: 1200, q: 0.8, peak: 0.25, atk: 0.02 });
			break;
		case 'bowDraw':
			tone(r, t, 0.6, { type: 'sawtooth', f0: 90, f1: 260, peak: 0.12, atk: 0.1, lp: 700, vib: [30, 10] });
			noise(r, t, 0.6, { ft: 'bandpass', f0: 600, f1: 1400, q: 2, peak: 0.1, atk: 0.1 });
			break;
		case 'bowShoot':
			noise(r, t, 0.03, { ft: 'highpass', f0: 2500, peak: 0.7 });
			tone(r, t, 0.12, { type: 'triangle', f0: 400, f1: 150, peak: 0.4 });
			noise(r, t + 0.02, 0.22, { ft: 'bandpass', f0: 1200, f1: 3000, q: 0.8, peak: 0.3, atk: 0.04 });
			break;
		case 'arrowHit':
			tone(r, t, 0.1, { type: 'triangle', f0: 200, f1: 100, peak: 0.6 });
			noise(r, t, 0.05, { ft: 'lowpass', f0: 1200, peak: 0.5 });
			break;
		case 'splash':
			noise(r, t, 0.35, { ft: 'bandpass', f0: 1200, f1: 2500, q: 0.6, peak: 0.5, atk: 0.02 });
			for (let i = 0; i < 4; i++) tone(r, t + i * 0.04, 0.08, { type: 'sine', f0: rnd(300, 500), f1: rnd(900, 1400), peak: 0.15 });
			break;
		case 'swim':
			noise(r, t, 0.3, { ft: 'bandpass', f0: 900, f1: 1800, q: 0.6, peak: 0.25, atk: 0.08 });
			break;
		case 'ladder':
			tone(r, t, 0.09, { type: 'triangle', f0: 230, f1: 160, peak: 0.35 });
			noise(r, t, 0.05, { ft: 'bandpass', f0: 700, q: 1.5, peak: 0.2 });
			break;
		case 'levelUp': {
			const n = [523.25, 659.25, 783.99, 1046.5, 1318.5];
			n.forEach((f, i) => tone(r, t + i * 0.09, i === 4 ? 0.5 : 0.18, { type: 'triangle', f0: f, peak: 0.3, atk: 0.008 }));
			break;
		}
		case 'xp':
			tone(r, t, 0.12, { type: 'sine', f0: 1500, f1: 2100, peak: 0.25, atk: 0.003 });
			break;
		case 'pickup':
			tone(r, t, 0.09, { type: 'sine', f0: 500, f1: 1100, peak: 0.35, atk: 0.003 });
			break;
		case 'enchant':
			[523.25, 659.25, 783.99, 987.77].forEach((f, i) => tone(r, t + i * 0.05, 1.2, { type: 'sine', f0: f * (1 + rnd(-0.004, 0.004)), peak: 0.12, atk: 0.35, vib: [5, 3] }));
			noise(r, t, 1.2, { ft: 'highpass', f0: 6000, peak: 0.05, atk: 0.5 });
			break;
		case 'gachaRoll':
			for (let i = 0; i < 16; i++) {
				const f = 900 * Math.pow(2, i / 8);
				tone(r, t + i * 0.075, 0.04, { type: 'square', f0: f, peak: 0.12, atk: 0.002, lp: 4000 });
			}
			break;
		case 'gachaWin': {
			const n = [523.25, 659.25, 783.99, 1046.5];
			n.forEach((f, i) => tone(r, t + i * 0.11, i === 3 ? 0.7 : 0.2, { type: 'triangle', f0: f, peak: 0.32 }));
			[2093, 2637, 3136].forEach((f, i) => tone(r, t + 0.4 + i * 0.07, 0.6, { type: 'sine', f0: f, peak: 0.08, atk: 0.02, vib: [8, 6] }));
			break;
		}
		case 'click':
			noise(r, t, 0.02, { ft: 'bandpass', f0: 2500, q: 1.5, peak: 0.4, atk: 0.001 });
			break;
		case 'craft':
			tone(r, t, 0.1, { type: 'triangle', f0: 260, f1: 170, peak: 0.5 });
			noise(r, t, 0.05, { ft: 'bandpass', f0: 800, q: 1.5, peak: 0.3 });
			break;
		case 'furnace':
			for (let i = 0; i < 6; i++) noise(r, t + rnd(0, 0.5), 0.02, { ft: 'highpass', f0: rnd(2000, 5000), peak: rnd(0.2, 0.5), atk: 0.001 });
			noise(r, t, 0.5, { col: 'brown', ft: 'lowpass', f0: 400, peak: 0.25, atk: 0.1 });
			break;
		case 'equip':
			noise(r, t, 0.15, { ft: 'bandpass', f0: 1600, q: 1, peak: 0.35, atk: 0.02 });
			tone(r, t + 0.04, 0.12, { type: 'sine', f0: 1800, peak: 0.08 });
			break;
		case 'mobHurt': mobSound(r, opts.mob ?? 'zombie', 1, t); break;
		case 'mobDeath': mobSound(r, opts.mob ?? 'zombie', 2, t); break;
		case 'mobAmbient': mobSound(r, opts.mob ?? 'zombie', 0, t); break;
		case 'creeperFuse':
			noise(r, t, 1.5, { ft: 'highpass', f0: 1500, f1: 5500, q: 0.7, peak: 0.45, atk: 0.1 });
			break;
		case 'explosion':
			noise(r, t, 1.2, { col: 'brown', ft: 'lowpass', f0: 3500, f1: 120, peak: 1, atk: 0.005 });
			noise(r, t, 0.5, { ft: 'lowpass', f0: 2500, f1: 300, peak: 0.5, atk: 0.003 });
			tone(r, t, 0.6, { type: 'sine', f0: 80, f1: 30, peak: 0.7 });
			break;
		case 'thunder':
			noise(r, t, 2.5, { col: 'brown', ft: 'lowpass', f0: 2000, f1: 90, peak: 1, atk: 0.05 });
			noise(r, t + 0.6, 1.8, { col: 'brown', ft: 'lowpass', f0: 800, f1: 70, peak: 0.6, atk: 0.1 });
			break;
		case 'rain':
			noise(r, t, 1.0, { ft: 'highpass', f0: 3000, peak: 0.15, atk: 0.3 });
			break;
	}
}

/** 距離の減衰が決まる音量 (volume は 0..1 に丸めて計算し、大きい音ほど遠くまで届く) */
const MAX_DIST = 16;

export class CraftAudio {
	private _volume = 0.6;
	private _muted = false;

	get volume(): number { return this._volume; }
	set volume(v: number) { this._volume = clamp(v, 0, 1); this.applyVolume(); }
	get muted(): boolean { return this._muted; }
	set muted(m: boolean) { this._muted = m; this.applyVolume(); }

	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private cats: Partial<Record<Category, GainNode>> = {};
	private white: AudioBuffer | null = null;
	private brown: AudioBuffer | null = null;
	private voices: Voice[] = [];
	private lx = 0;
	private ly = 0;
	private lz = 0;
	private lyaw = 0;
	private amb: { wind: GainNode; night: GainNode; under: GainNode; nodes: AudioScheduledSourceNode[] } | null = null;
	private ambState = { daylight: 1, underwater: false };

	get unlocked(): boolean {
		return this.ctx != null && this.ctx.state !== 'closed';
	}

	/** ユーザー操作の中で呼ぶ。最初の呼び出しで AudioContext を作る */
	unlock(): void {
		if (!this.ctx) {
			const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
			if (!AC) return;
			const ctx = new AC();
			this.ctx = ctx;
			this.master = ctx.createGain();
			this.master.connect(ctx.destination);
			for (const c of ['blocks', 'players', 'mobs', 'ui', 'ambient'] as Category[]) {
				const g = ctx.createGain();
				g.connect(this.master);
				this.cats[c] = g;
			}
			this.white = makeNoise(ctx, false);
			this.brown = makeNoise(ctx, true);
			this.buildAmbient();
		}
		if (this.ctx.state === 'suspended') void this.ctx.resume();
		this.applyVolume();
		this.setAmbient(this.ambState);
	}

	setListener(x: number, y: number, z: number, yaw: number): void {
		this.lx = x; this.ly = y; this.lz = z; this.lyaw = yaw;
	}

	play(id: SoundId, opts: PlayOpts = {}): void {
		const ctx = this.ctx;
		if (!ctx || !this.master || !this.white || !this.brown || this.muted || this.volume <= 0) return;
		if (ctx.state === 'suspended') void ctx.resume();
		const now = ctx.currentTime;
		let vol = opts.volume ?? 1;
		let pitch = opts.pitch ?? 1;
		if (id === 'step') { vol *= 0.15; pitch *= 1 + rnd(-0.1, 0.1); } else if (id === 'break') { pitch *= 0.8; } else if (id === 'place') { pitch *= 0.8; } else if (id === 'hit') { vol *= 0.25; pitch *= 0.5; } else if (id === 'fall') { vol *= 0.5; pitch *= 0.75; } else if (id === 'xp') { pitch *= rnd(0.8, 1.2); } else if (id === 'pickup') { pitch *= Math.random() * 0.7 + 1; }
		if (CAT_OF[id] === 'blocks' && id !== 'step') pitch *= rnd(0.9, 1.1);
		pitch = clamp(pitch, 0.5, 2);

		let pan = 0;
		if (opts.x != null && opts.y != null && opts.z != null) {
			const dx = opts.x - this.lx, dy = opts.y - this.ly, dz = opts.z - this.lz;
			const dist = Math.hypot(dx, dy, dz);
			const maxD = MAX_DIST * clamp(vol, 0, 1);
			if (dist >= maxD) return;
			vol *= 1 - dist / maxD;
			if (dist > 0.5) {
				// 向き yaw = 0 のとき -z 方向を向く (Minecraft 流)。相対角から左右を決める
				const ang = Math.atan2(-dx, -dz) - this.lyaw;
				pan = clamp(-Math.sin(ang), -1, 1);
			}
		}
		if (vol < 0.005) return;

		this.evict(now);
		const out = ctx.createGain();
		out.gain.value = vol;
		let tail: AudioNode = out;
		if (pan !== 0) {
			const p = ctx.createStereoPanner();
			p.pan.value = pan;
			out.connect(p);
			tail = p;
		}
		tail.connect(this.cats[CAT_OF[id]]!);
		const rig: Rig = { ctx, dst: out, pitch, white: this.white, brown: this.brown };
		cue(rig, id, opts);
		const dur = DURATION[id] ?? 1;
		const voice: Voice = { out, end: now + dur, vol };
		this.voices.push(voice);
		const tid = window.setTimeout(() => this.release(voice), dur * 1000 + 100);
		void tid;
	}

	setAmbient(state: { daylight: number; underwater: boolean }): void {
		this.ambState = { daylight: state.daylight, underwater: state.underwater };
		const ctx = this.ctx;
		const a = this.amb;
		if (!ctx || !a) return;
		const day = clamp(state.daylight, 0, 1);
		const uw = state.underwater ? 1 : 0;
		const t = ctx.currentTime;
		const tc = 0.3; // 約 1 秒でクロスフェード
		a.wind.gain.setTargetAtTime(0.025 * day * (1 - uw), t, tc);
		a.night.gain.setTargetAtTime(0.018 * (1 - day) * (1 - uw), t, tc);
		a.under.gain.setTargetAtTime(0.04 * uw, t, tc);
	}

	dispose(): void {
		for (const v of this.voices) v.out.disconnect();
		this.voices = [];
		if (this.amb) for (const n of this.amb.nodes) { try { n.stop(); } catch { /* 開始前 */ } }
		this.amb = null;
		if (this.ctx) void this.ctx.close();
		this.ctx = null;
		this.master = null;
		this.cats = {};
	}

	private applyVolume(): void {
		if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : clamp(this.volume, 0, 1), this.ctx.currentTime, 0.02);
	}

	private release(v: Voice): void {
		const i = this.voices.indexOf(v);
		if (i >= 0) this.voices.splice(i, 1);
		v.out.disconnect();
	}

	/** 同時発音数が上限に達していたら、終わりに近くて小さい音から切る */
	private evict(now: number): void {
		this.voices = this.voices.filter(v => v.end > now);
		while (this.voices.length >= MAX_VOICES) {
			let worst = 0;
			let score = Infinity;
			this.voices.forEach((v, i) => {
				const s = v.vol * Math.max(0.01, v.end - now);
				if (s < score) { score = s; worst = i; }
			});
			const [v] = this.voices.splice(worst, 1);
			v.out.gain.value = 0;
			v.out.disconnect();
		}
	}

	private buildAmbient(): void {
		const ctx = this.ctx!;
		const dst = this.cats.ambient!;
		const nodes: AudioScheduledSourceNode[] = [];
		const bed = (): GainNode => {
			const g = ctx.createGain();
			g.gain.value = 0;
			g.connect(dst);
			return g;
		};
		const loop = (buf: AudioBuffer, ft: BiquadFilterType, f: number, q: number, out: GainNode) => {
			const s = ctx.createBufferSource();
			s.buffer = buf;
			s.loop = true;
			const flt = ctx.createBiquadFilter();
			flt.type = ft;
			flt.frequency.value = f;
			flt.Q.value = q;
			s.connect(flt).connect(out);
			s.start();
			nodes.push(s);
		};
		const wind = bed();
		loop(this.white!, 'bandpass', 450, 0.5, wind);
		const under = bed();
		loop(this.brown!, 'lowpass', 280, 0.7, under);
		const night = bed();
		for (const f of [55, 82.4]) {
			const o = ctx.createOscillator();
			o.type = 'sine';
			o.frequency.value = f;
			o.connect(night);
			o.start();
			nodes.push(o);
		}
		// 夜の高音 (コオロギ風) は耳障りだったので入れない。夜は低い持続音だけにする
		this.amb = { wind, night, under, nodes };
	}
}

/** 各 cue のおおよその長さ (秒)。同時発音の管理とノード解放に使う */
const DURATION: Partial<Record<SoundId, number>> = {
	step: 0.3, break: 0.5, place: 0.5, hit: 0.3, fall: 0.5,
	hurt: 0.4, death: 1.1, eat: 0.2, burp: 0.5, drink: 0.5,
	attackWeak: 0.3, attackStrong: 0.4, attackCrit: 0.5, attackKnockback: 0.4, attackSweep: 0.5, attackNoDamage: 0.3,
	bowDraw: 0.8, bowShoot: 0.4, arrowHit: 0.3, splash: 0.6, swim: 0.5, ladder: 0.3,
	levelUp: 1.0, xp: 0.3, pickup: 0.3, enchant: 2.0, gachaRoll: 1.4, gachaWin: 1.3, click: 0.1, craft: 0.3, furnace: 1.0, equip: 0.4,
	mobHurt: 1.0, mobDeath: 2.2, mobAmbient: 1.8, creeperFuse: 1.8, explosion: 1.8,
	thunder: 3.2, rain: 1.4,
};
