/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ラジオの音量をそろえる処理 (bsky-fork 独自)。AudioWorklet (radio-leveler.worklet.ts) の中で、鳴らす音声に直接かける。
// DOM にも Web Audio にも依存しないので、単体テストでもそのまま動く。
//
// 仕組み:
// 1. 入ってきた音声を LOOKAHEAD_SEC だけ遅らせて出す。遅らせている間に、これから出す音の大きさを測れる
// 2. 測る: ITU-R BS.1770 の K 特性を通した信号の平均二乗を 100 ms ごとにまとめ、400 ms の窓 (momentary) と
//    3 秒の窓 (short-term) のラウドネスを出す。長い目で見た大きさは、ゲートを通った 400 ms 窓のラウドネス (dB)
//    の移動平均で追う。大きくなる向きは速く (LONG_TERM_UP_SEC)、静かになる向きはゆっくり (LONG_TERM_DOWN_SEC)
//    追い、測り始めは単純平均にする。ゲートを通った窓の直近 1 秒ほどの平均が推定から PROGRAM_CHANGE_LU 以上
//    離れたら、番組が替わったとみなし、差が PROGRAM_SETTLED_LU に縮まるまでどちらの向きも速く追う。
//    無音と話の切れ目はゲートで除くので、推定を動かさない。相対ゲートの基準は直前 1 秒の大きさにする。
//    長い目で見た大きさを基準にすると、番組が替わって大きく静かになったとき、静かな区間がずっとゲートで除かれて
//    推定が下がらない (3 秒でも、大きかった区間が窓に残る間は除かれる)。平均を dB で取るのも同じ理由で、
//    エネルギーで平均すると大きかった区間に引きずられ、静かな番組を 1 分以上持ち上げられない
// 3. 補正: 目標との差だけ増減する。下げる変化は速く、上げる変化はゆっくり行う。急に大きくなる部分は、
//    momentary と short-term が目標を数 LU 以上超えないよう、聞こえる前に下げる
// 4. 最後に先読み付きのリミッターで、ピークを LIMITER_THRESHOLD_DB に抑える
//
// 最初の音が出るのは、音声が入り始めてから LOOKAHEAD_SEC 後になる。そのときにはもう測った値で補正しているので、
// 大きな音で鳴り始めてから下がることは起きない。

export const LEVELER_PROCESSOR_NAME = 'mk-radio-leveler';

// これより静かな 400 ms 窓は無音として数えない (BS.1770 の絶対ゲート)
export const ABSOLUTE_GATE_LUFS = -70;
// 直前 1 秒の大きさより 10 LU 以上静かな窓は数えない (BS.1770 の相対ゲートに当たる)
export const RELATIVE_GATE_LU = 10;
// 音声を遅らせて出す長さ。鳴り始めの補正は、この長さの音を測って決める
export const LOOKAHEAD_SEC = 1.5;
export const MAX_GAIN_DB = 12;
export const MIN_GAIN_DB = -30;
// 補正したあとの momentary / short-term がこれだけ目標を超えそうなら、聞こえる前に下げる
export const MOMENTARY_CEILING_LU = 6;
export const SHORT_TERM_CEILING_LU = 4;
export const LIMITER_THRESHOLD_DB = -1;
// 何も測れていないうちに音が来たときに仮定する大きさ (大きめの局)。ふつうは先読みの間に測れるので使わない
export const ASSUMED_LUFS = -10;

const SEGMENT_SEC = 0.1;
const MOMENTARY_SEGMENTS = 4;
const SHORT_TERM_SEGMENTS = 30;
// 相対ゲートの基準にする長さ (1 秒)
const GATE_REFERENCE_SEGMENTS = 10;
// ピークを見る長さ (10 秒)
const PEAK_WINDOW_SEGMENTS = 100;
const LONG_TERM_UP_SEC = 3;
const LONG_TERM_DOWN_SEC = 8;
// 番組が替わったとみなしたときの追い方と、その判定に使う直近の平均の時定数
const LONG_TERM_FAST_SEC = 1;
const RECENT_SEC = 1;
const PROGRAM_CHANGE_LU = 6;
const PROGRAM_SETTLED_LU = 2;
// 前に測った値 (priorLufs) は、この長さの音を測ったのと同じ重みで扱う
const PRIOR_WEIGHT_SEC = 3;
// 持ち上げるのは、リミッターがピークをこれ以上抑えずに済む範囲まで (ピークの大きい局を割れさせない)
const MAX_LIMITING_DB = 6;
// 測り始めは、持ち上げる量をこれだけ控える。BOOST_MARGIN_SEC 測るまでに 0 にする
const BOOST_MARGIN_DB = 1.5;
const BOOST_MARGIN_SEC = 10;
// 補正の変化の時定数。下げるのは速く、上げるのはゆっくり
const DOWN_SEC = 0.05;
const UP_SEC = 1.5;
// 急に大きくなる部分は、その 100 ms 区間が出るこれだけ前から下げ始める
const LEAD_SEGMENTS = 2;
// 区間ごとの値を覚えておく数。先読みの区間数 (LOOKAHEAD_SEC / SEGMENT_SEC) より十分多くする
const RING_SEGMENTS = 64;
const LIMITER_LOOKAHEAD_SEC = 0.003;
const LIMITER_RELEASE_SEC = 0.15;
// これより小さい値しか来ていなければ、まだ音が来ていないとみなす
const SIGNAL_THRESHOLD = 1e-4;

