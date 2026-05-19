/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import Logger from '@/logger.js';
import { LoggerService } from '@/core/LoggerService.js';
import { bindThis } from '@/decorators.js';

@Injectable()
export class AtpLoggerService {
	public logger: Logger;

	constructor(
		private loggerService: LoggerService,
	) {
		// bundler / Misskey logger の挙動とは別に、NestJS が本当に instance を作っているかを
		// stderr に直接出して観測可能にする。本番運用が安定したら削除してよい。
		// eslint-disable-next-line no-console
		console.error(`[atproto:bootstrap] AtpLoggerService constructor invoked, PID=${process.pid}`);
		this.logger = this.loggerService.getLogger('atproto', 'magenta');
		this.logger.info(`atproto logger initialized (PID=${process.pid})`);
	}

	@bindThis
	public child(name: string): Logger {
		return this.logger.createSubLogger(name);
	}
}
