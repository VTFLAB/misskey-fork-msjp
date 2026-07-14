# 03: バックエンド — OME 連携 (Phase 2)

## 位置づけ

本書は配信機能拡張の実装フェーズ分割における **Phase 2 (OME 連携・backend)** の詳細設計書。
読む前に `00-overview.md` (総論・確定決定・未確定事項番号)・`01-infra-ome-setup.md` (OME インフラ構築)・
`02-backend-channel.md` (Phase 1、`live_channel` テーブルと `LiveChannelService` の基盤) を読了していること。
本書は `02-backend-channel.md` が作った `live_channel` / `LiveChannelService` / `core/live/` ディレクトリ・
CoreModule 登録パターンにそのまま追加する形で書かれており、**02 で確定した内容を重複記載しない** (登録手順の
共通パターンは 02 §2 を参照)。

上位方針は `/tmp/claude-1000/-home-vtf-projects-misskey/03326e3d-ca9c-411d-a0d8-f1802e8985a1/scratchpad/architecture-decisions.md`
(以下「決定書」) に確定済みで、本書はそれに反しない。特に決定書 §2 (OME連携) と §3 (セッション統合) を厳守する。
OME 仕様の一次情報は同ディレクトリの `research-ome.md` (以下「OME調査」、§12 の追加検証結果を含む)。

## 前提

- リポジトリ実体: `/home/vtf/projects/misskey/misskey-repo` (branch: `bsky-integration`)。
- 参照実装は `packages/backend/src/core/twitch/` 一式・`packages/backend/src/server/twitch/TwitchServerService.ts`・
  `packages/backend/src/server/ActivityPubServerService.ts` (raw body 検証パターン)・
  `packages/backend/src/models/TwitchStream.ts`・`packages/backend/migration/1783041310169-AddTwitchStream.js`・
  `packages/backend/src/core/GlobalEventService.ts`。本書の file:line 引用はすべて 2026-07-14 時点の現物 Read で
  検証済み (行番号がズレている場合は現物を優先すること)。
- 実装時は `working-on-backend` skill を必ず参照すること (本書はその代替ではない)。
- 本書の執筆者は設計書のみを作成し、実装コードのコミットは行わない。
- Phase 2 は Phase 0 (OME インフラ稼働) と Phase 1 (`live_channel` テーブル) の両方に依存する。`config.ome` が
  未設定の環境では本書のコード一式は一切動作しない設計とする (決定書 §2 の縮退方式)。

## 完了条件チェックリスト (Phase 2)

- [ ] `config.ts` に `ome` ブロックが Source型/解決後型/解決ロジックの3点で追加され、必須項目欠落時は
      `config.ome === undefined` になる
- [ ] `packages/backend/src/core/live/OmeApiService.ts` が `getStream`/`getStreamStats`/`deleteStream`/`listStreams`
      を実装し、Basic 認証・タイムアウト・エラーハンドリングを備える
- [ ] `packages/backend/src/server/ome/OmeServerService.ts` (prefix `/ome`) が `POST /ome/admission` を実装し、
      raw body 検証・HMAC-SHA1 署名検証・3秒以内の応答を満たす **(AdmissionWebhooks 有効化時のみ必要)**
- [ ] `packages/backend/src/core/live/OmeAdmissionService.ts` が opening/closing・incoming/outgoing の判定ロジック
      (streamKey 突合・ブラックリスト・多重配信防止・視聴者数カウント) を実装する **(AdmissionWebhooks 有効化時のみ必要)**
- [ ] `twitch_stream` テーブルに `source` カラムが追加され、`twitchUserId`/`twitchStreamId`/`twitchLogin` が
      nullable 化される migration が `up()`/`down()` 双方を実装し `check-migrations` を通る
- [ ] `TwitchStreamService`/`TwitchChatRelayService` に `source === 'twitch'` ガードが追加される
- [ ] `LiveChannelService.generateIngestUrls()` が SignedPolicy 付き WHIP URL を返す
- [ ] `packages/backend/src/core/live/OmeStreamMonitorService.ts` が 10 秒ポーリング・ビットレート判定・遮断シーケンス・
      自己修復ポーリングを実装する
- [ ] `twitch/streams/show` のレスポンスに `sessions` 配列が後方互換な形で追加される
- [ ] `CoreModule.ts`・`ServerModule.ts`・`endpoint-list.ts` の登録漏れがない (§1-8 の各差分箇所を参照)
- [ ] `pnpm build-misskey-js-with-types` 実行後、`packages/misskey-js/src/autogen/` の差分と
      `packages/misskey-js/src/streaming.types.ts` の手動差分がコミットに含まれる
- [ ] `packages/backend/test/e2e/ome-admission.ts` が本書 §9 のケースを網羅する
- [ ] `pnpm --filter backend check-migrations` が pending DDL 0 件で通る

---

## 1. config 追加

`packages/backend/src/config.ts` の twitch ブロック (`Source` 型 `:118-121`、解決後 `Config` 型 `:237-240`、
解決ロジック `:381-384`) と完全に同型のパターンを 3 点に追加する。

### 1-1. `Source` 型 (`config.ts:118` 付近、`twitch?:` ブロックの直後に挿入)

現状 (`config.ts:118-127`):

```ts
	twitch?: {
		clientId?: string;
		clientSecret?: string;
	};

	twitchTranslation?: {
		url?: string;
		timeout?: number;
	};
```

変更後 (`twitchTranslation?` の直後、`remoteGuestLogin?` の前に `ome?:` ブロックを追加):

```ts
	twitch?: {
		clientId?: string;
		clientSecret?: string;
	};

	twitchTranslation?: {
		url?: string;
		timeout?: number;
	};

	// OME (OvenMediaEngine) 連携 (fork 独自)。未設定なら機能全体が無効。
	ome?: {
		apiUrl?: string;
		apiToken?: string;
		signedPolicySecret?: string;
		publicWhipUrl?: string;
		vhost?: string;
		app?: string;
		maxVideoBitrate?: number;
		maxAudioBitrate?: number;
		// AdmissionWebhooks はオプション。将来有効化する場合に追加。
		admissionSecret?: string;
	};
```

### 1-2. 解決後 `Config` 型 (`config.ts:236-246` 付近、`twitchTranslation:` の直後に挿入)

現状 (`config.ts:236-246`):

```ts
	// Twitch 連携 (fork 独自)。未設定なら機能全体が無効。
	twitch: {
		clientId: string;
		clientSecret: string;
	} | undefined;

	// Twitch 配信コメント翻訳 (fork 独自)。LibreTranslate互換 (LTEngine) サーバーの URL。未設定なら機能全体が無効。
	twitchTranslation: {
		url: string;
		timeout: number;
	} | undefined;
```

変更後 (`twitchTranslation` の直後、`remoteGuestLogin` の前に追加):

```ts
	// Twitch 配信コメント翻訳 (fork 独自)。LibreTranslate互換 (LTEngine) サーバーの URL。未設定なら機能全体が無効。
	twitchTranslation: {
		url: string;
		timeout: number;
	} | undefined;

	// OME (OvenMediaEngine) 連携 (fork 独自)。未設定なら機能全体が無効。全必須項目が揃わない限り undefined になる。
	ome: {
		apiUrl: string;
		apiToken: string;
		signedPolicySecret: string;
		publicWhipUrl: string;
		vhost: string;
		app: string;
		maxVideoBitrate: number;
		maxAudioBitrate: number;
		// AdmissionWebhooks はオプション。有効化時に追加される。
		admissionSecret?: string;
	} | undefined;
```

### 1-3. 解決ロジック (`config.ts:381-388` 付近、`loadConfig()` 内の return オブジェクト)

現状 (`config.ts:381-388`):

```ts
		twitch: (config.twitch?.clientId && config.twitch.clientSecret) ? {
			clientId: config.twitch.clientId,
			clientSecret: config.twitch.clientSecret,
		} : undefined,
		twitchTranslation: config.twitchTranslation?.url ? {
			url: config.twitchTranslation.url,
			timeout: config.twitchTranslation.timeout ?? 8000,
		} : undefined,
```

変更後 (`twitchTranslation` の直後、`remoteGuestLogin` の前に追加):

