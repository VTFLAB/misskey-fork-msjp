/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, Inject } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { LiveLoggerService } from './LiveLoggerService.js';

const REQUEST_TIMEOUT_MS = 10000;

export class OmeApiError extends Error {
	constructor(
		public readonly status: number,
		public readonly endpoint: string,
		public readonly body: string,
	) {
		super(`OME HTTP ${status} ${endpoint}: ${body.slice(0, 200)}`);
		this.name = 'OmeApiError';
	}
}

export type OmeStreamTrack = {
	id: number;
	type: 'Video' | 'Audio';
	video?: {
		bitrate: string;
		bitrateAvg: string;
		bitrateLatest: string;
		bypass: boolean;
		codec: string;
		width: number;
		height: number;
	};
	audio?: {
		bitrate: string;
		bitrateAvg: string;
		bitrateLatest: string;
		bypass: boolean;
		codec: string;
	};
};

export type OmeStreamInfo = {
	name: string;
	input: {
		createdTime: string;
		sourceType: string;
		tracks: OmeStreamTrack[];
	};
};

// GET /v1/stats/current/... のレスポンス (OME調査 §12.1)。
// stream レベルの正確なキー名一覧は実機未検証のため totalConnections はオプショナル扱いとする
// (未確定事項2、Phase 0 実機検証で確定させる)。
export type OmeStreamStats = {
	createdTime: string;
	totalConnections?: number;
	totalBytesIn?: number;
	totalBytesOut?: number;
	[key: string]: unknown;
};

@Injectable()
export class OmeApiService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		private liveLoggerService: LiveLoggerService,
	) {
		this.logger = this.liveLoggerService.child('api');
	}

	public get isEnabled(): boolean {
		return this.config.ome != null;
	}

	// config.ome が無い状態で呼ばれたら実装バグ (呼び出し側で isEnabled を先に確認すること)
	@bindThis
	private getConfig(): NonNullable<Config['ome']> {
		if (this.config.ome == null) {
			throw new Error('OME integration is not configured.');
		}
		return this.config.ome;
	}

	/**
	 * ストリーム一覧を取得する (OmeStreamMonitorService の自己修復ポーリングで使用)。
	 */
	@bindThis
	public async listStreams(): Promise<string[]> {
		const ome = this.getConfig();
		const res = await this.fetchJson<{ response: string[] }>(
			`${ome.apiUrl}/v1/vhosts/${ome.vhost}/apps/${ome.app}/streams`,
			{ method: 'GET' },
		);
		return res.response;
	}

	/**
	 * ストリームの構成情報 (トラック構成、bypass 設定等) を取得する。
	 * 統計 (ビットレート等) には使えない — getStreamStats() を使うこと (OME調査 §12.1、パスが別系統)。
	 */
	@bindThis
	public async getStream(streamKey: string): Promise<OmeStreamInfo | null> {
		const ome = this.getConfig();
		try {
			const res = await this.fetchJson<{ response: OmeStreamInfo }>(
				`${ome.apiUrl}/v1/vhosts/${ome.vhost}/apps/${ome.app}/streams/${streamKey}`,
				{ method: 'GET' },
			);
			return res.response;
		} catch (err) {
			if (err instanceof OmeApiError && err.status === 404) return null;
			throw err;
		}
	}

	/**
	 * ビットレート/接続数などの統計情報を取得する (OmeStreamMonitorService の判定材料)。
	 * 正しいパスは /v1/stats/current/... (`current` セグメント必須、OME調査 §12.1)。
	 * 旧ドキュメントに載っている /v1/vhosts/.../streams/{stream} (stats を含まない方) は構成情報用で別物。
	 */
	@bindThis
	public async getStreamStats(streamKey: string): Promise<OmeStreamStats | null> {
		const ome = this.getConfig();
		try {
			const res = await this.fetchJson<{ response: OmeStreamStats }>(
				`${ome.apiUrl}/v1/stats/current/vhosts/${ome.vhost}/apps/${ome.app}/streams/${streamKey}`,
				{ method: 'GET' },
			);
			return res.response;
		} catch (err) {
			if (err instanceof OmeApiError && err.status === 404) return null;
			throw err;
		}
	}

	/**
	 * ingest 接続を強制切断する。OME調査 §5 の注記どおり、これだけでは配信者の再接続はブロックされない。
	 * 再接続防止は OmeAdmissionService のブラックリストで別途担保すること。
	 */
	@bindThis
	public async deleteStream(streamKey: string): Promise<void> {
		const ome = this.getConfig();
		await this.fetchJson<unknown>(
			`${ome.apiUrl}/v1/vhosts/${ome.vhost}/apps/${ome.app}/streams/${streamKey}`,
			{ method: 'DELETE' },
		);
	}

	@bindThis
	private async fetchJson<T>(urlStr: string, init: RequestInit): Promise<T> {
		const ome = this.getConfig();
		// 「トークン文字列そのもの」を base64 する (user:pass 形式の Basic 認証ではない、OME調査 §5 の罠)
		const basicAuth = Buffer.from(ome.apiToken, 'utf8').toString('base64');

		const ac = new AbortController();
		const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
		try {
			const res = await fetch(urlStr, {
				...init,
				headers: {
					...init.headers as Record<string, string>,
					'Authorization': `Basic ${basicAuth}`,
					'Accept': 'application/json',
				},
				signal: ac.signal,
			});
			if (!res.ok) {
				const body = await res.text().catch(() => '');
				throw new OmeApiError(res.status, new URL(urlStr).pathname, body);
			}
			if (res.status === 204) return undefined as T;
			const text = await res.text();
			if (text.length === 0) return undefined as T;
			return JSON.parse(text) as T;
		} catch (err) {
			if (err instanceof OmeApiError) throw err;
			if (err instanceof Error && err.name === 'AbortError') {
				this.logger.warn(`request timed out: ${urlStr}`);
				throw new OmeApiError(0, new URL(urlStr).pathname, 'request timed out');
			}
			throw err;
		} finally {
			clearTimeout(timer);
		}
	}
}
