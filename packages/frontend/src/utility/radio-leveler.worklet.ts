/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ラジオの音量をそろえる AudioWorklet のプロセッサ (bsky-fork 独自)。処理の中身は radio-loudness.ts の RadioLeveler。
// radio-player.ts が `?worker&url` で読み込み、局を鳴らすたびに新しいノードを作る。

import { LEVELER_PROCESSOR_NAME, RadioLeveler } from '@/utility/radio-loudness.js';
import type { LevelerMessage, LevelerProcessorOptions } from '@/utility/radio-loudness.js';

// AudioWorkletGlobalScope の型は TypeScript の lib に無いので、使う分だけ書く
type ProcessorScope = {
	sampleRate: number;
	AudioWorkletProcessor: new () => { readonly port: MessagePort };
	registerProcessor(name: string, processor: unknown): void;
};
const scope = globalThis as unknown as ProcessorScope;

// 再生側へ測定値を知らせる間隔 (秒)
const STATS_INTERVAL_SEC = 0.25;

class RadioLevelerProcessor extends scope.AudioWorkletProcessor {
	private readonly leveler: RadioLeveler;
	private readonly statsInterval: number;
	private framesUntilStats = 0;
	private disposed = false;

	constructor(options: { processorOptions?: Partial<LevelerProcessorOptions> }) {
		super();
		const o = options.processorOptions ?? {};
		this.leveler = new RadioLeveler({
			sampleRate: scope.sampleRate,
			targetLufs: o.targetLufs ?? -18,
			enabled: o.enabled ?? true,
			priorLufs: o.priorLufs ?? null,
		});
		this.statsInterval = Math.round(scope.sampleRate * STATS_INTERVAL_SEC);
		this.port.onmessage = (ev: MessageEvent<LevelerMessage>) => {
			if (ev.data.type === 'config') {
				this.leveler.configure(ev.data.config);
			} else {
				this.disposed = true;
			}
		};
	}

	public process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
		// 外したノードが処理を続けないよう、dispose を受けたら止める
		if (this.disposed) return false;
		const output = outputs[0];
		const frames = output.length > 0 ? output[0].length : 0;
		if (frames === 0) return true;
		this.leveler.process(inputs.length > 0 ? inputs[0] : [], output, frames);
		this.framesUntilStats -= frames;
		if (this.framesUntilStats <= 0) {
			this.framesUntilStats = this.statsInterval;
			this.port.postMessage(this.leveler.stats());
		}
		return true;
	}
}

scope.registerProcessor(LEVELER_PROCESSOR_NAME, RadioLevelerProcessor);