```ts
		twitch: (config.twitch?.clientId && config.twitch.clientSecret) ? {
			clientId: config.twitch.clientId,
			clientSecret: config.twitch.clientSecret,
		} : undefined,
		twitchTranslation: config.twitchTranslation?.url ? {
			url: config.twitchTranslation.url,
			timeout: config.twitchTranslation.timeout ?? 8000,
		} : undefined,
		ome: (config.ome?.apiUrl && config.ome.apiToken && config.ome.signedPolicySecret && config.ome.publicWhipUrl) ? {
			apiUrl: config.ome.apiUrl,
			apiToken: config.ome.apiToken,
			signedPolicySecret: config.ome.signedPolicySecret,
			publicWhipUrl: config.ome.publicWhipUrl,
			vhost: config.ome.vhost ?? 'default',
			app: config.ome.app ?? 'live',
			maxVideoBitrate: config.ome.maxVideoBitrate ?? 3000,
			maxAudioBitrate: config.ome.maxAudioBitrate ?? 128,
			// AdmissionWebhooks 有効化時のみ設定される。
			...(config.ome.admissionSecret ? { admissionSecret: config.ome.admissionSecret } : {}),
		} : undefined,
```

`vhost`/`app`/`maxVideoBitrate`/`maxAudioBitrate` はデフォルト値を持つため必須項目から除外した (決定書 §2 の
`ome:` サンプル値をデフォルトとして採用)。`apiUrl`/`apiToken`/`signedPolicySecret`/`publicWhipUrl` の 4 項目が
1 つでも欠けると `config.ome = undefined` となり、`OmeApiService.isEnabled` (§2) が false を返して機能全体が
無効化される (twitch と同じ縮退方式)。`admissionSecret` は AdmissionWebhooks を有効化する際に追加される
オプション項目であり、Phase 2 の必須完了条件から外す。

---

## 2. `OmeApiService.ts` — OME REST API クライアント

新規ファイル: `packages/backend/src/core/live/OmeApiService.ts`

参照実装: `TwitchApiService.ts` (`fetchJson` の AbortController タイムアウトパターン、`TwitchApiError` の
エラークラス設計、`isEnabled` ゲッター)。ただし OME の認証は Twitch の Bearer とは異なり **Basic 認証 =
`base64(AccessToken)`** である点に注意 (OME調査 §5、罠: user:pass 形式ではなく **AccessToken 文字列そのもの**
を base64 する)。

```ts
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
```

エラーハンドリング方針: `OmeApiError` はネットワーク/HTTPエラー全般を包む。タイムアウトは `status: 0` として
表現し、呼び出し側 (`OmeAdmissionService`/`OmeStreamMonitorService`) で「OME 到達不能」を区別できるようにする。
`getStream`/`getStreamStats` の 404 (ストリーム未存在、配信者が既に切断した等) は例外にせず `null` を返す
(呼び出し側での毎回の try/catch を避けるため)。`deleteStream`/`listStreams` は 404 以外の失敗をそのまま
呼び出し側に伝播させる (§7 のポーリングループが catch してログのみ出す設計、§7 参照)。

`LiveLoggerService.ts` は `TwitchLoggerService.ts` (`LoggerService.getLogger('twitch', 'blue')`) と同型で
`packages/backend/src/core/live/LiveLoggerService.ts` に新設する (決定書 §0、名前空間 `live`。ロガーの色は
`twitch` と区別するため `'green'` 等、実装時に既存ロガー色一覧と衝突しない値を選ぶ)。02 で `LiveChannelService`
がこのロガーを既に使っている前提のため、本書では新規ファイルとして再掲しない (02 §2 のパターンで登録済み想定。
未着手なら Phase 2 実装の先頭で `TwitchLoggerService.ts` をそのまま `s/twitch/live/` した内容で作成する)。

---

## 3. `server/ome/OmeServerService.ts` (prefix `/ome`, optional)

新規ファイル: `packages/backend/src/server/ome/OmeServerService.ts`

**本書 §3 / §4 は AdmissionWebhooks を有効化した場合のみ必要な実装である。**
SignedPolicy が WHIP Provider の認可を単独で完結させるため、Phase 2 の必須要件
からは外す (00-overview.md D3)。将来的なライフサイクル通知・bit rate 超過時の
即時遮断・ブラックリスト連携を実装する際に有効化する。

参照実装: `packages/backend/src/server/twitch/TwitchServerService.ts` (fastify プラグイン雛形、`createServer(fastify,
options, done)` シグネチャ、`@bindThis`)。raw body 取得は `packages/backend/src/server/ActivityPubServerService.ts`
の `config: { rawBody: true }` パターンを使う — `fastify-raw-body` プラグインは `ServerService.ts:107-111` で
**`global: false`** として登録済みなので、各ルートで個別に `config: { rawBody: true }` を指定するだけで
`request.rawBody` (Buffer) が使える (新たなプラグイン登録は不要)。

X-OME-Signature の HMAC-SHA1 検証は OME調査 §4 の Node.js コードを踏襲するが、Base64URL エンコードのヘルパーは
新規実装が必要 (fork内に既存の base64url ヘルパーは無い、`LiveChannelService.generateIngestUrls()` §6 と共有できる
よう `packages/backend/src/misc/` 配下にユーティリティを切り出すことを推奨するが、本書では `OmeServerService.ts`
内に private メソッドとして示す)。

```ts
/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Inject } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { LiveLoggerService } from '@/core/live/LiveLoggerService.js';
import { OmeAdmissionService } from '@/core/live/OmeAdmissionService.js';
import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';

type OmeAdmissionRequestBody = {
	client: {
		address: string;
		port: number;
		real_ip?: string;
		user_agent?: string;
	};
	request: {
		direction: 'incoming' | 'outgoing';
		protocol: 'webrtc' | 'llhls' | 'thumbnail';
		status: 'opening' | 'closing';
		url: string;
		new_url?: string;
		time: string;
	};
};

@Injectable()
export class OmeServerService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		private omeAdmissionService: OmeAdmissionService,
		private liveLoggerService: LiveLoggerService,
	) {
		this.logger = this.liveLoggerService.child('server');
	}

	// Base64URL デコード (OME の X-OME-Signature はパディング無し base64url)
	@bindThis
	private verifySignature(rawBody: Buffer, signatureHeader: string, secretKey: string): boolean {
		const expected = createHmac('sha1', secretKey).update(rawBody).digest('base64')
			.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

		const expectedBuf = Buffer.from(expected, 'utf8');
		const actualBuf = Buffer.from(signatureHeader, 'utf8');
		if (expectedBuf.length !== actualBuf.length) return false;
		return timingSafeEqual(expectedBuf, actualBuf);
	}

	@bindThis
	public createServer(fastify: FastifyInstance, options: FastifyPluginOptions, done: (err?: Error) => void) {
		fastify.post<{ Body: OmeAdmissionRequestBody }>(
			'/admission',
			{ config: { rawBody: true }, bodyLimit: 1024 * 16 },
			async (request: FastifyRequest<{ Body: OmeAdmissionRequestBody }>, reply) => {
				if (this.config.ome == null) {
					reply.code(404);
					return;
				}

				const signature = request.headers['x-ome-signature'];
				if (typeof signature !== 'string' || request.rawBody == null) {
					reply.code(403);
					return { allowed: false, reason: 'missing signature or body' };
				}

				if (this.config.ome.admissionSecret == null) {
					reply.code(503);
					return { allowed: false, reason: 'admission webhooks not configured' };
				}

				if (!this.verifySignature(request.rawBody, signature, this.config.ome.admissionSecret)) {
					this.logger.warn(`admission signature mismatch (url=${request.body?.request?.url})`);
					reply.code(403);
					return { allowed: false, reason: 'bad signature' };
				}

				const { request: req } = request.body;

				if (req.status === 'closing') {
					// closing は応答内容を待つ処理が無いため同期的に処理してよい (opening ほどの緊急性はない)。
					// ただし後段のフォロワー通知等が発生する opening と処理を揃えるため、ここでも
					// 「応答は空 JSON を即返す→後処理は非同期」の形にしておく (Timeout 超過防止の一貫性)。
					reply.send({});
					this.omeAdmissionService.handleClosing(req).catch(err => {
						this.logger.error(`handleClosing failed: ${err instanceof Error ? err.message : err}`);
					});
					return;
				}

				// opening: Server.xml の Timeout (3000ms, OME調査 §4) 以内に応答する必要がある。
				// streamKey 突合・ブラックリスト確認までを同期的に行い allowed を確定させたら即応答し、
				// フォロワー通知・streaming channel 配信などの重い処理は応答後に非同期実行する。
				const decision = await this.omeAdmissionService.decideOpening(req);
				reply.send({
					allowed: decision.allowed,
					reason: decision.reason,
					...(decision.lifetime != null ? { lifetime: decision.lifetime } : {}),
				});

				if (decision.allowed) {
					this.omeAdmissionService.afterOpeningAllowed(req, decision).catch(err => {
						this.logger.error(`afterOpeningAllowed failed: ${err instanceof Error ? err.message : err}`);
					});
				}
			},
		);

		done();
	}
}
```

