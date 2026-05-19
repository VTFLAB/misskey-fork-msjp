/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { AtpLoggerService } from './AtpLoggerService.js';
import { AtpHttpClientService } from './AtpHttpClientService.js';

// app.bsky.actor.searchActors の Bsky actor 表現。
// 必要最低限のフィールドのみ型付け (他は frontend に渡さない)。
export type BskyActorView = {
	did: string;
	handle: string;
	displayName?: string;
	description?: string;
	avatar?: string;
	indexedAt?: string;
	viewer?: unknown;
	labels?: unknown[];
};

export type AtpSearchResult = {
	actors: BskyActorView[];
	cursor: string | null;
};

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

@Injectable()
export class AtpSearchService {
	private logger: Logger;

	constructor(
		private atpLoggerService: AtpLoggerService,
		private atpHttpClientService: AtpHttpClientService,
	) {
		this.logger = this.atpLoggerService.child('search');
	}

	@bindThis
	public async searchActors(q: string, opts: { limit?: number; cursor?: string } = {}): Promise<AtpSearchResult> {
		const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
		this.logger.debug(`searchActors q="${q}" limit=${limit}`);
		const res = await this.atpHttpClientService.xrpcGet<{ actors: BskyActorView[]; cursor?: string }>(
			'app.bsky.actor.searchActors',
			{
				q,
				limit,
				cursor: opts.cursor,
			},
		);
		return {
			actors: res.actors ?? [],
			cursor: res.cursor ?? null,
		};
	}
}
