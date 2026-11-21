/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { BOOST_MARGIN_DB, MAX_GAIN_DB, MIN_GAIN_DB, SAFE_START_DB, combineLoudness, correctionDb, dbToGain, integratedLoudness, lufsToMeanSquare, meanSquareToLufs, startGainDb } from '@/utility/radio-loudness.js';

const RATE = 48000;

function sine(amplitude: number, seconds: number, freq = 997): Float32Array {
	const out = new Float32Array(Math.round(RATE * seconds));
	for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin(2 * Math.PI * freq * i / RATE);
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

describe('radio-loudness', () => {
	test('LUFS と平均二乗を相互に変換できる', () => {
		for (const lufs of [-40, -23, -18, -14, -6]) {
			expect(meanSquareToLufs(lufsToMeanSquare(lufs))).toBeCloseTo(lufs, 6);
		}
		expect(meanSquareToLufs(0)).toBe(-Infinity);
		expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
	});

	test('積分ラウドネス: 0 dBFS の正弦波 (左右) は -0.691 + 10log10(0.5 + 0.5) LUFS', () => {
		const s = sine(1, 3);
		expect(integratedLoudness([s, s], RATE)).toBeCloseTo(-0.691, 1);
		// -20 dBFS なら 20 LU 小さい
		const q = sine(0.1, 3);
		expect(integratedLoudness([q, q], RATE)).toBeCloseTo(-20.691, 1);
	});

	test('積分ラウドネス: 無音と短すぎる音声は測れない', () => {
		expect(integratedLoudness([new Float32Array(RATE * 2), new Float32Array(RATE * 2)], RATE)).toBeNull();
		expect(integratedLoudness([sine(1, 0.2)], RATE)).toBeNull();
		expect(integratedLoudness([], RATE)).toBeNull();
	});

	test('積分ラウドネス: 話の切れ目などの静かな部分は相対ゲートで除く', () => {
		const loud = sine(0.5, 3);
		const quiet = sine(0.005, 3);
		const mixed = concat(loud, quiet);
		const onlyLoud = integratedLoudness([loud, loud], RATE)!;
		expect(integratedLoudness([mixed, mixed], RATE)).toBeCloseTo(onlyLoud, 0);
	});

	test('補正は目標との差で、上げる向きは控えめにし、上限と下限で止まる。測れていなければ null', () => {
		expect(correctionDb(-18, -5)).toBeCloseTo(-13);
		expect(correctionDb(-18, -25)).toBeCloseTo(7 - BOOST_MARGIN_DB);
		expect(correctionDb(-18, -19)).toBe(0);
		expect(correctionDb(-18, -80)).toBe(MAX_GAIN_DB);
		expect(MAX_GAIN_DB).toBeLessThanOrEqual(12);
		expect(correctionDb(-18, 30)).toBe(MIN_GAIN_DB);
		expect(correctionDb(-18, null)).toBeNull();
	});

	test('複数の測定値はエネルギーの平均でまとめ、大きい回に寄る', () => {
		expect(combineLoudness([-20, -20])).toBeCloseTo(-20, 6);
		const combined = combineLoudness([-27, -14])!;
		expect(combined).toBeGreaterThan(-20.5);
		expect(combined).toBeLessThan(-14);
		expect(combineLoudness([])).toBeNull();
	});

	test('鳴らし始めは小さく、前回の測定値は下げる向きのときだけ使う', () => {
		expect(startGainDb(-18, null)).toBe(SAFE_START_DB);
		expect(SAFE_START_DB).toBeLessThanOrEqual(-12);
		// 前回 -5 LUFS (大きい局) なら -13 dB から
		expect(startGainDb(-18, -5)).toBeCloseTo(-13);
		// 前回 -30 LUFS (小さい局) でも、測り直すまでは持ち上げない
		expect(startGainDb(-18, -30)).toBe(0);
	});
});