登録:

- `ServerModule.ts` の providers 配列に `OmeServerService` を追加 (`TwitchServerService` が `:32` import・`:109`
  providers に登録されているのと同じ形、`RemoteGuestServerService` の直後に追加するのが自然)。
- `ServerService.ts:165` (`fastify.register(this.twitchServerService.createServer, { prefix: '/twitch' });`) の
  直後に以下を追加し、コンストラクタの DI パラメータリストにも `private omeServerService: OmeServerService,` を
  追加する:
  ```ts
  fastify.register(this.omeServerService.createServer, { prefix: '/ome' });
  ```

opening 応答のタイムアウト遵守: Server.xml 側の `AdmissionWebhooks/Timeout` は 3000ms (OME調査 §4 のサンプル、
決定書でも 3 秒運用を前提)。`decideOpening()` (§4) は streamKey の DB 突合とブラックリストの Redis 参照のみを
行い、いずれも数十ms程度で完了する設計とする。フォロワー通知・streaming channel への配信開始イベントは
`afterOpeningAllowed()` として応答送信後に `.catch()` 付きで fire-and-forget 実行し、これらが 3 秒を超えても
OME 側の認可判定には影響しない。

---

## 4. `OmeAdmissionService.ts` — 判定ロジック詳細 (optional)

新規ファイル: `packages/backend/src/core/live/OmeAdmissionService.ts`

**本節は AdmissionWebhooks 有効化時に必要なロジックである。Phase 2 では
SignedPolicy による認可が完結するため、必須実装ではない。** 将来的に
AdmissionWebhooks を有効化する場合、本節の `decideOpening`/`handleClosing` 等を
ライフサイクル通知・視聴者数カウント・ブラックリスト連携用に使用する。

依存: `LiveChannelsRepository` (streamKey→live_channel 突合)、`TwitchStreamsRepository` (`source='ome'` の
セッション行 upsert、02 で `live_channel` は独立テーブルだが配信セッションは既存 `twitch_stream` を共用する
決定書 §3 のため)、`Redis` (ブラックリスト・視聴者数カウント)、`NotificationService`、`GlobalEventService`、
`IdService`。

```ts
/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, Inject } from '@nestjs/common';
import { IsNull } from 'typeorm';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import type { FollowingsRepository, LiveChannelsRepository, TwitchStreamsRepository } from '@/models/_.js';
import { MiTwitchStream } from '@/models/TwitchStream.js';
import { IdService } from '@/core/IdService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { LiveLoggerService } from './LiveLoggerService.js';

const BLACKLIST_TTL_SEC = 10 * 60; // 10分 (決定書 §2 ビットレート制限)

type AdmissionRequest = {
	direction: 'incoming' | 'outgoing';
	protocol: 'webrtc' | 'llhls' | 'thumbnail';
	status: 'opening' | 'closing';
	url: string;
};

type OpeningDecision = {
	allowed: boolean;
	reason: string;
	lifetime?: number;
	// afterOpeningAllowed() に渡すための内部情報 (allowed=false の場合は無視される)
	streamKey?: string;
	liveChannel?: { id: string; userId: string; name: string | null };
	streamRowId?: string;
};

@Injectable()
export class OmeAdmissionService {
	private logger: Logger;

	constructor(
		@Inject(DI.liveChannelsRepository)
		private liveChannelsRepository: LiveChannelsRepository,

		@Inject(DI.twitchStreamsRepository)
		private twitchStreamsRepository: TwitchStreamsRepository,

		@Inject(DI.followingsRepository)
		private followingsRepository: FollowingsRepository,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		private idService: IdService,
		private globalEventService: GlobalEventService,
		private notificationService: NotificationService,
		private liveLoggerService: LiveLoggerService,
	) {
		this.logger = this.liveLoggerService.child('admission');
	}

	// URL (scheme://host[:port]/app/stream[/file]?query) から stream 名 (= streamKey) を抜き出す。
	// OME の app 名は config.ome.app 固定 (決定書「app 名は live 固定」) なので、path の第2セグメントを使う。
	@bindThis
	private extractStreamKey(url: string): string | null {
		try {
			const u = new URL(url);
			const segments = u.pathname.split('/').filter(s => s.length > 0);
			// segments = [app, stream, ...file] 形式
			return segments[1] ?? null;
		} catch {
			return null;
		}
	}

	@bindThis
	private blacklistKey(streamKey: string): string {
		return `ome:blacklist:${streamKey}`;
	}

	@bindThis
	private viewerCountKey(streamKey: string): string {
		return `ome:viewers:${streamKey}`;
	}

	/**
	 * direction: incoming (配信者からの ingest) の opening 判定。
	 * OmeServerService から呼ばれ、3秒以内に完了する必要がある (DB 1クエリ + Redis 1クエリのみ)。
	 */
	@bindThis
	public async decideOpening(req: AdmissionRequest): Promise<OpeningDecision> {
		if (req.direction === 'outgoing') {
			// 視聴 (WebRTC egress) は常に許可。視聴者数カウントのみ行う (統計API併用は未確定事項2、Phase 0後に選択)。
			const streamKey = this.extractStreamKey(req.url);
			if (streamKey != null) {
				await this.redisClient.incr(this.viewerCountKey(streamKey));
			}
			return { allowed: true, reason: 'outgoing (playback) is always allowed' };
		}

		// direction: incoming (webrtc の ingest)
		const streamKey = this.extractStreamKey(req.url);
		if (streamKey == null) {
			return { allowed: false, reason: 'cannot extract stream key from url' };
		}

		const blacklisted = await this.redisClient.exists(this.blacklistKey(streamKey));
		if (blacklisted === 1) {
			this.logger.info(`admission denied (blacklisted): streamKey=${streamKey}`);
			return { allowed: false, reason: 'stream key is temporarily blocked' };
		}

		const liveChannel = await this.liveChannelsRepository.findOneBy({ streamKey, enabled: true });
		if (liveChannel == null) {
			this.logger.info(`admission denied (no matching live_channel): streamKey=${streamKey}`);
			return { allowed: false, reason: 'unknown or disabled stream key' };
		}

		// 多重配信防止: 同一チャンネルの既存 isLive source='ome' セッションがあれば、古いセッションを閉じて
		// 新規接続を許可する (決定書に明記の「古いセッションを閉じて許可」方針。配信者が OBS を再起動した際に
		// 自分自身をブロックしないための挙動)。
		const existingLive = await this.twitchStreamsRepository.findBy({
			userId: liveChannel.userId,
			isLive: true,
			source: 'ome',
		});
		for (const s of existingLive) {
			await this.twitchStreamsRepository.update(s.id, { isLive: false, endedAt: new Date() });
			this.globalEventService.publishTwitchLiveStream(s.id, 'streamEnded', {});
			this.logger.info(`closed stale ome session: streamId=${s.id} (superseded by new opening)`);
		}

		return {
			allowed: true,
			reason: 'authorized',
			lifetime: 0, // 無制限 (ビットレート超過遮断は OmeStreamMonitorService が REST DELETE で能動的に行う)
			streamKey,
			liveChannel: { id: liveChannel.id, userId: liveChannel.userId, name: liveChannel.name },
		};
	}

	/**
	 * decideOpening() が allowed:true を返した直後、応答送信後に非同期で呼ばれる (incoming のみ)。
	 * セッション行 upsert・フォロワー通知・streaming channel 配信を行う。応答のブロッキングに影響しない。
	 */
	@bindThis
	public async afterOpeningAllowed(req: AdmissionRequest, decision: OpeningDecision): Promise<void> {
		if (decision.liveChannel == null || decision.streamKey == null) return;

		const { liveChannel, streamKey } = decision;

		const newStream = new MiTwitchStream({
			id: this.idService.gen(),
			userId: liveChannel.userId,
			source: 'ome',
			twitchUserId: null,
			twitchStreamId: null,
			twitchLogin: null,
			isLive: true,
			title: liveChannel.name ?? '',
			gameName: null,
			thumbnailUrl: null,
			viewerCount: 0,
			startedAt: new Date(),
		});
		await this.twitchStreamsRepository.insertOne(newStream);
		this.logger.info(`ome stream started: user=${liveChannel.userId} streamKey=${streamKey} streamId=${newStream.id}`);

		// フォロワー通知 (TwitchStreamService.notifyFollowers と同型、research-codebase §11 の 7 ファイルパターンで
		// 新設する `liveStreamStarted` notification type を使う。詳細は本節末尾の通知セクション参照)
		const followings = await this.followingsRepository.find({
			where: { followeeId: liveChannel.userId, followerHost: IsNull() },
			select: { followerId: true },
		});
		for (const following of followings) {
			this.notificationService.createNotification(following.followerId, 'liveStreamStarted', {
				streamId: newStream.id,
				title: newStream.title,
			}, liveChannel.userId);
		}

		// streaming channel への配信開始通知: 既存 twitchLiveStream チャンネルを流用 (決定書 §3、streamId 単位で
		// source 非依存)。専用イベント型は無く、視聴側は streamId 指定で購読するだけで良いため明示的な
		// 「開始」イベントは無い (twitchLiveStream チャンネルは comment/commentTranslated/streamEnded のみ)。
		// 「配信が始まったこと」はチャンネルページ/`/live` 一覧のポーリングまたは §8 の `sessions` 拡張で検知させる。
	}

	/**
	 * direction: incoming + status: closing。OmeServerService から非同期に呼ばれる (応答は既に空 JSON 送信済み)。
	 */
	@bindThis
	public async handleClosing(req: AdmissionRequest): Promise<void> {
		if (req.direction === 'outgoing') {
			const streamKey = this.extractStreamKey(req.url);
			if (streamKey != null) {
				await this.redisClient.decr(this.viewerCountKey(streamKey));
			}
			return;
		}

		const streamKey = this.extractStreamKey(req.url);
		if (streamKey == null) return;

		const liveChannel = await this.liveChannelsRepository.findOneBy({ streamKey });
		if (liveChannel == null) return;

		const liveSessions = await this.twitchStreamsRepository.findBy({
			userId: liveChannel.userId,
			isLive: true,
			source: 'ome',
		});
		for (const s of liveSessions) {
			await this.twitchStreamsRepository.update(s.id, { isLive: false, endedAt: new Date() });
			this.globalEventService.publishTwitchLiveStream(s.id, 'streamEnded', {});
		}
		this.logger.info(`ome stream ended: user=${liveChannel.userId} streamKey=${streamKey}`);
	}
}
```