export function meanSquareToLufs(meanSquare: number): number {
	return meanSquare > 0 ? -0.691 + 10 * Math.log10(meanSquare) : -Infinity;
}

export function lufsToMeanSquare(lufs: number): number {
	return Math.pow(10, (lufs + 0.691) / 10);
}

export function dbToGain(db: number): number {
	return Math.pow(10, db / 20);
}

export function gainToDb(gain: number): number {
	return gain > 0 ? 20 * Math.log10(gain) : -Infinity;
}

export type BiquadCoefficients = { b0: number; b1: number; b2: number; a1: number; a2: number };

// K 特性の 2 段のフィルター (高域のシェルフ約 +4 dB と 38 Hz のハイパス) の係数。
// libebur128 と同じ式で、48 kHz では BS.1770 の表の値になり、ほかのサンプルレートでも同じ特性になる
export function kWeightingCoefficients(sampleRate: number): [BiquadCoefficients, BiquadCoefficients] {
	let f0 = 1681.974450955533;
	const G = 3.999843853973347;
	let Q = 0.7071752369554196;
	let K = Math.tan(Math.PI * f0 / sampleRate);
	const Vh = Math.pow(10, G / 20);
	const Vb = Math.pow(Vh, 0.4996667741545416);
	let a0 = 1 + K / Q + K * K;
	const shelf = {
		b0: (Vh + Vb * K / Q + K * K) / a0,
		b1: 2 * (K * K - Vh) / a0,
		b2: (Vh - Vb * K / Q + K * K) / a0,
		a1: 2 * (K * K - 1) / a0,
		a2: (1 - K / Q + K * K) / a0,
	};

	f0 = 38.13547087602444;
	Q = 0.5003270373238773;
	K = Math.tan(Math.PI * f0 / sampleRate);
	a0 = 1 + K / Q + K * K;
	const highpass = {
		b0: 1,
		b1: -2,
		b2: 1,
		a1: 2 * (K * K - 1) / a0,
		a2: (1 - K / Q + K * K) / a0,
	};
	return [shelf, highpass];
}

export class Biquad {
	private z1 = 0;
	private z2 = 0;

	constructor(private readonly c: BiquadCoefficients) {}

	public process(x: number): number {
		const c = this.c;
		const y = c.b0 * x + this.z1;
		this.z1 = c.b1 * x - c.a1 * y + this.z2;
		this.z2 = c.b2 * x - c.a2 * y;
		// 無音が続いたときに非正規化数で計算が遅くならないよう、十分小さくなったら 0 にする
		if (Math.abs(this.z1) < 1e-25) this.z1 = 0;
		if (Math.abs(this.z2) < 1e-25) this.z2 = 0;
		return y;
	}
}

// K 特性 (2 段) を 1 チャンネル分かける
export class KWeighting {
	private readonly shelf: Biquad;
	private readonly highpass: Biquad;

	constructor(sampleRate: number) {
		const [shelf, highpass] = kWeightingCoefficients(sampleRate);
		this.shelf = new Biquad(shelf);
		this.highpass = new Biquad(highpass);
	}

	public process(x: number): number {
		return this.highpass.process(this.shelf.process(x));
	}
}

// 先読み付きのリミッター (2 チャンネル)。出す音は lookahead - 1 サンプル遅れる。
// 各サンプルに必要な抑え量の、直近 lookahead サンプルの最小値を取り、ゆっくり戻したうえで lookahead サンプルの
// 移動平均をかける。移動平均の窓は遅らせたサンプルを必ず含むので、出す音は閾値を超えない
export class PeakLimiter {
	public outL = 0;
	public outR = 0;
	// 前回 takeMinGain() してからの最小のゲイン
	private minGain = 1;

