/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { LoggerService } from '@/core/LoggerService.js';
import { RadioGardenService } from '@/core/radio/RadioGardenService.js';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

// ラジオウィジェットの音声の中継 (bsky-fork 独自)。
// route: GET {url}/radio-garden-stream/<token>
// - CORS を許可しない局と http の局だけがここを通る。ブラウザが音量を測るには、音声が同じオリジンか
//   CORS 付きで届く必要がある (届かないと Web Audio には無音しか渡らない)
// - token は api/radio-garden/resolve がログイン中のユーザーに発行する (Redis、10 分)。
//   局の URL は毎回サーバーが Radio Garden から引き直すので、任意の URL は中継できない
// - 同時に中継するのは 1 ユーザー 3 本 (再生 1 本と音量の測定、局の切り替えの重なり)、全体で 32 本まで。
//   数えるのはプロセスごと (worker が複数なら上限もその数だけ増える)。1 本は 3 時間で切る
//   (切れたらブラウザがつなぎ直す。閉じ忘れたタブが中継を持ち続けないため)
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_PER_USER = 3;
const MAX_TOTAL = 32;
const MAX_DURATION_MS = 3 * 60 * 60 * 1000;

@Injectable()
export class RadioStreamServerService {
	private logger: Logger;
	private activeByUser = new Map<string, number>();
	private activeTotal = 0;

	constructor(
		private radioGardenService: RadioGardenService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('radio-stream');
	}

	private acquire(userId: string): (() => void) | null {
		const count = this.activeByUser.get(userId) ?? 0;
		if (count >= MAX_PER_USER || this.activeTotal >= MAX_TOTAL) return null;
		this.activeByUser.set(userId, count + 1);
		this.activeTotal++;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.activeTotal--;
			const left = (this.activeByUser.get(userId) ?? 1) - 1;
			if (left <= 0) {
				this.activeByUser.delete(userId);
			} else {
				this.activeByUser.set(userId, left);
			}
		};
	}

	@bindThis
	public createServer(fastify: FastifyInstance, options: FastifyPluginOptions, done: (err?: Error) => void) {
		fastify.get<{
			Params: { token: string };
		}>('/:token', async (request, reply) => {
			reply.header('Cache-Control', 'no-store');

			const token = request.params.token;
			if (!TOKEN_RE.test(token)) {
				reply.code(404);
				return;
			}
			const entry = await this.radioGardenService.readStreamToken(token);
			if (entry == null) {
				reply.code(403);
				return;
			}
			const release = this.acquire(entry.userId);
			if (release == null) {
				reply.code(429);
				return;
			}

			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), MAX_DURATION_MS);
			controller.signal.addEventListener('abort', () => {
				clearTimeout(timer);
				release();
			}, { once: true });
			// 利用者が切ったら上流も閉じる (request の close は本文を読み終えた時点で出るので、応答側で見る)
			reply.raw.on('close', () => controller.abort());

			let stream: Awaited<ReturnType<RadioGardenService['openStream']>>;
			try {
				stream = await this.radioGardenService.openStream(entry.channelId, controller.signal);
			} catch (err) {
				controller.abort();
				this.logger.info(`cannot relay channel ${entry.channelId}: ${err instanceof Error ? err.message : String(err)}`);
				reply.code(502);
				return;
			}
			stream.body.on('close', () => controller.abort());

			reply.header('Content-Type', stream.contentType);
			reply.header('X-Content-Type-Options', 'nosniff');
			reply.header('X-Accel-Buffering', 'no');
			return reply.send(stream.body);
		});

		done();
	}
}