### 通知 type `liveStreamStarted` の新設 (research-codebase §11 の 7 ファイルパターン)

`twitchLiveStreamStarted` の実例に倣い、以下 7 箇所に同型の差分を入れる (`03-backend-ome-integration.md` として
本節に集約、02 で `live_channel` 側の通知は扱っていないため新規)。

1. **`packages/backend/src/types.ts`** — JSDoc (`:29` の直後に1行追加) と `notificationTypes` 配列
   (`:54` `'twitchLiveStreamStarted',` の直後、`:55` `] as const;` の前に追加):
   ```ts
   // types.ts:29 の直後に追加する JSDoc 行
    * liveStreamStarted - フォロー中ユーザーのライブチャンネル (MSJP配信) が開始した (bsky-fork 独自)
   ```
   ```ts
   // types.ts:54 の直後
   	'twitchLiveStreamStarted',
   	'liveStreamStarted',
   ] as const;
   ```

2. **`packages/backend/src/models/Notification.ts`** (`:167-175` の `twitchLiveStreamStarted` union member の
   直後、`:175` の `};` を `} | {` に変更してから新メンバーを追加):
   ```ts
   } | {
   	// フォロー中ユーザーの Twitch 配信開始通知 (bsky-fork 独自)
   	type: 'twitchLiveStreamStarted';
   	id: string;
   	createdAt: string;
   	notifierId: MiUser['id'];
   	streamId: MiTwitchStream['id'];
   	title: string;
   } | {
   	// フォロー中ユーザーのライブチャンネル (MSJP配信) 開始通知 (bsky-fork 独自)
   	type: 'liveStreamStarted';
   	id: string;
   	createdAt: string;
   	notifierId: MiUser['id'];
   	streamId: MiTwitchStream['id'];
   	title: string;
   };
   ```
   `MiTwitchStream` は `twitch_stream` テーブルを共用するため型としてもそのまま流用する (決定書 §3)。

3. **`packages/backend/src/models/json-schema/notification.ts`** (`:511-540` の `twitchLiveStreamStarted` オブジェクト
   ブロックの直後、配列を閉じる `:540` の `}]` の前に新オブジェクトを追加):
   ```ts
   }, {
   	type: 'object',
   	properties: {
   		...baseSchema.properties,
   		type: {
   			type: 'string',
   			optional: false, nullable: false,
   			enum: ['liveStreamStarted'],
   		},
   		user: {
   			type: 'object',
   			ref: 'UserLite',
   			optional: false, nullable: false,
   		},
   		userId: {
   			type: 'string',
   			optional: false, nullable: false,
   			format: 'id',
   		},
   		streamId: {
   			type: 'string',
   			optional: false, nullable: false,
   			format: 'id',
   		},
   		title: {
   			type: 'string',
   			optional: false, nullable: false,
   		},
   	},
   }],
   ```

4. **`packages/backend/src/models/json-schema/user.ts`** (`:651` `twitchLiveStreamStarted: { optional: true,
   ...notificationRecieveConfig },` の直後に追加):
   ```ts
   liveStreamStarted: { optional: true, ...notificationRecieveConfig },
   ```

5. **`packages/backend/src/core/entities/NotificationEntityService.ts`** (`:221-224` の
   `twitchLiveStreamStarted` 条件付き spread の直後に追加):
   ```ts
   ...(notification.type === 'liveStreamStarted' ? {
   	streamId: notification.streamId,
   	title: notification.title,
   } : {}),
   ```

6. **`packages/misskey-js/src/consts.ts`** (`:42` `'twitchLiveStreamStarted',` の直後、autogen 対象外の手動追記):
   ```ts
   'liveStreamStarted',
   ```

7. **発火元**: `OmeAdmissionService.afterOpeningAllowed()` (本節のコード中、`this.notificationService.createNotification(
   following.followerId, 'liveStreamStarted', { streamId: newStream.id, title: newStream.title }, liveChannel.userId);`)。
   `TwitchStreamService.notifyFollowers` (`TwitchStreamService.ts:124-142`) と同じ「フォロワー一覧を自前解決して
   1件ずつ createNotification」パターン。

`pnpm build-misskey-js-with-types` の再実行が必須 (`packages/misskey-js/src/autogen/` の差分をコミットに含める)。

---

## 5. セッション統合 migration

新規ファイル: `packages/backend/migration/{unixMs}-AddSourceToTwitchStream.js`

タイムスタンプ取得: `node -e "console.log(Date.now())"` (実装時に必ず取り直す。本書では `1783300000000` を仮値
として示す)。参照実装: `packages/backend/migration/1783041310169-AddTwitchStream.js` (生 SQL の `up()`/`down()`
双方実装パターン)。

対象テーブル `twitch_stream` の現行スキーマは `MiTwitchStream` エンティティ (`packages/backend/src/models/
TwitchStream.ts`) 参照。変更点:

- `source varchar(16) NOT NULL DEFAULT 'twitch'` を新規カラムとして追加 (`'twitch' | 'ome'`)。
- `twitchUserId` (`TwitchStream.ts:32-37`、現行 `varchar(64) NOT NULL` + 単独 index)・`twitchStreamId`
  (`TwitchStream.ts:39-44`、現行 `varchar(64) NOT NULL` + **unique** index)・`twitchLogin`
  (`TwitchStream.ts:46-50`、現行 `varchar(128) NOT NULL DEFAULT ''`) を **nullable 化**する。
  `twitchStreamId` の unique index は Postgres の仕様上 NULL は複数行で重複を許容するため (NULL は
  一意性制約の比較対象外)、`source='ome'` の行が複数存在してもこの index は壊れない。

