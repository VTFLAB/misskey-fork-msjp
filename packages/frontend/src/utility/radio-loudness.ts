/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ラジオの音量の自動調整に使う計算 (bsky-fork 独自)。
// 局の音声の先頭数秒をデコードし、ITU-R BS.1770 の K 特性を通した信号から積分ラウドネス (LUFS) を出して、
// 目標との差 (dB) で局ごとの大きさの差を打ち消す。
//
// 安全のための約束 (大きな音は耳とスピーカーを傷めるので、測定が外れても大きく鳴らさない):
// - 測り終えるまでは小さく鳴らす (SAFE_START_DB)。前に測った値があれば、それが下げる向きのときだけ使う
// - 持ち上げは MAX_GAIN_DB まで。下げるのはすぐ、上げるのはゆっくり (radio-player.ts)

// これより静かなブロックは無音として数えない (BS.1770 の絶対ゲート)
export const ABSOLUTE_GATE_LUFS = -70;
// 絶対ゲートを通ったブロックの平均より 10 LU 以上静かなブロックは数えない (BS.1770 の相対ゲート)
export const RELATIVE_GATE_LU = 10;
export const MIN_GAIN_DB = -30;
export const MAX_GAIN_DB = 10;
// 持ち上げるときは、測った差からこれだけ控える。数秒の切り出しでは、話の間合いなどで小さく測れることがある
export const BOOST_MARGIN_DB = 2;
// 測り終える前の補正。多くの局 (-14〜-8 LUFS) を目標より小さく鳴らす大きさ
export const SAFE_START_DB = -18;

export function meanSquareToLufs(meanSquare: number): number {
	return meanSquare > 0 ? -0.691 + 10 * Math.log10(meanSquare) : -Infinity;
}

export function lufsToMeanSquare(lufs: number): number {
	return Math.pow(10, (lufs + 0.691) / 10);
}

export function dbToGain(db: number): number {
	return Math.pow(10, db / 20);
}

// 測ったラウドネスを目標に合わせるための補正 (dB)。測れていなければ null。
// 下げる向きはそのまま、上げる向きは BOOST_MARGIN_DB だけ控えて MAX_GAIN_DB までにする
export function correctionDb(targetLufs: number, measuredLufs: number | null): number | null {
	if (measuredLufs == null || !Number.isFinite(measuredLufs)) return null;
	const diff = targetLufs - measuredLufs;
	if (diff <= 0) return Math.max(MIN_GAIN_DB, diff);
	return Math.min(MAX_GAIN_DB, Math.max(0, diff - BOOST_MARGIN_DB));
}

// 何回かの測定値をエネルギーの平均でまとめる。大きかった回に引っ張られるので、持ち上げすぎない側に寄る
export function combineLoudness(values: number[]): number | null {
	const finite = values.filter(v => Number.isFinite(v));
	if (finite.length === 0) return null;
	return meanSquareToLufs(finite.reduce((a, v) => a + lufsToMeanSquare(v), 0) / finite.length);
}

// 局を選んだ直後 (まだ測っていない間) の補正。前回の測定値は、小さくする向きのときだけ使う
export function startGainDb(targetLufs: number, previousLufs: number | null): number {
	const previous = correctionDb(targetLufs, previousLufs);
	return previous == null ? SAFE_START_DB : Math.min(0, previous);
}

// BS.1770 の積分ラウドネス。channels は K 特性を通した各チャンネルのサンプル (同じ長さ)。
// 400 ms のブロックを 100 ms ずつずらして測り、絶対ゲートと相対ゲートを通ったブロックの平均を返す。
// 測れる長さが無い、または全部が無音なら null
export function integratedLoudness(channels: Float32Array[], sampleRate: number): number | null {
	if (channels.length === 0 || sampleRate <= 0) return null;
	const length = Math.min(...channels.map(c => c.length));
	const block = Math.round(sampleRate * 0.4);
	const step = Math.round(sampleRate * 0.1);
	if (length < block) return null;

	// 100 ms ごとの二乗和を先に出しておき、ブロックはその 4 つ分の和で求める
	const segments = Math.floor(length / step);
	const segmentPower = new Float64Array(segments);
	for (const c of channels) {
		for (let s = 0; s < segments; s++) {
			let sum = 0;
			const start = s * step;
			for (let i = start; i < start + step; i++) sum += c[i] * c[i];
			segmentPower[s] += sum;
		}
	}
	const blocks: number[] = [];
	for (let s = 0; s + 4 <= segments; s++) {
		blocks.push((segmentPower[s] + segmentPower[s + 1] + segmentPower[s + 2] + segmentPower[s + 3]) / (step * 4));
	}

	const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
	const gated = blocks.filter(p => meanSquareToLufs(p) > ABSOLUTE_GATE_LUFS);
	if (gated.length === 0) return null;
	const relativeGate = meanSquareToLufs(mean(gated)) - RELATIVE_GATE_LU;
	const kept = gated.filter(p => meanSquareToLufs(p) > relativeGate);
	return meanSquareToLufs(mean(kept));
}
