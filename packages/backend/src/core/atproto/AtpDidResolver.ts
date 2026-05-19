/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { MemoryKVCache } from '@/misc/cache.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { AtpLoggerService } from './AtpLoggerService.js';
import { AtpHttpClientService, AtpHttpError } from './AtpHttpClientService.js';

// PLC DID と did:web の DID document を解決する。
// Bsky 公式アカウントは did:plc:xxx (plc.directory)、did:web は alice.example.com の形式。

export type AtpDidDocument = {
	id: string;
	alsoKnownAs?: string[];
	service?: Array<{
		id: string;
		type: string;
		serviceEndpoint: string;
	}>;
};

export type AtpResolvedDid = {
	did: string;
	handle: string | null;
	pdsEndpoint: string | null;
	raw: AtpDidDocument;
};

const DID_WEB_PREFIX = 'did:web:';
const DID_PLC_PREFIX = 'did:plc:';
const PDS_SERVICE_TYPE = 'AtprotoPersonalDataServer';
const HANDLE_PREFIX = 'at://';

@Injectable()
export class AtpDidResolver {
	private logger: Logger;
	private readonly cache: MemoryKVCache<AtpResolvedDid>;

	constructor(
		private atpLoggerService: AtpLoggerService,
		private atpHttpClientService: AtpHttpClientService,
	) {
		this.logger = this.atpLoggerService.child('did');
		// DID document は handle 変更が起きると変わる。30 分キャッシュ。
		this.cache = new MemoryKVCache<AtpResolvedDid>(1000 * 60 * 30);
	}

	@bindThis
	public async resolve(did: string): Promise<AtpResolvedDid> {
		const cached = this.cache.get(did);
		if (cached) return cached;

		const doc = await this.fetchDocument(did);
		const resolved: AtpResolvedDid = {
			did,
			handle: this.extractHandle(doc),
			pdsEndpoint: this.extractPdsEndpoint(doc),
			raw: doc,
		};
		this.cache.set(did, resolved);
		this.logger.debug(`resolved ${did} → handle=${resolved.handle ?? '(none)'} pds=${resolved.pdsEndpoint ?? '(none)'}`);
		return resolved;
	}

	@bindThis
	public invalidate(did: string): void {
		this.cache.delete(did);
	}

	@bindThis
	private async fetchDocument(did: string): Promise<AtpDidDocument> {
		if (did.startsWith(DID_PLC_PREFIX)) {
			return this.atpHttpClientService.plcGet<AtpDidDocument>(did);
		}
		if (did.startsWith(DID_WEB_PREFIX)) {
			return this.fetchDidWeb(did);
		}
		throw new Error(`unsupported DID method: ${did}`);
	}

	@bindThis
	private async fetchDidWeb(did: string): Promise<AtpDidDocument> {
		// did:web:example.com → https://example.com/.well-known/did.json
		// did:web:example.com:user:alice → https://example.com/user/alice/did.json
		const rest = did.slice(DID_WEB_PREFIX.length);
		const parts = rest.split(':').map(decodeURIComponent);
		const host = parts[0];
		if (!host || !/^[a-zA-Z0-9.-]+$/.test(host)) {
			throw new Error(`invalid did:web host: ${did}`);
		}
		const path = parts.length === 1
			? '/.well-known/did.json'
			: '/' + parts.slice(1).join('/') + '/did.json';
		const url = `https://${host}${path}`;

		const ac = new AbortController();
		const timer = setTimeout(() => ac.abort(), 10000);
		try {
			const res = await fetch(url, {
				method: 'GET',
				headers: { Accept: 'application/json' },
				signal: ac.signal,
			});
			if (!res.ok) {
				const body = await res.text().catch(() => '');
				throw new AtpHttpError(res.status, url, body);
			}
			return await res.json() as AtpDidDocument;
		} finally {
			clearTimeout(timer);
		}
	}

	@bindThis
	private extractHandle(doc: AtpDidDocument): string | null {
		for (const aka of doc.alsoKnownAs ?? []) {
			if (aka.startsWith(HANDLE_PREFIX)) {
				const handle = aka.slice(HANDLE_PREFIX.length);
				if (handle.length > 0) return handle;
			}
		}
		return null;
	}

	@bindThis
	private extractPdsEndpoint(doc: AtpDidDocument): string | null {
		for (const svc of doc.service ?? []) {
			if (svc.type === PDS_SERVICE_TYPE && typeof svc.serviceEndpoint === 'string') {
				return svc.serviceEndpoint;
			}
		}
		return null;
	}
}