	private readonly size: number;
	private readonly threshold: number;
	private readonly releaseCoef: number;
	private readonly delayL: Float32Array;
	private readonly delayR: Float32Array;
	private delayIndex = 0;
	// 直近 size サンプルの最小値を出す単調なキュー (リングバッファ)
	private readonly queueValue: Float64Array;
	private readonly queueTime: Float64Array;
	private queueHead = 0;
	private queueLength = 0;
	private time = 0;
	private smoothed = 1;
	private readonly box: Float64Array;
	private boxIndex = 0;
	private boxSum: number;

	constructor(sampleRate: number, thresholdDb: number) {
		this.size = Math.max(1, Math.round(sampleRate * LIMITER_LOOKAHEAD_SEC));
		this.threshold = dbToGain(thresholdDb);
		this.releaseCoef = 1 - Math.exp(-1 / (LIMITER_RELEASE_SEC * sampleRate));
		this.delayL = new Float32Array(this.size);
		this.delayR = new Float32Array(this.size);
		this.queueValue = new Float64Array(this.size);
		this.queueTime = new Float64Array(this.size);
		this.box = new Float64Array(this.size).fill(1);
		this.boxSum = this.size;
	}

	public get latency(): number {
		return this.size - 1;
	}

	public process(l: number, r: number): void {
		const size = this.size;
		const peak = Math.max(Math.abs(l), Math.abs(r));
		const required = peak > this.threshold ? this.threshold / peak : 1;

		const t = this.time++;
		while (this.queueLength > 0 && this.queueTime[this.queueHead] <= t - size) {
			this.queueHead = this.queueHead + 1 === size ? 0 : this.queueHead + 1;
			this.queueLength--;
		}
		while (this.queueLength > 0) {
			const back = (this.queueHead + this.queueLength - 1) % size;
			if (this.queueValue[back] < required) break;
			this.queueLength--;
		}
		const tail = (this.queueHead + this.queueLength) % size;
		this.queueValue[tail] = required;
		this.queueTime[tail] = t;
		this.queueLength++;
		const windowMin = this.queueValue[this.queueHead];

		// 抑えるのはすぐ、戻すのはゆっくり (戻している間も windowMin を超えない)
		if (windowMin < this.smoothed) {
			this.smoothed = windowMin;
		} else {
			this.smoothed += (windowMin - this.smoothed) * this.releaseCoef;
		}

		this.boxSum += this.smoothed - this.box[this.boxIndex];
		this.box[this.boxIndex] = this.smoothed;
		this.boxIndex++;
		if (this.boxIndex === size) {
			this.boxIndex = 0;
			// 足し引きの誤差がたまらないよう、一周ごとに足し直す
			let sum = 0;
			for (let i = 0; i < size; i++) sum += this.box[i];
			this.boxSum = sum;
		}
		const gain = Math.min(1, this.boxSum / size);
		if (gain < this.minGain) this.minGain = gain;

		this.delayL[this.delayIndex] = l;
		this.delayR[this.delayIndex] = r;
		this.delayIndex = this.delayIndex + 1 === size ? 0 : this.delayIndex + 1;
		const threshold = this.threshold;
		// 計算上は閾値を超えないが、丸めの誤差に備えて最後に切る
		this.outL = Math.max(-threshold, Math.min(threshold, this.delayL[this.delayIndex] * gain));
		this.outR = Math.max(-threshold, Math.min(threshold, this.delayR[this.delayIndex] * gain));
	}

	public takeMinGain(): number {
		const v = this.minGain;
		this.minGain = 1;
		return v;
	}
}

// LoudnessTracker が 1 窓ごとに推定を寄せる割合。静的フィールドにすると、ここから定数だけを読み込むメインスレッド側の
// バンドルにもクラスが残るので、モジュールの定数にする
const UP_RATE = SEGMENT_SEC / LONG_TERM_UP_SEC;
const DOWN_RATE = SEGMENT_SEC / LONG_TERM_DOWN_SEC;
const FAST_RATE = SEGMENT_SEC / LONG_TERM_FAST_SEC;
const RECENT_RATE = SEGMENT_SEC / RECENT_SEC;

