/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import {
	KWeighting,
	LIMITER_THRESHOLD_DB,
	MAX_GAIN_DB,
	MOMENTARY_CEILING_LU,
	PeakLimiter,
	RadioLeveler,
	SHORT_TERM_CEILING_LU,
	dbToGain,
	kWeightingCoefficients,
	lufsToMeanSquare,
	meanSquareToLufs,
} from '@/utility/radio-loudness.js';

const RATE = 48000;
const TARGET = -18;

function sine(amplitude: number, seconds: number, freq = 997, rate = RATE): Float32Array {
	const out = new Float32Array(Math.round(rate * seconds));
	for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin(2 * Math.PI * freq * i / rate);
	return out;
}

// 再現できる白色雑音 (mulberry32)。局の音声の代わりに使う
function noise(seconds: number, seed: number, rate = RATE): Float32Array {
	const out = new Float32Array(Math.round(rate * seconds));
	let a = seed >>> 0;
	for (let i = 0; i < out.length; i++) {
		a = (a + 0x6D2B79F5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		out[i] = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
	}
	return out;
}

function concat(...parts: Float32Array[]): Float32Array {
	const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}

// 100 ms ごとの K 特性後の平均二乗 (左右の和)。テスト側の基準の測定器
function segmentPower(channels: Float32Array[], rate = RATE): Float64Array {
	const hop = Math.round(rate * 0.1);
	const segments = Math.floor(channels[0].length / hop);
	const power = new Float64Array(segments);
	for (const c of channels) {
		const k = new KWeighting(rate);
		for (let s = 0; s < segments; s++) {
			let sum = 0;
			for (let i = s * hop; i < (s + 1) * hop; i++) {
				const y = k.process(c[i]);
				sum += y * y;
			}
			power[s] += sum / hop;
		}
	}
	return power;
}

// 区間 [from, to) 秒の BS.1770 の積分ラウドネス (絶対ゲートと相対ゲート)
function integrated(channels: Float32Array[], rate = RATE, from = 0, to = Infinity): number {
	const power = segmentPower(channels, rate);
	const start = Math.round(from * 10);
	const end = Math.min(power.length, Math.round(to * 10));
	const blocks: number[] = [];
	for (let s = start; s + 4 <= end; s++) blocks.push((power[s] + power[s + 1] + power[s + 2] + power[s + 3]) / 4);
	const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
	const gated = blocks.filter(p => meanSquareToLufs(p) > -70);
	const gate = meanSquareToLufs(mean(gated)) - 10;
	return meanSquareToLufs(mean(gated.filter(p => meanSquareToLufs(p) > gate)));
}

// 区間 [from, to) 秒にある窓 (windowSec 秒、100 ms ずつずらす) のラウドネスの最大と最小
function windowRange(channels: Float32Array[], windowSec: number, from: number, to: number, rate = RATE): { max: number; min: number } {
	const power = segmentPower(channels, rate);
	const n = Math.round(windowSec * 10);
	let max = -Infinity;
	let min = Infinity;
	for (let s = Math.round(from * 10); s + n <= Math.min(power.length, Math.round(to * 10)); s++) {
		let sum = 0;
		for (let j = 0; j < n; j++) sum += power[s + j];
		const l = meanSquareToLufs(sum / n);
		if (l > max) max = l;
		if (l < min) min = l;
	}
	return { max, min };
}

// 左右に同じ音を入れたときに lufs になるよう音の大きさを変える
function scaleTo(x: Float32Array, lufs: number, rate = RATE): Float32Array {
	const gain = dbToGain(lufs - integrated([x, x], rate));
	return x.map(v => v * gain);
}

function run(leveler: RadioLeveler, l: Float32Array, r: Float32Array = l, block = 128): [Float32Array, Float32Array] {
	const outL = new Float32Array(l.length);
	const outR = new Float32Array(l.length);
	for (let i = 0; i < l.length; i += block) {
		const f = Math.min(block, l.length - i);
		leveler.process([l.subarray(i, i + f), r.subarray(i, i + f)], [outL.subarray(i, i + f), outR.subarray(i, i + f)], f);
	}
	return [outL, outR];
}

function leveler(options: Partial<{ targetLufs: number; enabled: boolean; priorLufs: number | null; sampleRate: number }> = {}): RadioLeveler {
	return new RadioLeveler({ sampleRate: RATE, targetLufs: TARGET, enabled: true, priorLufs: null, ...options });
}

function maxAbs(x: Float32Array): number {
	let m = 0;
	for (const v of x) if (Math.abs(v) > m) m = Math.abs(v);
	return m;
}

describe('K 特性とラウドネスの計算', () => {
	test('LUFS と平均二乗を相互に変換できる', () => {
		for (const lufs of [-40, -23, -18, -14, -6]) {
			expect(meanSquareToLufs(lufsToMeanSquare(lufs))).toBeCloseTo(lufs, 6);
		}
		expect(meanSquareToLufs(0)).toBe(-Infinity);
		expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
	});

	test('48 kHz の係数は BS.1770 の表の値になる', () => {
		const [shelf, highpass] = kWeightingCoefficients(48000);
		expect(shelf.b0).toBeCloseTo(1.53512485958697, 9);
		expect(shelf.b1).toBeCloseTo(-2.69169618940638, 9);
		expect(shelf.b2).toBeCloseTo(1.19839281085285, 9);
		expect(shelf.a1).toBeCloseTo(-1.69065929318241, 9);
		expect(shelf.a2).toBeCloseTo(0.73248077421585, 9);
		expect(highpass.a1).toBeCloseTo(-1.99004745483398, 9);
		expect(highpass.a2).toBeCloseTo(0.99007225036621, 9);
	});

	test('997 Hz の正弦波 (左右) は 0 dBFS で 0 LUFS、-20 dBFS で -20 LUFS (どのサンプルレートでも)', () => {
		for (const rate of [44100, 48000, 96000]) {
			const s = sine(1, 3, 997, rate);
			expect(Math.abs(integrated([s, s], rate))).toBeLessThan(0.1);
			const q = sine(0.1, 3, 997, rate);
			expect(Math.abs(integrated([q, q], rate) + 20)).toBeLessThan(0.1);
		}
	});
});

describe('PeakLimiter', () => {
	test('出す音は閾値を超えず、閾値より十分小さい音は遅れて同じ値で出る', () => {
		const limiter = new PeakLimiter(RATE, LIMITER_THRESHOLD_DB);
		const input = sine(0.3, 2, 440);
		// 1 秒の位置に 0 dBFS を大きく超えるクリックを入れる
		for (let i = 0; i < 50; i++) input[RATE + i] = i % 2 === 0 ? 4 : -4;
		const out = new Float32Array(input.length);
		for (let i = 0; i < input.length; i++) {
			limiter.process(input[i], input[i]);
			out[i] = limiter.outL;
		}
		expect(maxAbs(out)).toBeLessThanOrEqual(dbToGain(LIMITER_THRESHOLD_DB) + 1e-6);
		// クリックから 1 秒近く離れた部分はそのまま
		for (let i = Math.round(RATE * 0.1); i < Math.round(RATE * 0.5); i++) {
			expect(out[i + limiter.latency]).toBeCloseTo(input[i], 6);
		}
		expect(limiter.takeMinGain()).toBeLessThan(0.3);
		expect(limiter.takeMinGain()).toBe(1);
	});
});

describe('RadioLeveler', () => {
	test('音は先読みの分だけ遅れて出て、出始めるまで primed にならない', () => {
		const lv = leveler();
		const x = scaleTo(noise(1, 1), TARGET);
		const [out] = run(lv, x);
		expect(lv.stats().primed).toBe(false);
		expect(maxAbs(out)).toBe(0);
		const [out2] = run(lv, scaleTo(noise(2, 2), TARGET));
		expect(lv.stats().primed).toBe(true);
		const firstAudible = out2.findIndex(v => v !== 0) + x.length;
		expect(firstAudible).toBe(lv.latency);
	});

	test('大きい局 (-5 LUFS) は、鳴り始めの音から目標の大きさで出る', () => {
		const lv = leveler();
		const x = scaleTo(noise(20, 3), -5);
		const out = run(lv, x);
		const start = lv.latency / RATE;
		// 鳴り始めの 1 秒間の窓も目標から 1.5 LU 以内 (大きく鳴ってから下がることがない)
		const head = windowRange(out, 0.4, start, start + 1.4);
		expect(head.max).toBeLessThan(TARGET + 1.5);
		expect(head.min).toBeGreaterThan(TARGET - 1.5);
		expect(Math.abs(integrated(out, RATE, start) - TARGET)).toBeLessThan(1);
		expect(lv.stats().gainDb).toBeCloseTo(TARGET + 5, 0);
	});

	test('小さい局 (-28 LUFS) は、鳴り始めから持ち上げ、数秒で目標にそろう', () => {
		const lv = leveler();
		const x = scaleTo(noise(25, 4), -28);
		const out = run(lv, x);
		const start = lv.latency / RATE;
		const head = windowRange(out, 0.4, start, start + 1.4);
		// 測り始めは持ち上げを少し控えるが、小さすぎない
		expect(head.max).toBeLessThan(TARGET + 1);
		expect(head.min).toBeGreaterThan(TARGET - 3);
		expect(Math.abs(integrated(out, RATE, 15) - TARGET)).toBeLessThan(1);
	});

	test('持ち上げは MAX_GAIN_DB まで', () => {
		const lv = leveler();
		const out = run(lv, scaleTo(noise(20, 5), -45));
		expect(Math.abs(integrated(out, RATE, 12) - (-45 + MAX_GAIN_DB))).toBeLessThan(1);
	});

	test('静かな番組から急に大きくなっても、聞こえる前に下げる。下げ始めるのは直前から', () => {
		const lv = leveler();
		const quiet = scaleTo(noise(20, 6), -30);
		const loud = scaleTo(noise(15, 7), -6);
		const out = run(lv, concat(quiet, loud));
		const jump = 20 + lv.latency / RATE;
		const momentary = windowRange(out, 0.4, 2, 35);
		expect(momentary.max).toBeLessThan(TARGET + MOMENTARY_CEILING_LU + 1.5);
		// 3 秒の窓は、先読み (1.5 秒) より長いので切り替わりの直後は momentary の上限までしか守れない。
		// 落ち着いたあとは short-term の上限を守る
		expect(windowRange(out, 3, 2, 35).max).toBeLessThan(TARGET + MOMENTARY_CEILING_LU);
		expect(windowRange(out, 3, jump + 4, 35).max).toBeLessThan(TARGET + SHORT_TERM_CEILING_LU + 1);
		// 大きくなる 0.6 秒より前は、静かな番組の補正のまま
		const before = windowRange(out, 0.4, jump - 2, jump - 0.6);
		expect(before.min).toBeGreaterThan(TARGET - 1);
		// そのあと、大きい番組も目標に近づく
		expect(Math.abs(integrated(out, RATE, jump + 10, jump + 14) - TARGET)).toBeLessThan(1.5);
	});

	test('大きい番組から静かな番組に替わったら、20 秒ほどで持ち上げる', () => {
		const lv = leveler();
		const loud = scaleTo(noise(20, 8), -8);
		const quiet = scaleTo(noise(40, 9), -26);
		const out = run(lv, concat(loud, quiet));
		const change = 20 + lv.latency / RATE;
		expect(Math.abs(integrated(out, RATE, change + 20, change + 25) - TARGET)).toBeLessThan(2);
		expect(Math.abs(integrated(out, RATE, change + 30, change + 38) - TARGET)).toBeLessThan(1);
	});

	test('無音のあいだは補正を動かさず、無音のあとの大きな音も聞こえる前に下げる', () => {
		const lv = leveler();
		// 補正が落ち着くまで (持ち上げを控える分が無くなるまで) 鳴らしてから無音にする
		const quiet = scaleTo(noise(20, 10), -25);
		const silence = new Float32Array(RATE * 10);
		const loud = scaleTo(noise(10, 11), -5);
		run(lv, quiet);
		const gainBefore = lv.stats().gainDb;
		run(lv, silence);
		expect(Math.abs(lv.stats().gainDb - gainBefore)).toBeLessThan(0.3);
		const out = run(lv, loud);
		expect(windowRange(out, 0.4, 0, 10).max).toBeLessThan(TARGET + MOMENTARY_CEILING_LU + 1.5);
	});

	test('ピークの大きい音を持ち上げても、出す音は -1 dBFS を超えない', () => {
		const lv = leveler();
		const x = scaleTo(noise(15, 12), -35);
		for (let s = 0; s < 15; s++) for (let i = 0; i < 200; i++) x[s * RATE + 5000 + i] = i % 2 === 0 ? 0.9 : -0.9;
		const [outL, outR] = run(lv, x);
		expect(Math.max(maxAbs(outL), maxAbs(outR))).toBeLessThanOrEqual(dbToGain(LIMITER_THRESHOLD_DB) + 1e-6);
	});

	test('オフのときは補正せず、大きさを変えずに出す', () => {
		const lv = leveler({ enabled: false });
		const x = scaleTo(noise(10, 13), -20);
		const out = run(lv, x);
		expect(Math.abs(integrated(out, RATE, lv.latency / RATE) + 20)).toBeLessThan(0.2);
		expect(lv.stats().gainDb).toBe(0);
	});

	test('目標を変えると、下げる向きはすぐ変わる', () => {
		const lv = leveler();
		run(lv, scaleTo(noise(10, 14), -10));
		lv.configure({ targetLufs: -23, enabled: true });
		const out = run(lv, scaleTo(noise(5, 15), -10));
		expect(Math.abs(integrated(out, RATE, 2, 5) + 23)).toBeLessThan(1);
	});

	test('前に測った値は、測った値より大きいときだけ効く', () => {
		const signal = () => scaleTo(noise(2, 16), TARGET);
		const louder = leveler({ priorLufs: -6 });
		run(louder, signal());
		expect(louder.stats().gainDb).toBeLessThan(-4);
		const quieter = leveler({ priorLufs: -40 });
		run(quieter, signal());
		expect(Math.abs(quieter.stats().gainDb)).toBeLessThan(1.5);
		expect(quieter.stats().gainDb).toBeLessThanOrEqual(0.5);
	});

	test('測れていないうちは lufs が null で、測った長さを報告する', () => {
		const lv = leveler();
		run(lv, new Float32Array(RATE * 2));
		expect(lv.stats().lufs).toBeNull();
		run(lv, scaleTo(noise(6, 17), -14));
		const stats = lv.stats();
		expect(stats.lufs).not.toBeNull();
		expect(Math.abs(stats.lufs! + 14)).toBeLessThan(1);
		expect(stats.measuredSec).toBeGreaterThan(5);
	});

	test('44.1 kHz と 96 kHz でも同じようにそろえる', () => {
		for (const rate of [44100, 96000]) {
			const lv = leveler({ sampleRate: rate });
			const out = run(lv, scaleTo(noise(12, 18, rate), -6, rate));
			expect(Math.abs(integrated(out, rate, lv.latency / rate) - TARGET)).toBeLessThan(1);
		}
	});

	test('壊れた値 (NaN、Infinity) が入っても、そのあとの測定と出力は壊れない', () => {
		const lv = leveler();
		const x = scaleTo(noise(8, 19), -10);
		x[RATE] = NaN;
		x[RATE + 1] = Infinity;
		const [outL] = run(lv, x);
		expect(outL.every(v => Number.isFinite(v))).toBe(true);
		const stats = lv.stats();
		expect(Number.isFinite(stats.lufs)).toBe(true);
		expect(Math.abs(stats.lufs! + 10)).toBeLessThan(1);
		expect(Math.abs(integrated([outL, outL], RATE, 4) - TARGET)).toBeLessThan(1);
	});

	test('入力が無い (チャンネル数 0) ときは無音を出す', () => {
		const lv = leveler();
		const out = new Float32Array(128);
		for (let i = 0; i < 100; i++) lv.process([], [out], 128);
		expect(maxAbs(out)).toBe(0);
		expect(lv.stats().primed).toBe(false);
	});
});