```js
/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// twitch_stream を Twitch/OME 共用の汎用配信セッションテーブルにする (決定書 §3)。
// source で判別し、OME セッション行は twitchUserId/twitchStreamId/twitchLogin を null のまま使う。
// unique index (twitchStreamId) は Postgres の NULL 複数許容仕様によりそのまま有効。

export class AddSourceToTwitchStream1783300000000 {
    name = 'AddSourceToTwitchStream1783300000000'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "twitch_stream" ADD "source" character varying(16) NOT NULL DEFAULT 'twitch'`);
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream"."source" IS 'Which system produced this session: twitch or ome.'`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ALTER COLUMN "twitchUserId" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ALTER COLUMN "twitchStreamId" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ALTER COLUMN "twitchLogin" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ALTER COLUMN "twitchLogin" DROP DEFAULT`);
        await queryRunner.query(`CREATE INDEX "IDX_twitch_stream_source" ON "twitch_stream" ("source")`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        // down 実行時に source='ome' の行 (twitchUserId 等が null) が既に存在すると
        // NOT NULL 復元が失敗する。本番運用でこの migration を down する場合は事前に
        // source='ome' の行を手動削除するか、暫定値で埋めてから down すること。
        await queryRunner.query(`DROP INDEX "public"."IDX_twitch_stream_source"`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ALTER COLUMN "twitchLogin" SET DEFAULT ''`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ALTER COLUMN "twitchLogin" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ALTER COLUMN "twitchStreamId" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ALTER COLUMN "twitchUserId" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" DROP COLUMN "source"`);
    }
}
```

### entity 側の型変更 (`packages/backend/src/models/TwitchStream.ts`)

`:32-50` を以下のように変更する (`nullable: true` を追加、TypeScript 型を `| null` に):

変更前 (`TwitchStream.ts:32-50`):

```ts
	@Index()
	@Column('varchar', {
		length: 64,
		comment: 'Twitch user id of the broadcaster.',
	})
	public twitchUserId: string;

	@Index({ unique: true })
	@Column('varchar', {
		length: 64,
		comment: 'Twitch stream (session) id.',
	})
	public twitchStreamId: string;

	@Column('varchar', {
		length: 128, default: '',
		comment: '[Denormalized] Twitch login name (for embed player / chat relay).',
	})
	public twitchLogin: string;
```

変更後:

```ts
	@Index()
	@Column('varchar', {
		length: 64, nullable: true,
		comment: 'Twitch user id of the broadcaster. null for source=ome sessions.',
	})
	public twitchUserId: string | null;

	@Index({ unique: true })
	@Column('varchar', {
		length: 64, nullable: true,
		comment: 'Twitch stream (session) id. null for source=ome sessions.',
	})
	public twitchStreamId: string | null;

	@Column('varchar', {
		length: 128, nullable: true,
		comment: '[Denormalized] Twitch login name (for embed player / chat relay). null for source=ome sessions.',
	})
	public twitchLogin: string | null;

	@Index()
	@Column('varchar', {
		length: 16, default: 'twitch',
		comment: 'Which system produced this session: twitch or ome.',
	})
	public source: 'twitch' | 'ome';
```

### 既存コードへの影響列挙 (git grep 洗い出し結果、非null前提の箇所)

`git grep -n "twitchUserId\|twitchStreamId\|twitchLogin" -- packages/backend/src/core/twitch packages/backend/src/server/api/endpoints/twitch` で洗い出した非null前提の箇所と対応方針:

- **`TwitchStreamService.ts`** — 最もリスクが高い。以下は **`source==='twitch'` の行のみを対象にする限り
  変更不要**だが、汎用化した `getAllLiveStreams()` を OME 込みで呼ぶようになる `live-streams.ts` 拡張 (02 §6で
  言及、本書 §8で実施) 経由では `source` を見ずに `twitchUserId` にアクセスするコードが無いことを保証する必要が
  ある:
  - `upsertLiveStream`/`markOffline`/`handleStreamOnline`/`pollAll` (`:84-212`) は Twitch EventSub/ポーリング専用の
    入口関数であり、呼び出し元はすべて Twitch 由来のイベントに限定される (`TwitchEventSubService`・自身の
    `pollAll`)。OME 由来のセッションはこれらの関数を一切通らない (`OmeAdmissionService` が独立して
    upsert/markOffline 相当の処理を行う、§4)。**したがってこれらのメソッド自体にガードは不要** — 呼び出し経路が
    構造的に `source='twitch'` に限定されているため。
  - ただし `markOffline(twitchUserId: string)` (`:148`) のシグネチャは `twitchUserId: string` (non-null) のままで
    問題ない。OME側は `OmeAdmissionService.handleClosing` が独自に `source='ome'` の行を `userId` で検索して
    offline化するため (`markOffline` を呼ばない設計、§4 参照)。
  - `getAllLiveStreams()` (`:221-227`) は `source` を条件に含めない全件取得のため、そのまま OME セッションも
    含めて返る。呼び出し元 (`twitch/live-streams.ts`) 側でレスポンス項目 (`twitchLogin` 等) が `null` になり得る
    ことへの対応が必要 (§8 で対応)。
- **`TwitchChatRelayService.ts`** — `relayToTwitch()` (`:66-` 、双方向中継の Misskey→Twitch 方向) と
  `handleChatMessageEvent()` (`:183-`、Twitch→Misskey 方向) の双方に **`if (stream.source !== 'twitch') return;`
  ガードを追加する**。理由: このサービスは Twitch Bot 経由の中継専用であり、`source='ome'` のセッションに対して
  誤って `stream.twitchUserId` (null になり得る) を Twitch Helix API へ渡すとランタイムエラーになる。
  - `relayToTwitch(stream, user, text)` の本体開始直後 (fastify から見た `stream` 引数受け取り直後) に追加。
  - `handleChatMessageEvent(event)` 内、`findOneBy({...})` でストリームを取得した直後 (`if (stream == null)
    return;` の直後) に追加。EventSub の `channel.chat.message` イベント自体が Twitch チャンネル発なので理論上
    `source==='ome'` の行がヒットすることは無いはずだが、防御的プログラミングとして明示する。
- **`TwitchEventSubService.ts`** — EventSub は Twitch 固有の WebSocket 接続であり、購読対象アカウント一覧は
  `twitchAccountsRepository` (`twitch_account` テーブル、本 migration の対象外) から取得している。
  `twitch_stream` の `source` 列とは無関係のため **変更不要**。
- **`TwitchOAuthService.ts`** — `twitch_account` テーブル操作のみで `twitch_stream` を扱わないため
  **変更不要**。
- **`server/api/endpoints/twitch/streams/show.ts`** (`:33` `twitchLogin: { ..., nullable: false }`) と
  **`server/api/endpoints/twitch/live-streams.ts`** (`:31` 同様) — これらは Twitch 専用 endpoint であり、
  `twitchAccountsRepository` 経由で取得した `account.twitchLogin` (`twitch_account` テーブル側、本 migration の
  対象外) を返しているため **スキーマ変更は不要** (影響なし)。`twitch/streams/show.ts` のレスポンスに OME
  セッションを混在させる拡張は §8 で `twitch/streams/show` 自体に `sessions` 配列を追加する形で行う (`stream`
  フィールドの構造は変更しない、後方互換)。

---

## 6. `LiveChannelService.generateIngestUrls()`

02 で作成済みの `packages/backend/src/core/live/LiveChannelService.ts` (`:282-395`) に以下のメソッドを追加する。
OME調査 §3 の Node.js コードを fork のコード規約 (`@bindThis`、SPDX 済みファイルへの追記) に合わせて移植する。

 **呼び出し元**: この関数は 02 §5-5 の `live-channels/my` endpoint のハンドラ内から呼ばれ、レスポンスの
`whipUrl` を組み立てる (`pack()` には入れない — pack は公開情報用。接続は WI-2.6)。

**WHIP URL 形式**: `http://{publicWhipUrl}/{app}/{streamKey}?direction=whip&policy={base64url(json)}&signature={hmac_sha1}`。
OME の SignedPolicy では HMAC-SHA1 署名対象 URL に **ポートを含む完全な URL** が必要 (OME調査 §3-3)。
`config.ome.publicWhipUrl` は `http://stream.msjp.pro:3333` のようなポート込み文字列で設定する。