// 400 ms 窓のラウドネス (dB) の移動平均。数えた窓が少ないうちは単純平均にし、そのあとは大きくなる向きを
// 速く、静かになる向きをゆっくり追う。直近の平均 (recent) が推定から大きく離れたら、番組が替わったとみなして速く追う
export class LoudnessTracker {
	private estimate: number | null = null;
	private recent = 0;
	private changing = false;
	private count = 0;

	public get value(): number | null {
		return this.estimate;
	}

	// weight 個の窓でこの値を測ったものとして始める
	public seed(lufs: number, weight: number): void {
		this.estimate = lufs;
		this.recent = lufs;
		this.count = weight;
	}

	public add(lufs: number): void {
		this.count++;
		if (this.estimate == null) {
			this.estimate = lufs;
			this.recent = lufs;
			return;
		}
		const average = 1 / this.count;
		this.recent += (lufs - this.recent) * Math.max(average, RECENT_RATE);
		const gap = Math.abs(this.recent - this.estimate);
		if (gap > PROGRAM_CHANGE_LU) {
			this.changing = true;
		} else if (gap < PROGRAM_SETTLED_LU) {
			this.changing = false;
		}
		let rate: number;
		if (this.changing) {
			rate = FAST_RATE;
		} else {
			rate = lufs > this.estimate ? UP_RATE : DOWN_RATE;
		}
		this.estimate += (lufs - this.estimate) * Math.max(average, rate);
	}
}

export type LevelerConfig = {
	targetLufs: number;
	enabled: boolean;
};

export type LevelerProcessorOptions = LevelerConfig & {
	// 前にこの局で測った大きさ。測った値より大きいとき (補正を小さくする向き) だけ使う
	priorLufs: number | null;
};

export type LevelerStats = {
	// 長い目で見た大きさ (LUFS)。まだ測れていなければ null
	lufs: number | null;
	// いま掛けている補正 (dB)
	gainDb: number;
	// 前回の報告からリミッターが抑えた最大の量 (dB、0 以下)
	limiterDb: number;
	// ゲートを通って数えた音声の長さ (秒)
	measuredSec: number;
	// 音が出始めたか (先読みの分だけ遅れて出る)
	primed: boolean;
};

export type LevelerMessage =
	| { type: 'config'; config: LevelerConfig }
	| { type: 'dispose' };

export class RadioLeveler {
	private targetLufs: number;
	private enabled: boolean;
	private readonly sampleRate: number;
	private readonly hop: number;
	private readonly kL: KWeighting;
	private readonly kR: KWeighting;
	private readonly limiter: PeakLimiter;

	private readonly delaySamples: number;
	private readonly delayL: Float32Array;
	private readonly delayR: Float32Array;
	private delayIndex = 0;
	// これまでに受け取ったサンプル数
	private inputCount = 0;
	private firstSignalAt = -1;

	// 100 ms 区間の集計
	private segmentSum = 0;
	private segmentPeak = 0;
	private segmentFill = 0;
	private segmentCount = 0;
	private readonly segmentEnergy = new Float64Array(SHORT_TERM_SEGMENTS);
	private readonly segmentPeaks = new Float64Array(PEAK_WINDOW_SEGMENTS);
	// 区間ごとの値 (RING_SEGMENTS 区間分)。補正は、出す区間の時点の値で決める
	// ceilingRef: 「これ以上大きく出さない」基準 (LUFS)。目標からこれを引いた値が補正の上限になる
	private readonly ceilingRef = new Float64Array(RING_SEGMENTS).fill(-Infinity);
	// 長い目で見た大きさの推定 (測れていなければ NaN)、それまでに数えた窓の数、直近 10 秒のピーク
	private readonly estimateRef = new Float64Array(RING_SEGMENTS).fill(NaN);
	private readonly measuredRef = new Float64Array(RING_SEGMENTS);
	private readonly peakRef = new Float64Array(RING_SEGMENTS);

	// 長い目で見た大きさ (dB)。measured は測った窓だけ、withPrior は前に測った値も含める
	private readonly measuredTrack = new LoudnessTracker();
	private readonly priorTrack = new LoudnessTracker();
	private measuredBlocks = 0;

	private gainDb = 0;
	private gain = 1;
	private primed = false;
	// 音が出始めたときに測り終えていた最後の区間
	private primeSegment = 0;

