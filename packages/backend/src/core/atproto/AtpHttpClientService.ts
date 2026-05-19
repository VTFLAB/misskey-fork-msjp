/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, Inject } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { AtpLoggerService } from './AtpLoggerService.js';

// Bsky の public AppView (anonymous read 専用)。
// 自前 PDS は持たない設計のため write endpoint は呼ばない。
const DEFAULT_APPVIEW = 'https://public.api.bsky.app';
const DEFAULT_PLC_DIRECTORY = 'https://plc.directory';
const REQUEST_TIMEOUT_MS = 10000;

export class AtpHttpError extends Error {
	constructor(
		public readonly status: number,
		public readonly endpoint: string,
		public readonly body: string,
	) {
		super(`AT Proto HTTP ${status} ${endpoint}: ${body.slice(0, 200)}`);
		this.name = 'AtpHttpError';
	}
}

@Injectable()
export class AtpHttpClientService {
	private logger: Logger;
	private readonly appviewBase: string;
	private readonly plcBase: string;

	constructor(
		@Inject(DI.config)
		private config: Config,

		private atpLoggerService: AtpLoggerService,
	) {
		this.logger = this.atpLoggerService.child('http');
		// config から override 可能だが現状は default のみ。
		this.appviewBase = (this.config as Config & { atprotoAppViewUrl?: string }).atprotoAppViewUrl ?? DEFAULT_APPVIEW;
		this.plcBase = (this.config as Config & { atprotoPlcDirectoryUrl?: string }).atprotoPlcDirectoryUrl ?? DEFAULT_PLC_DIRECTORY;
	}

	@bindThis
	public async xrpcGet<T = unknown>(method: string, params: Record<string, string | number | string[] | undefined>): Promise<T> {
		const url = new URL(`/xrpc/${method}`, this.appviewBase);
		for (const [k, v] of Object.entries(params)) {
			if (v == null) continue;
			if (Array.isArray(v)) {
				for (const item of v) url.searchParams.append(k, String(item));
			} else {
				url.searchParams.set(k, String(v));
			}
		}
		return this.fetchJson<T>(url.toString());
	}

	@bindThis
	public async plcGet<T = unknown>(did: string): Promise<T> {
		const url = new URL(`/${encodeURIComponent(did)}`, this.plcBase);
		return this.fetchJson<T>(url.toString());
	}

	@bindThis
	private async fetchJson<T>(urlStr: string): Promise<T> {
		const ac = new AbortController();
		const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
		try {
			// Node 22 built-in fetch (undici) を使う。HttpRequestService の https.Agent は
			// undici の dispatcher 型ではないため、ここでは渡さない (渡すと TypeError)。
			// public.api.bsky.app は安定した public CDN のため proxy / 内部 IP guard も不要。
			const res = await fetch(urlStr, {
				method: 'GET',
				headers: {
					'Accept': 'application/json',
					'User-Agent': `Misskey/${this.config.version} (atproto-bridge)`,
				},
				signal: ac.signal,
			});
			if (!res.ok) {
				const body = await res.text().catch(() => '');
				throw new AtpHttpError(res.status, urlStr, body);
			}
			return await res.json() as T;
		} finally {
			clearTimeout(timer);
		}
	}
}