**policy 内容**: `{ url_expire: <epoch_ms> }`。URL は配信開始時に Misskey が発行するが、
**有効期限は実質無期限 (現在時刻 + 100年)** とする。理由: Misskey 設定画面でユーザーに
WHIP URL を案内する都合上、短期期限では配信のたびに URL が変わりユーザーが再設定を
強いられる。100年期限なら実用上は永続的に同じ URL で配信でき、ストリームキー
(`streamKey`) の漏洩が疑われる場合はユーザーが手動で「ストリームキー再生成」
(`regenerateStreamKey` endpoint) を実行することで SignedPolicy URL も更新される
(旧キーの接続は OME REST DELETE で即時切断)。`url_expire` の実装値は
`Date.now() + 100 * 365 * 24 * 60 * 60 * 1000` とする。

```ts
	// generateIngestUrls: SignedPolicy 付き WHIP ingest URL を生成する (決定書 §2、00-overview.md D3)。
	@bindThis
	public generateIngestUrls(channel: MiLiveChannel, ome: NonNullable<Config['ome']>): {
		whip: string;
	} {
		const urlExpireMs = Date.now() + 100 * 365 * 24 * 60 * 60 * 1000; // 100 years (実質無期限)

		return {
			whip: this.signUrl({
				scheme: 'http', // WHIP は HTTP(S)。WAN 公開後は https に切り替え。
				urlBase: ome.publicWhipUrl, // 例: 'http://stream.msjp.pro:3333' (ポート明示必須)
				app: ome.app,
				stream: channel.streamKey,
				secretKey: ome.signedPolicySecret,
				urlExpireMs,
				extraQuery: { direction: 'whip' }, // OME調査 §7 の WHIP URL 形式
			}),
		};
	}

	// OME調査 §3 の Node.js 実装をそのまま移植 (Base64URL エンコード + HMAC-SHA1)。
	@bindThis
	private signUrl(params: {
		scheme: string;
		urlBase: string; // 'scheme://host:port' 形式 (ポート必須、決定書「ポート明示必須の罠」)
		app: string;
		stream: string;
		secretKey: string;
		urlExpireMs: number;
		extraQuery?: Record<string, string>;
	}): string {
		const policy = { url_expire: params.urlExpireMs };
		const policyEncoded = this.base64UrlEncode(Buffer.from(JSON.stringify(policy), 'utf8'));

		// urlBase は既に 'scheme://host:port' を含む前提 (config.ome.publicWhipUrl がポート込みで設定される)
		let baseUrl = `${params.urlBase}/${params.app}/${params.stream}?policy=${policyEncoded}`;
		if (params.extraQuery != null) {
			for (const [k, v] of Object.entries(params.extraQuery)) {
				baseUrl += `&${k}=${encodeURIComponent(v)}`;
			}
		}

		const signature = createHmac('sha1', params.secretKey).update(baseUrl).digest();
		const signatureEncoded = this.base64UrlEncode(signature);

		return `${baseUrl}&signature=${signatureEncoded}`;
	}

	@bindThis
	private base64UrlEncode(buf: Buffer): string {
		return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	}
```

`import { createHmac } from 'node:crypto';` と `import type { Config } from '@/config.js';` を
`LiveChannelService.ts` の import ブロックに追加する。

### SignedPolicy on WHIP Provider (Phase 0 実機検証済)