	constructor(options: LevelerProcessorOptions & { sampleRate: number }) {
		this.sampleRate = options.sampleRate;
		this.targetLufs = options.targetLufs;
		this.enabled = options.enabled;
		this.hop = Math.max(1, Math.round(this.sampleRate * SEGMENT_SEC));
		this.kL = new KWeighting(this.sampleRate);
		this.kR = new KWeighting(this.sampleRate);
		this.limiter = new PeakLimiter(this.sampleRate, LIMITER_THRESHOLD_DB);
		this.delaySamples = Math.max(1, Math.round(this.sampleRate * LOOKAHEAD_SEC));
		this.delayL = new Float32Array(this.delaySamples);
		this.delayR = new Float32Array(this.delaySamples);
		if (options.priorLufs != null && Number.isFinite(options.priorLufs)) {
			this.priorTrack.seed(options.priorLufs, PRIOR_WEIGHT_SEC / SEGMENT_SEC);
		}
	}

	// 入力から出力までの遅れ (サンプル数)
	public get latency(): number {
		return this.delaySamples + this.limiter.latency;
	}

	public configure(config: LevelerConfig): void {
		this.targetLufs = config.targetLufs;
		this.enabled = config.enabled;
	}

	// input は 0〜2 チャンネル (無ければ無音)。output は 1〜2 チャンネルで、どれも frames サンプル以上
	public process(input: readonly Float32Array[], output: readonly Float32Array[], frames: number): void {
		const inL = input.length > 0 ? input[0] : null;
		const inR = input.length > 1 ? input[1] : inL;
		const outL = output[0];
		const outR = output.length > 1 ? output[1] : null;

		const wasPrimed = this.primed;
		const startGain = this.gain;
		this.updateGain(frames);
		// 音が出る前の補正の変化は、なめらかにしなくてよい
		const fromGain = wasPrimed ? startGain : this.gain;
		const step = (this.gain - fromGain) / frames;

		const limiter = this.limiter;
		const delayL = this.delayL;
		const delayR = this.delayR;
		for (let i = 0; i < frames; i++) {
			// 壊れた値 (NaN など) が 1 つでも入るとフィルターの状態が戻らなくなるので、無音として扱う
			const l = inL != null && Number.isFinite(inL[i]) ? inL[i] : 0;
			const r = inR != null && Number.isFinite(inR[i]) ? inR[i] : 0;
			this.measure(l, r, i);

			const d = this.delayIndex;
			const g = fromGain + step * (i + 1);
			const dl = delayL[d] * g;
			const dr = delayR[d] * g;
			delayL[d] = l;
			delayR[d] = r;
			this.delayIndex = d + 1 === this.delaySamples ? 0 : d + 1;

			limiter.process(dl, dr);
			outL[i] = limiter.outL;
			if (outR != null) outR[i] = limiter.outR;
		}
		this.inputCount += frames;
	}

	public stats(): LevelerStats {
		return {
			lufs: this.measuredBlocks > 0 ? this.estimate() : null,
			gainDb: this.gainDb,
			limiterDb: gainToDb(this.limiter.takeMinGain()),
			measuredSec: this.measuredBlocks * SEGMENT_SEC,
			primed: this.primed,
		};
	}

	private measure(l: number, r: number, offset: number): void {
		if (this.firstSignalAt < 0 && (Math.abs(l) > SIGNAL_THRESHOLD || Math.abs(r) > SIGNAL_THRESHOLD)) {
			this.firstSignalAt = this.inputCount + offset;
		}
		const kl = this.kL.process(l);
		const kr = this.kR.process(r);
		this.segmentSum += kl * kl + kr * kr;
		const peak = Math.max(Math.abs(l), Math.abs(r));
		if (peak > this.segmentPeak) this.segmentPeak = peak;
		if (++this.segmentFill === this.hop) this.finishSegment();
	}

