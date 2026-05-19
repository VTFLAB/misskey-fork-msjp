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
		this.logger = this.loggerService.getLogger('atproto', 'magenta');
		// 起動可視性のため info で出す (production でも常時出る)。本番運用が安定したら debug に戻してよい。
		this.logger.info(`atproto logger initialized (PID=${process.pid})`);
	}

	@bindThis
	public child(name: string): Logger {
		return this.logger.createSubLogger(name);
	}
}