`Server.xml` の `VirtualHost/SignedPolicy/Enables/Providers` を `webrtc` に設定すると、WHIP ingest
接続に対して SignedPolicy 署名検証が働く。Phase 0 実機検証で署名なし WHIP 接続は 401 拒否、署名ありは
接続成功を確認済み (00-overview.md 未確定事項 #1)。

---

## 7. `OmeStreamMonitorService.ts`

新規ファイル: `packages/backend/src/core/live/OmeStreamMonitorService.ts`

参照実装: `TwitchStreamService.ts` の `onModuleInit` + `cluster.isPrimary` ガード (`:52-71`)・`setInterval` による
ポーリング雛形。

```ts
/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import cluster from 'node:cluster';
import { Injectable, Inject, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import type { LiveChannelsRepository, TwitchStreamsRepository } from '@/models/_.js';
import type { Config } from '@/config.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { OmeApiService } from './OmeApiService.js';
import { LiveLoggerService } from './LiveLoggerService.js';

const POLL_INTERVAL_MS = 10 * 1000; // 決定書 §2「10秒間隔でポーリング」
const RECONCILE_INTERVAL_MS = 2 * 60 * 1000; // OME ダウン時の自己修復 (webhook 取り逃し対策、TwitchStreamService と同思想)
const OVERAGE_MARGIN = 1.1; // 10% マージン
const CONSECUTIVE_OVERAGE_THRESHOLD = 3; // 3回連続 (≒30秒継続)
const BLACKLIST_TTL_SEC = 10 * 60;

@Injectable()
export class OmeStreamMonitorService implements OnModuleInit, OnApplicationShutdown {
	private logger: Logger;
	private pollTimer: NodeJS.Timeout | null = null;
	private reconcileTimer: NodeJS.Timeout | null = null;
	// streamKey ごとの連続超過カウント (プロセスローカル、Redis化はしない: 監視自体が cluster.isPrimary 限定のため単一プロセス)
	private overageCounts = new Map<string, { video: number; audio: number }>();
	// OME 到達不能の連続回数 (縮退判定用)
	private consecutiveApiFailures = 0;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.liveChannelsRepository)
		private liveChannelsRepository: LiveChannelsRepository,

		@Inject(DI.twitchStreamsRepository)
		private twitchStreamsRepository: TwitchStreamsRepository,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		private omeApiService: OmeApiService,
		private globalEventService: GlobalEventService,
		private liveLoggerService: LiveLoggerService,
	) {
		this.logger = this.liveLoggerService.child('monitor');
	}

	async onModuleInit(): Promise<void> {
		if (!this.omeApiService.isEnabled) return;
		// TwitchStreamService.onModuleInit (:52-71) と同じ理由で primary process のみで走らせる。
		if (!cluster.isPrimary) return;

		this.pollTimer = setInterval(() => {
			this.pollActiveSessions().catch(err => {
				this.logger.error(`poll failed: ${err instanceof Error ? err.message : err}`);
			});
		}, POLL_INTERVAL_MS);

		this.reconcileTimer = setInterval(() => {
			this.reconcileWithOme().catch(err => {
				this.logger.error(`reconcile failed: ${err instanceof Error ? err.message : err}`);
			});
		}, RECONCILE_INTERVAL_MS);
	}

	async onApplicationShutdown(): Promise<void> {
		if (this.pollTimer != null) clearInterval(this.pollTimer);
		if (this.reconcileTimer != null) clearInterval(this.reconcileTimer);
	}

	/**
	 * アクティブな source='ome' セッションのみを対象に統計をポーリングし、ビットレート超過を判定する。
	 */
	@bindThis
	public async pollActiveSessions(): Promise<void> {
		const ome = this.config.ome;
		if (ome == null) return;

		const activeSessions = await this.twitchStreamsRepository.find({
			where: { isLive: true, source: 'ome' },
		});
		if (activeSessions.length === 0) return;

		const channelsByUserId = new Map(
			(await this.liveChannelsRepository.findBy({ userId: In(activeSessions.map(s => s.userId)) })) // eslint-disable-line
				.map(c => [c.userId, c]),
		);

		for (const session of activeSessions) {
			const channel = channelsByUserId.get(session.userId);
			if (channel == null) continue;

			let stats: Awaited<ReturnType<OmeApiService['getStream']>>;
			try {
				stats = await this.omeApiService.getStream(channel.streamKey);
				this.consecutiveApiFailures = 0;
			} catch (err) {
				this.consecutiveApiFailures++;
				// OME ダウン時の縮退: エラー連続時はログのみ、セッションを勝手に閉じない (決定書 §2 末尾)。
				this.logger.warn(`getStream failed (streamKey=${channel.streamKey}, consecutive=${this.consecutiveApiFailures}): ${err instanceof Error ? err.message : err}`);
				continue;
			}
			if (stats == null) continue; // ストリーム未存在 (既に切断済み等) は次回 reconcile に任せる

			const videoTrack = stats.input.tracks.find(t => t.type === 'Video');
			const audioTrack = stats.input.tracks.find(t => t.type === 'Audio');

			// bitrateLatest の実挙動 (瞬間値/平均値の意味) は Phase 0 実機検証項目 (00-overview 未確定事項4)。
			// ここでは「最新の瞬間ビットレート」という前提でしきい値判定する。
			const videoBitrateKbps = videoTrack?.video != null ? Number(videoTrack.video.bitrateLatest) / 1000 : 0;
			const audioBitrateKbps = audioTrack?.audio != null ? Number(audioTrack.audio.bitrateLatest) / 1000 : 0;

			const videoOver = videoBitrateKbps > ome.maxVideoBitrate * OVERAGE_MARGIN;
			const audioOver = audioBitrateKbps > ome.maxAudioBitrate * OVERAGE_MARGIN;

			const counts = this.overageCounts.get(channel.streamKey) ?? { video: 0, audio: 0 };
			counts.video = videoOver ? counts.video + 1 : 0;
			counts.audio = audioOver ? counts.audio + 1 : 0;
			this.overageCounts.set(channel.streamKey, counts);

			if (counts.video >= CONSECUTIVE_OVERAGE_THRESHOLD || counts.audio >= CONSECUTIVE_OVERAGE_THRESHOLD) {
				await this.cutStream(session, channel.streamKey, videoOver ? 'video' : 'audio', videoBitrateKbps, audioBitrateKbps);
				this.overageCounts.delete(channel.streamKey);
			}
		}

		// 監視対象から外れたキーのカウントを掃除 (メモリリーク防止)
		const activeKeys = new Set(activeSessions.map(s => channelsByUserId.get(s.userId)?.streamKey).filter((k): k is string => k != null));
		for (const key of this.overageCounts.keys()) {
			if (!activeKeys.has(key)) this.overageCounts.delete(key);
		}
	}

	/**
	 * 遮断シーケンス: DELETE → blacklist → 通知 → markOffline (決定書 §2)。
	 */
	@bindThis
	private async cutStream(session: MiTwitchStream, streamKey: string, cause: 'video' | 'audio', videoKbps: number, audioKbps: number): Promise<void> {
		const reason = cause === 'video'
			? `映像ビットレートが上限を超過しました (${Math.round(videoKbps)}kbps)`
			: `音声ビットレートが上限を超過しました (${Math.round(audioKbps)}kbps)`;

		this.logger.warn(`cutting stream due to bitrate overage: streamKey=${streamKey} cause=${cause} video=${videoKbps}kbps audio=${audioKbps}kbps`);

		// 1. 強制切断
		try {
			await this.omeApiService.deleteStream(streamKey);
		} catch (err) {
			this.logger.error(`deleteStream failed (streamKey=${streamKey}): ${err instanceof Error ? err.message : err}`);
			// DELETE 失敗時もブラックリストと通知は続行する (再接続拒否側で防御を継続するため)
		}

		// 2. ブラックリスト登録 (10分、AdmissionWebhooks opening で再接続拒否)
		await this.redisClient.set(`ome:blacklist:${streamKey}`, '1', 'EX', BLACKLIST_TTL_SEC);

		// 3. 配信者へ通知 (live_channel.lastCutReason に記録。既存 notification 経由の即時プッシュは
		//    Phase 4 のフロント実装と合わせて検討、Phase 2 では DB 記録のみ行う)
		await this.liveChannelsRepository.update({ userId: session.userId }, { lastCutReason: reason });

		// 4. markOffline 相当 + streamEnded 配信
		await this.twitchStreamsRepository.update(session.id, { isLive: false, endedAt: new Date() });
		this.globalEventService.publishTwitchLiveStream(session.id, 'streamEnded', {});
	}

	/**
	 * OME ダウン時の webhook 取り逃し自己修復: OME の listStreams() と DB の isLive/source=ome セッションを
	 * 突合し、OME 側に存在しないのに DB 上 isLive のままのセッションを offline に倒す。
	 * 2分間隔 (決定書 §2「listStreams と DB の突合を2分間隔で実施」)。
	 */
	@bindThis
	public async reconcileWithOme(): Promise<void> {
		if (this.config.ome == null) return;

		let omeStreamKeys: string[];
		try {
			omeStreamKeys = await this.omeApiService.listStreams();
		} catch (err) {
			this.logger.warn(`reconcile: listStreams failed, skipping this cycle: ${err instanceof Error ? err.message : err}`);
			return; // OME 到達不能時はセッションを勝手に閉じない (縮退方針)
		}
		const omeStreamKeySet = new Set(omeStreamKeys);

		const activeSessions = await this.twitchStreamsRepository.find({ where: { isLive: true, source: 'ome' } });
		if (activeSessions.length === 0) return;

		const channels = await this.liveChannelsRepository.findBy({ userId: In(activeSessions.map(s => s.userId)) }); // eslint-disable-line
		const channelByUserId = new Map(channels.map(c => [c.userId, c]));

		for (const session of activeSessions) {
			const channel = channelByUserId.get(session.userId);
			if (channel == null) continue;
			if (!omeStreamKeySet.has(channel.streamKey)) {
				this.logger.info(`reconcile: session ${session.id} (streamKey=${channel.streamKey}) is not present on OME, marking offline (webhook likely missed)`);
				await this.twitchStreamsRepository.update(session.id, { isLive: false, endedAt: new Date() });
				this.globalEventService.publishTwitchLiveStream(session.id, 'streamEnded', {});
			}
		}
	}
}
```

`import { In } from 'typeorm';` を追加すること (`IsNull`/`In` 等 typeorm の演算子ヘルパー、`TwitchStreamService.ts:8`
の `import { IsNull } from 'typeorm';` と同じ import 元)。

`cluster.isPrimary` ガードにより `OmeStreamMonitorService` と `OmeAdmissionService` はどちらも同一プロセスの
Redis/DB 状態を見るが、`OmeAdmissionService` (admission webhook 応答) は全 worker プロセスで動く点に注意
(`OmeServerService` は fastify サーバーの一部として各 worker で起動する)。ブラックリストと視聴者数カウントは
Redis 経由のため worker 間で共有される。ポーリング/遮断/自己修復のみ primary 限定。

---

## 8. 視聴 URL 応答: `twitch/streams/show` の拡張

現行 `packages/backend/src/server/api/endpoints/twitch/streams/show.ts` (`:13-87`) の `res` スキーマに
`sessions` 配列を **追加** する (既存フィールドは変更しない、後方互換)。決定書 §3・§4 の「アクティブセッション
配列」「プレイヤー切替」を実現する契約であり、05 (プレイヤー) がこのレスポンスを消費する。

変更前 (`streams/show.ts:29-48`、`res` の抜粋):

```ts
	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			twitchLogin: { type: 'string', optional: false, nullable: false },
			twitchDisplayName: { type: 'string', optional: false, nullable: false },
			stream: {
				type: 'object',
				optional: false, nullable: true,
				properties: {
					id: { type: 'string', format: 'misskey:id', optional: false, nullable: false },
					title: { type: 'string', optional: false, nullable: false },
					gameName: { type: 'string', optional: false, nullable: true },
					viewerCount: { type: 'number', optional: false, nullable: false },
					thumbnailUrl: { type: 'string', optional: false, nullable: true },
					startedAt: { type: 'string', format: 'date-time', optional: false, nullable: false },
				},
			},
		},
	},
```

変更後 (`sessions` フィールドを追加。`twitchLogin`/`twitchDisplayName` は Twitch 未連携ユーザーでは `notLinked`
エラーになる現行仕様を維持しつつ、`sessions` 自体は独立して返す。**エンドポイント自体を requireCredential:false
のまま `userId` 指定に切り替え、Twitch 未連携でも `sessions` だけ返せるよう `notLinked` の投げ方を調整する必要が
ある — 詳細な分岐は実装時に twitch_account の有無で判定すること**):

```ts
	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			twitchLogin: { type: 'string', optional: false, nullable: false },
			twitchDisplayName: { type: 'string', optional: false, nullable: false },
			stream: {
				type: 'object',
				optional: false, nullable: true,
				properties: {
					id: { type: 'string', format: 'misskey:id', optional: false, nullable: false },
					title: { type: 'string', optional: false, nullable: false },
					gameName: { type: 'string', optional: false, nullable: true },
					viewerCount: { type: 'number', optional: false, nullable: false },
					thumbnailUrl: { type: 'string', optional: false, nullable: true },
					startedAt: { type: 'string', format: 'date-time', optional: false, nullable: false },
				},
			},
			sessions: {
				type: 'array',
				optional: false, nullable: false,
				items: {
					type: 'object',
					optional: false, nullable: false,
					properties: {
						source: { type: 'string', optional: false, nullable: false, enum: ['twitch', 'ome'] },
						streamId: { type: 'string', format: 'misskey:id', optional: false, nullable: false },
						isLive: { type: 'boolean', optional: false, nullable: false },
						playbackUrl: { type: 'string', optional: true, nullable: false },
						twitchLogin: { type: 'string', optional: true, nullable: false },
					},
				},
			},
		},
	},
```

処理ロジック (`streams/show.ts:67-85` のハンドラを拡張、既存の `twitchAccountsRepository.findOneBy` +
`notLinked` エラーの分岐は温存):

```ts
			// 既存: account/stream (Twitch専用) の解決はそのまま
			const account = await this.twitchAccountsRepository.findOneBy({ userId: ps.userId });
			// account が null でも sessions は独立して返したいため、notLinked を即座に throw しない設計に変更
			// (実装時: account==null かつ live_channel も無い場合のみ notLinked を投げる、詳細は実装時に確定)

			const allSessions = await this.twitchStreamService.getAllLiveStreamsByUserId(ps.userId); // 新設: source非依存
			const liveChannel = await this.liveChannelService.show(ps.userId);

			const sessions = allSessions.map(s => {
				if (s.source === 'ome') {
					const ome = this.config.ome;
					return {
						source: 'ome' as const,
						streamId: s.id,
						isLive: s.isLive, // getAllLiveStreamsByUserId が isLive:true で filter 済みのため常に true だが、契約 (isLive: boolean) として明示する
					playbackUrl: (ome != null && liveChannel != null)
						? (() => {
							const hostPort = ome.publicWhipUrl.replace(/^https?:\/\//, '');
							return `ws://${hostPort}/${ome.app}/${liveChannel.streamKey}`;
						})()
							// WebRTC signalling URL。視聴側は現段階で SignedPolicy 未適用 (匿名視聴)。
							// publicWhipUrl が 'http://stream.msjp.pro:3333' 形式なら ws://...:3333 に変換。
						: undefined,
					};
				}
				return {
					source: 'twitch' as const,
					streamId: s.id,
					isLive: s.isLive,
					twitchLogin: s.twitchLogin ?? undefined,
				};
			});

			return {
				twitchLogin: account?.twitchLogin ?? '',
				twitchDisplayName: account?.twitchDisplayName ?? '',
				stream: /* 既存ロジック維持 */,
				sessions,
			};