	private finishSegment(): void {
		const k = this.segmentCount++;
		this.segmentEnergy[k % SHORT_TERM_SEGMENTS] = this.segmentSum / this.hop;
		this.segmentPeaks[k % PEAK_WINDOW_SEGMENTS] = this.segmentPeak;
		this.segmentSum = 0;
		this.segmentPeak = 0;
		this.segmentFill = 0;

		let peak = 0;
		const peaks = Math.min(this.segmentCount, PEAK_WINDOW_SEGMENTS);
		for (let j = 0; j < peaks; j++) if (this.segmentPeaks[j] > peak) peak = this.segmentPeaks[j];

		let ref = -Infinity;
		if (this.segmentCount >= MOMENTARY_SEGMENTS) {
			let sum = 0;
			for (let j = 0; j < MOMENTARY_SEGMENTS; j++) sum += this.segmentEnergy[(k - j) % SHORT_TERM_SEGMENTS];
			const momentary = meanSquareToLufs(sum / MOMENTARY_SEGMENTS);
			const available = Math.min(this.segmentCount, SHORT_TERM_SEGMENTS);
			sum = 0;
			for (let j = 0; j < available; j++) sum += this.segmentEnergy[j];
			const shortTerm = meanSquareToLufs(sum / available);
			const gateSegments = Math.min(this.segmentCount, GATE_REFERENCE_SEGMENTS);
			sum = 0;
			for (let j = 0; j < gateSegments; j++) sum += this.segmentEnergy[(k - j) % SHORT_TERM_SEGMENTS];
			this.updateLongTerm(momentary, meanSquareToLufs(sum / gateSegments));
			if (momentary > ABSOLUTE_GATE_LUFS) ref = momentary - MOMENTARY_CEILING_LU;
			if (shortTerm > ABSOLUTE_GATE_LUFS) ref = Math.max(ref, shortTerm - SHORT_TERM_CEILING_LU);
		}
		const slot = k % RING_SEGMENTS;
		this.ceilingRef[slot] = ref;
		this.estimateRef[slot] = this.estimate() ?? NaN;
		this.measuredRef[slot] = this.measuredBlocks;
		this.peakRef[slot] = peak;
	}

	private updateLongTerm(momentary: number, gateReference: number): void {
		if (momentary <= ABSOLUTE_GATE_LUFS || momentary <= gateReference - RELATIVE_GATE_LU) return;
		this.measuredTrack.add(momentary);
		this.priorTrack.add(momentary);
		this.measuredBlocks++;
	}

	// 長い目で見た大きさ。前に測った値は、測った値より大きいときだけ効く
	private estimate(): number | null {
		const measured = this.measuredTrack.value;
		const withPrior = this.priorTrack.value;
		if (measured == null) return withPrior;
		return withPrior == null ? measured : Math.max(measured, withPrior);
	}

	// これから出す音に掛けたい補正 (dB)
	private desiredGainDb(): number {
		if (!this.enabled) return 0;
		const latest = this.segmentCount - 1;
		const outSegment = Math.floor((this.inputCount - this.delaySamples) / this.hop);
		let db = this.targetLufs - ASSUMED_LUFS;
		if (latest >= 0) {
			// 長い目で見た補正は、これから出す区間の時点の推定で決める (先読みした変化で早く動かないように)。
			// 鳴り始めは、そのときまでに先読みした分すべてで測った推定を、出す区間が追いつくまで使う
			const wanted = this.primed ? Math.max(outSegment + LEAD_SEGMENTS, this.primeSegment) : latest;
			const slot = Math.max(latest - RING_SEGMENTS + 1, Math.min(latest, wanted)) % RING_SEGMENTS;
			const estimate = this.estimateRef[slot];
			db = this.targetLufs - (Number.isNaN(estimate) ? ASSUMED_LUFS : estimate);
			if (db > 0) {
				const margin = BOOST_MARGIN_DB * Math.max(0, 1 - this.measuredRef[slot] * SEGMENT_SEC / BOOST_MARGIN_SEC);
				db = Math.max(0, db - margin);
				const peak = this.peakRef[slot];
				if (peak > 0) db = Math.min(db, Math.max(0, LIMITER_THRESHOLD_DB + MAX_LIMITING_DB - gainToDb(peak)));
			}
		}
		// 先読みしてある区間のうち、これから出る区間が大きければ、聞こえる前に下げる
		const first = Math.max(0, outSegment, this.segmentCount - RING_SEGMENTS);
		const last = Math.min(outSegment + LEAD_SEGMENTS, latest);
		for (let j = first; j <= last; j++) {
			db = Math.min(db, this.targetLufs - this.ceilingRef[j % RING_SEGMENTS]);
		}
		return Math.min(MAX_GAIN_DB, Math.max(MIN_GAIN_DB, db));
	}

	private updateGain(frames: number): void {
		const desired = this.desiredGainDb();
		if (!this.primed) {
			// 音が出る前は、測った値にすぐ合わせる
			const outEnd = this.inputCount - this.delaySamples + frames;
			if (this.firstSignalAt >= 0 && outEnd > this.firstSignalAt) {
				this.primed = true;
				this.primeSegment = Math.max(0, this.segmentCount - 1);
			}
			this.gainDb = desired;
		} else {
			const tau = desired < this.gainDb ? DOWN_SEC : UP_SEC;
			this.gainDb += (desired - this.gainDb) * (1 - Math.exp(-frames / (tau * this.sampleRate)));
		}
		this.gain = dbToGain(this.gainDb);
	}
}
