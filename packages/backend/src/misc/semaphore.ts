/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// bsky-fork: 同時実行数を上限までに抑える小さなセマフォ。外部サーバーへの取得をまとめて走らせる箇所で使う。
export class Semaphore {
	private running = 0;
	private waiters: (() => void)[] = [];

	constructor(private readonly limit: number) {}

	public get idle(): boolean {
		return this.running === 0 && this.waiters.length === 0;
	}

	public async run<T>(fn: () => Promise<T>): Promise<T> {
		if (this.running >= this.limit) {
			// 解放側がスロットを譲ってくれる (running は減らさない) ので、ここでは増やさない
			await new Promise<void>(resolve => this.waiters.push(resolve));
		} else {
			this.running++;
		}
		try {
			return await fn();
		} finally {
			const next = this.waiters.shift();
			if (next) {
				next();
			} else {
				this.running--;
			}
		}
	}
}