```

`TwitchStreamService.getAllLiveStreamsByUserId(userId)` は新設メソッド (`getLiveStreamByUserId` の複数版、
`findBy({ userId, isLive: true })` を返すだけの単純な追加)。`config` の DI 注入をこの endpoint のコンストラクタに
追加する必要がある (`@Inject(DI.config) private config: Config`)。

**misskey-js 再生成が必要**: `pnpm build-misskey-js-with-types` を実行し、`sessions` フィールドを含む型が
`packages/misskey-js/src/autogen/` に反映されることを確認する。05 (プレイヤー) の `MkStreamPlayer.vue` は
`sessions` 配列を見て `source` ごとの表示切替を行う契約になる。

---

## 9. 検証

### 9-1. e2e ケース列挙

新規ファイル: `packages/backend/test/e2e/ome-admission.ts` (`test/e2e/twitch.ts` の構造を踏襲、`02-backend-
channel.md §8-3` の `live-channel.ts` と並列)。

1. **署名不正**: `X-OME-Signature` を付けず、または不正な値で `POST /ome/admission` を叩くと `403` +
   `{ allowed: false }`。
2. **未知キー拒否**: 有効な署名だが `url` のストリーム名がどの `live_channel.streamKey` にも一致しない場合、
   opening で `{ allowed: false, reason: 'unknown or disabled stream key' }`。
3. **正常 opening → セッション作成**: 有効な streamKey + `direction:incoming, status:opening` で `{ allowed: true
   }` が返り、応答後に `twitch_stream` に `source='ome', isLive=true` の行が作成されること (非同期処理の完了を
   ポーリングまたは短い待機で確認)。
4. **closing → offline**: 同一 streamKey で `direction:incoming, status:closing` を送ると該当セッションが
   `isLive=false, endedAt` 設定になり、`twitchLiveStream:{streamId}` チャンネルに `streamEnded` が配信されること。
5. **ブラックリスト拒否**: Redis に `ome:blacklist:{streamKey}` をセットした状態で opening を送ると `{ allowed:
   false, reason: 'stream key is temporarily blocked' }`。
6. **多重配信防止**: 同一チャンネルで isLive な `source='ome'` セッションがある状態で新規 opening が来ると、
   旧セッションが `isLive=false` になった上で新規セッションが許可されること。
7. **outgoing 常時許可**: `direction:outgoing` の opening は streamKey に関わらず常に `{ allowed: true }`、かつ
   `ome:viewers:{streamKey}` が INCR されること。closing で DECR されること。
8. **ビットレート監視**: `OmeApiService.getStream` をモックして 3 回連続超過を返させ、`OmeStreamMonitorService.
   pollActiveSessions()` が `deleteStream` 呼び出し・ブラックリスト登録・`isLive=false` 化を行うこと。
9. **OME ダウン時の縮退**: `OmeApiService.getStream`/`listStreams` が例外を投げ続けても、アクティブセッションが
   勝手に `isLive=false` にならないこと。

### 9-2. 手動テスト手順 (curl で admission を偽装する例)

```fish
set SECRET "<config.ome.admissionSecret の値>"
set BODY '{"client":{"address":"127.0.0.1","port":1234},"request":{"direction":"incoming","protocol":"webrtc","status":"opening","url":"http://ome.msjp-local.org:3333/live/<streamKey>?direction=whip","time":"2026-07-14T00:00:00.000Z"}}'

# HMAC-SHA1 → Base64URL 署名を生成 (node one-liner)
set SIG (node -e "
const crypto = require('crypto');
const body = process.argv[1];
const secret = process.argv[2];
const sig = crypto.createHmac('sha1', secret).update(body).digest('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+\$/, '');
console.log(sig);
" "$BODY" "$SECRET")

curl -s -X POST http://mi-host.msjp-local.org:3000/ome/admission \
  -H "Content-Type: application/json" \
  -H "X-OME-Signature: $SIG" \
  -d "$BODY" | jq
```

期待結果: streamKey が有効な `live_channel.streamKey` なら `{"allowed":true,"reason":"authorized","lifetime":0}`、
無効なら `{"allowed":false,"reason":"unknown or disabled stream key"}`。署名を意図的に崩す (`$SIG` の末尾を
1文字書き換える) と `403` + `{"allowed":false,"reason":"bad signature"}` になることを確認する。

### 9-3. check-migrations

```fish
pnpm --filter backend check-migrations
```

`AddSourceToTwitchStream` migration 適用後に pending DDL が 0 件であること。`02-backend-channel.md §3` に
記載の「`atDid`/`isBot` partial index の誤検知」と同様、TypeORM のスキーマ差分検出器が意図しない差分を
検出した場合は bsky-fork 独自の partial index 由来の既知ノイズである可能性を疑うこと。

---

## 10. 未確定事項の参照

本書中で「⚠ 未確定」として扱った項目は `00-overview.md §5` の番号で参照する:

- SignedPolicy の WHIP Provider 対応可否 → **解消済** (Phase 0 実機検証済、00-overview.md 未確定事項 #1 参照)
- OSS v1 統計 API での視聴者数取得可否 (`totalConnections`) → **未確定事項2** (§4 では Redis INCR/DECR 方式を
  実装、統計 API 併用は Phase 0 実機検証後に選択)
- WHEP egress 対応 → **未確定事項3** (本書のプレイヤー視聴 URL は独自 WebSocket signalling 前提のまま、影響小)
- `bitrateLatest`/`bitrateAvg` の実挙動 → **解消済** (00-overview.md 未確定事項 #4 参照)
- OBS WHIP の Bearer Token と SignedPolicy の統合方法 → **解消済** (WHIP URL に `policy`/`signature` クエリを付与する方式で確定、00-overview.md 未確定事項 #5 参照)
- `stream.msjp.pro` の FQDN 最終決定・WAN 公開ポリシー例外 → **未確定事項6** (本書は LAN 内動作を前提に記述、
  `config.ome.publicWhipUrl` の値は WAN 公開確定後に更新する)
