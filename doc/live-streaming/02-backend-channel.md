# 02: バックエンド — ライブチャンネル基盤 (Phase 1)

## 位置づけ

本書は配信機能拡張の実装フェーズ分割における **Phase 1 (チャンネル基盤・backend)** の詳細設計書。
上位方針は `/tmp/claude-1000/-home-vtf-projects-misskey/03326e3d-ca9c-411d-a0d8-f1802e8985a1/scratchpad/architecture-decisions.md`
(以下「決定書」) に確定済みで、本書はそれに反しない。特に決定書 §0 (命名) と §1 (チャンネルページ要件) を厳守する。

OME (OvenMediaEngine) 連携・配信開始/停止イベント処理・ビットレート監視は Phase 2 の対象であり、
`03-backend-ome.md` (未執筆、本書と連動) に記載する。**本書のスコープは Phase 1 のみ**。

## 前提

- リポジトリ実体: `/home/vtf/projects/misskey/misskey-repo` (branch: `bsky-integration`)。
  ユーザー指定パス `/home/vtf/projects/misskey` はリポジトリルートではない。
- 参照実装は `packages/backend/src/core/twitch/` 一式・`packages/backend/src/models/TwitchAccount.ts`・
  `packages/backend/migration/1783019502111-AddTwitchAccount.js`・
  `packages/backend/src/server/api/endpoints/twitch/` 配下。本書の file:line 引用はすべて
  2026-07-14 時点の現物 Read で検証済み (行番号がズレている場合は現物を優先すること)。
- 実装時は `working-on-backend` skill を必ず参照すること (本書はその代替ではない)。
- 本書の執筆者は設計書のみを作成し、実装コードのコミットは行わない。

## 完了条件チェックリスト (Phase 1)

- [ ] `live_channel` エンティティが `packages/backend/src/models/LiveChannel.ts` に追加され、SPDX ヘッダー
      (`misskey-bsky-integration fork`) を持つ
- [ ] `postgres.ts` / `models/_.ts` / `RepositoryModule.ts` / `di-symbols.ts` の 4 点に登録差分が入る
- [ ] 新規 migration が `up()`/`down()` 双方を実装し `pnpm --filter backend check-migrations` を pending DDL 0 件で通る
- [ ] `packages/backend/src/core/live/LiveChannelService.ts` が create/update/regenerateStreamKey/show/pack を実装する
- [ ] API endpoint 5 本 (`live-channels/show|create|update|regenerate-key|my`) が `endpoint-list.ts` に登録される
- [ ] `pnpm build-misskey-js-with-types` 実行後、`packages/misskey-js/src/autogen/` の差分がコミットに含まれる
- [ ] `locales/ja-JP.yml` にのみ `_liveChannel` セクションが追加される (他 locale yml は無差分)
- [ ] `packages/backend/test/e2e/live-channel.ts` が本書 §8 のケースを網羅する
- [ ] **`.config/default.yml` に `ome:` 設定が一切無い状態で全 5 endpoint が動作する** (OME 非依存で完結することが本フェーズの完了条件)

---

## 1. `live_channel` エンティティ完全定義

新規ファイル: `packages/backend/src/models/LiveChannel.ts`

参照元: `packages/backend/src/models/TwitchAccount.ts` (SPDX ヘッダー・`id()` ヘルパー・`@Index({unique:true})`
・`@ManyToOne` FK CASCADE のスタイルをそのまま踏襲)。`id()` ヘルパーの実体は
`packages/backend/src/models/util/id.ts:6-9` (`{ type: 'varchar', length: 32 }`)。

`bannerId` の FK パターンは `packages/backend/src/models/User.ts:108-119` (`bannerId` は `@Column` + `id()` +
`nullable:true`、`banner` は別途 `@OneToOne(() => MiDriveFile, { onDelete: 'SET NULL' }) @JoinColumn()`) を踏襲する。

```ts
/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, Index, PrimaryColumn, ManyToOne, OneToOne, JoinColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiDriveFile } from './DriveFile.js';

// ライブチャンネル (self-streaming, OME連携) の設定行。1 Misskey ユーザーにつき最大 1 レコード。
// 行の存在 + enabled=true が「配信機能を利用する」トグル ON を意味する (決定書 §1)。
@Entity('live_channel')
export class MiLiveChannel {
	@PrimaryColumn(id())
	public id: string;

	@Index({ unique: true })
	@Column({
		...id(),
		comment: 'The owner user. One live_channel per user.',
	})
	public userId: MiUser['id'];

	@ManyToOne(type => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	@Column('boolean', {
		default: false,
		comment: 'Whether the streaming feature is enabled for this user.',
	})
	public enabled: boolean;

	@Column('varchar', {
		length: 128, nullable: true,
		comment: 'Channel display name. Falls back to user.name / username when null.',
	})
	public name: string | null;

	@Column('varchar', {
		length: 2048, nullable: true,
		comment: 'Channel description. No fallback: hidden when null.',
	})
	public description: string | null;

	@Column({
		...id(),
		nullable: true,
		comment: 'The ID of channel banner DriveFile. Falls back to user.banner when null.',
	})
	public bannerId: MiDriveFile['id'] | null;

	@OneToOne(() => MiDriveFile, {
		onDelete: 'SET NULL',
	})
	@JoinColumn()
	public banner: MiDriveFile | null;

	@Index({ unique: true })
	@Column('varchar', {
		length: 64,
		comment: 'Ingest stream key. Used as the OME stream name.',
	})
	public streamKey: string;

	@Column('timestamp with time zone', {
		comment: 'Timestamp of the last streamKey regeneration.',
	})
	public streamKeyRegeneratedAt: Date;

	@Column('varchar', {
		length: 256, nullable: true,
		comment: 'Reason for the last forced disconnect (bitrate monitor etc). Set by Phase 2.',
	})
	public lastCutReason: string | null;

	@Column('timestamp with time zone', {
		comment: 'The creation date of the live_channel row.',
	})
	public createdAt: Date;

	constructor(data: Partial<MiLiveChannel>) {
		if (data == null) return;

		for (const [k, v] of Object.entries(data)) {
			(this as any)[k] = v;
		}
	}
}
```

備考:

- `lastCutReason` は Phase 2 (`OmeStreamMonitorService`) が書き込む列だが、テーブル分割の手戻りを避けるため
  Phase 1 のスキーマに含める。Phase 1 のコードはこの列を読み書きしない (常に `null`)。
- `TwitchAccount.ts` と異なり `userId` は non-null (bot アカウント概念がライブチャンネルには存在しないため)。
- `createdAt` は `TwitchAccount.ts` には存在しない列だが、`id()` から `IdService.parse(id).date` で導出可能なため
  本来は冗長。ただし要件定義 (本タスクの指示) が明示的に `createdAt` カラムを要求しているため列として持たせる。

## 2. 登録 4 点セット

Twitch 実装 (`MiTwitchAccount`) の登録箇所を現物確認した最新行番号 (2026-07-14 時点)。**新規追加時は
アルファベット順の挿入位置を守ること** (既存ファイルはインポート/配列とも `Mi*` のアルファベット順)。

### 2-1. `packages/backend/src/postgres.ts`

- import 追加位置: `:63` `MiTwitchAccount` の直前 (`MiLiveChannel` は `L` なので `MiUser` 系のアルファベット順に
  合わせると `MiRelay` (無し、参考: `:58 MiRelay` `:59 MiRemoteGuestAccount`) の後、`MiSignin` (`:61`) の前あたり。
  実際のアルファベット順基準では `L` は `MiRegistrationTicket`(`:56`)〜`MiRelay`(`:58`) の前に入る)。
  厳密な挿入位置は実装時に周辺の import ブロック全体 (`postgres.ts:1-70` 付近) を Read し、命名のアルファベット順
  に従って挿入すること — 本書は Twitch 分の挿入パターンのみを保証し、`L` 帯の正確な行はコード変更で移動しうる。
  ```ts
  import { MiLiveChannel } from '@/models/LiveChannel.js';
  ```
- entities 配列追加位置: `postgres.ts:205` `MiTwitchAccount,` と同じブロック (`:198-212` 付近) にアルファベット順で
  `MiLiveChannel,` を追加。

### 2-2. `packages/backend/src/models/_.ts`

- import: `_.ts:75` (`MiTwitchAccount`) と同ブロック、アルファベット順で挿入。
- クラス配列: `_.ts:157` (`MiTwitchAccount,`) と同ブロック、アルファベット順で挿入。
- Repository 型 export: `_.ts:244` の直前後に以下を追加 (アルファベット順で `L` 帯、`TwitchAccountsRepository` より前):
  ```ts
  export type LiveChannelsRepository = Repository<MiLiveChannel> & MiRepository<MiLiveChannel>;
  ```

### 2-3. `packages/backend/src/models/RepositoryModule.ts`

- import: `:70` (`MiTwitchAccount`) と同ブロックにアルファベット順で追加。
- provider 定義 (`:560-564` の `$twitchAccountsRepository` と同型) を追加:
  ```ts
  const $liveChannelsRepository: Provider = {
  	provide: DI.liveChannelsRepository,
  	useFactory: (db: DataSource) => db.getRepository(MiLiveChannel).extend(miRepository as MiRepository<MiLiveChannel>),
  	inject: [DI.db],
  };
  ```
- `providers: [...]` 配列 (`:676` 付近、`$twitchAccountsRepository,` と同じ配列) と
  `exports: [...]` 配列 (`:761` 付近、同名の 2 箇所目) の **両方** に `$liveChannelsRepository,` を追加すること。
  この 2 箇所は同じ定数名の重複列挙であり (NestJS の `providers`/`exports` 各配列)、片方だけ追加すると
  DI 解決に失敗する。

### 2-4. `packages/backend/src/di-symbols.ts`

`di-symbols.ts:95` (`twitchAccountsRepository: Symbol('twitchAccountsRepository'),`) と同じ `#region` ブロックに:
```ts
liveChannelsRepository: Symbol('liveChannelsRepository'),
```

### 2-5. `packages/backend/src/core/CoreModule.ts` (research-codebase 未記載、本書で追加確認)

Twitch の各 service は `core/twitch/*.ts` に置かれ、`CoreModule.ts` に **4 箇所** 登録されている
(`import` → `:163-171`、`useExisting` provider 定義 → `:343-351`、`providers` 配列 → `:522-530` および
`:874-882` の 2 箇所、`exports` 相当 `$TwitchXxxService` 配列 → `:700-708` および `:1050-1058` の 2 箇所)。
`LiveChannelService` も同型で 4 箇所 (import・`$LiveChannelService` provider 定義・providers 配列 2 箇所・
exports 配列 2 箇所) への追加が必要。**この 5 点目の登録漏れは DI 解決エラーとして起動時に判明するため、
実装時は `CoreModule.ts` 全体を Read し `Twitch` で検索して重複箇所をすべて洗い出すこと。**

## 3. Migration

新規ファイル: `packages/backend/migration/{unixMs}-AddLiveChannel.js`

タイムスタンプ取得: `node -e "console.log(Date.now())"` (AGENTS.md 記載のコマンドをそのまま使う。実行結果の
数値をファイル名とクラス名の末尾に使う。本書では `1783200000000` を仮値として示すが実装時に必ず取り直すこと)。

参照元 `packages/backend/migration/1783019502111-AddTwitchAccount.js` は先頭コメントで
「`migration:generate` が出力する `atDid` 関連の DDL (`IDX_user_atDid` の DROP/COMMENT) は bsky 統合の
partial index を壊すため手で除去してある」と明記している。**`pnpm typeorm migration:generate` を使う場合は
必ず生成後の SQL を目視確認し、`user` テーブルの `atDid` / `isBot` 系 partial index に対する意図しない
DROP/CREATE が混入していないか確認すること** (check-migrations の既知ノイズ)。これらは bsky-fork 独自の
partial unique index であり、TypeORM のスキーマ差分検出器が「意図しない差分」として誤検知することがある。

```js
/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ライブチャンネル (self-streaming, OME連携) 設定テーブル (fork 独自)。
// 1ユーザー1チャンネル (userId unique index)。streamKey は OME ingest 側の stream 名として使う (unique index)。

export class AddLiveChannel1783200000000 {
    name = 'AddLiveChannel1783200000000'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "live_channel" ("id" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "enabled" boolean NOT NULL DEFAULT false, "name" character varying(128), "description" character varying(2048), "bannerId" character varying(32), "streamKey" character varying(64) NOT NULL, "streamKeyRegeneratedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "lastCutReason" character varying(256), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_live_channel_id" PRIMARY KEY ("id")); COMMENT ON COLUMN "live_channel"."userId" IS 'The owner user. One live_channel per user.'; COMMENT ON COLUMN "live_channel"."name" IS 'Channel display name. Falls back to user.name / username when null.'; COMMENT ON COLUMN "live_channel"."description" IS 'Channel description. No fallback: hidden when null.'; COMMENT ON COLUMN "live_channel"."bannerId" IS 'The ID of channel banner DriveFile. Falls back to user.banner when null.'; COMMENT ON COLUMN "live_channel"."streamKey" IS 'Ingest stream key. Used as the OME stream name.'; COMMENT ON COLUMN "live_channel"."lastCutReason" IS 'Reason for the last forced disconnect (bitrate monitor etc). Set by Phase 2.'`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_live_channel_userId" ON "live_channel" ("userId")`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_live_channel_streamKey" ON "live_channel" ("streamKey")`);
        await queryRunner.query(`ALTER TABLE "live_channel" ADD CONSTRAINT "FK_live_channel_userId" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "live_channel" ADD CONSTRAINT "FK_live_channel_bannerId" FOREIGN KEY ("bannerId") REFERENCES "drive_file"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "live_channel" DROP CONSTRAINT "FK_live_channel_bannerId"`);
        await queryRunner.query(`ALTER TABLE "live_channel" DROP CONSTRAINT "FK_live_channel_userId"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_live_channel_streamKey"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_live_channel_userId"`);
        await queryRunner.query(`DROP TABLE "live_channel"`);
    }
}
```

制約名 (`PK_live_channel_id` 等) は TypeORM の自動生成ハッシュ名と一致しなくても機能上は問題ないが、
`check-migrations` は「スキーマ全体の差分が 0 件」を見るツールであり、TypeORM が自動生成する制約名
(ハッシュ付き、例 `PK_47348a1e4f1a9682eea36fc73d2`) と手書きの分かりやすい名前が食い違うと **check-migrations が
「制約名の差分」を pending DDL として検出する可能性がある**。実装時は先に空の `up()`/`down()` で
migration ファイルを作り、`pnpm --filter backend migration:generate` (もしくは TypeORM の
schema sync dry-run) で実際に生成される制約名を確認し、それをそのまま SQL に転記することを推奨する
(`AddTwitchAccount.js:18` の `PK_47348a1e4f1a9682eea36fc73d2` のようなハッシュ名が実例)。

## 4. `LiveChannelService.ts`

新規ファイル: `packages/backend/src/core/live/LiveChannelService.ts`

`secureRndstr` の実在確認済み: `packages/backend/src/misc/secure-rndstr.ts:11`
`export function secureRndstr(length = 32, { chars = LU_CHARS } = {}): string`。デフォルト引数のまま
`secureRndstr()` を呼べば 32 文字の英数字乱数が得られる (決定書の「32 文字 URL-safe 乱数」を満たす —
`LU_CHARS` は英数字のみで URL-safe)。import は `import { secureRndstr } from '@/misc/secure-rndstr.js';`。

pack の owner-only 分岐は `packages/backend/src/core/entities/ClipEntityService.ts:56` の
`notesCount: (meId === clip.userId) ? await ... : undefined` パターンを踏襲する
(`meId === liveChannel.userId` で `streamKey` の出し分けを行う)。

```ts
/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { LiveChannelsRepository, MiUser } from '@/models/_.js';
import type { MiLiveChannel } from '@/models/LiveChannel.js';
import { IdService } from '@/core/IdService.js';
import { bindThis } from '@/decorators.js';
import { secureRndstr } from '@/misc/secure-rndstr.js';

@Injectable()
export class LiveChannelService {
	constructor(
		@Inject(DI.liveChannelsRepository)
		private liveChannelsRepository: LiveChannelsRepository,

		private idService: IdService,
	) {
	}

	// 有効化 (= 「配信機能を利用する」トグル ON)。既に行が存在する場合は ALREADY_EXISTS として呼び出し側でエラーにする
	// (endpoint 側で事前に show() の結果を見て判定する。ここでは単純作成のみ行う)。
	@bindThis
	public async create(userId: MiUser['id']): Promise<MiLiveChannel> {
		const now = new Date();
		const created = await this.liveChannelsRepository.insert(new MiLiveChannel({
			id: this.idService.gen(),
			userId,
			enabled: true,
			name: null,
			description: null,
			bannerId: null,
			streamKey: secureRndstr(),
			streamKeyRegeneratedAt: now,
			lastCutReason: null,
			createdAt: now,
		})).then(x => this.liveChannelsRepository.findOneByOrFail(x.identifiers[0]));

		return created;
	}

	// name/description/bannerId/enabled の部分更新。undefined のフィールドは変更しない (twitch/update-settings.ts と同型)。
	@bindThis
	public async update(userId: MiUser['id'], params: {
		enabled?: boolean;
		name?: string | null;
		description?: string | null;
		bannerId?: string | null;
	}): Promise<MiLiveChannel> {
		const channel = await this.liveChannelsRepository.findOneByOrFail({ userId });

		const update: Partial<MiLiveChannel> = {};
		if (params.enabled !== undefined) update.enabled = params.enabled;
		if (params.name !== undefined) update.name = params.name;
		if (params.description !== undefined) update.description = params.description;
		if (params.bannerId !== undefined) update.bannerId = params.bannerId;

		if (Object.keys(update).length > 0) {
			await this.liveChannelsRepository.update(channel.id, update);
		}

		return await this.liveChannelsRepository.findOneByOrFail({ id: channel.id });
	}

	// 新乱数を発行し既存キーを置換する。Phase 2 では OME REST DELETE で旧キーの接続を切断する処理をここに追加する
	// (決定書 §2「ストリームキーと SignedPolicy」)。Phase 1 では乱数の入れ替えのみ行う。
	@bindThis
	public async regenerateStreamKey(userId: MiUser['id']): Promise<MiLiveChannel> {
		const channel = await this.liveChannelsRepository.findOneByOrFail({ userId });
		const now = new Date();

		await this.liveChannelsRepository.update(channel.id, {
			streamKey: secureRndstr(),
			streamKeyRegeneratedAt: now,
		});

		return await this.liveChannelsRepository.findOneByOrFail({ id: channel.id });
	}

	@bindThis
	public async show(userId: MiUser['id']): Promise<MiLiveChannel | null> {
		return await this.liveChannelsRepository.findOneBy({ userId });
	}

	// meId === channel.userId のときのみ streamKey を含める (ClipEntityService.ts:56 と同型のパターン)。
	@bindThis
	public async pack(
		src: MiLiveChannel['id'] | MiLiveChannel,
		me?: { id: MiUser['id'] } | null | undefined,
	) {
		const meId = me ? me.id : null;
		const channel = typeof src === 'object' ? src : await this.liveChannelsRepository.findOneByOrFail({ id: src });
		const isOwner = meId === channel.userId;

		return {
			id: channel.id,
			userId: channel.userId,
			enabled: channel.enabled,
			name: channel.name,
			description: channel.description,
			bannerId: channel.bannerId,
			createdAt: channel.createdAt.toISOString(),
			// 所有者のみ: ストリームキーと再生成日時
			streamKey: isOwner ? channel.streamKey : undefined,
			streamKeyRegeneratedAt: isOwner ? channel.streamKeyRegeneratedAt.toISOString() : undefined,
			lastCutReason: isOwner ? channel.lastCutReason : undefined,
		};
	}
}
```

`IdService.gen()` の使い方は既存の `TwitchOAuthService.ts` 等 (`core/twitch/` 配下の insert 処理) と同型。
実装時に `core/twitch/TwitchOAuthService.ts` の `handleCallback` 内の upsert 箇所を Read して ID 生成呼び出し
規約 (`this.idService.gen()` の引数の有無) を確認すること — 本書では `idService.gen()` を引数無しで示したが、
現物のシグネチャ (タイムスタンプ引数の要否) は `packages/backend/src/core/IdService.ts` を実装直前に確認する。

## 5. API endpoint 5 本

配置: `packages/backend/src/server/api/endpoints/live-channels/{show,create,update,my}.ts` および
`live-channels/regenerate-key.ts`。参照元は `endpoints/twitch/streams/show.ts` (認証不要パターン) と
`endpoints/twitch/update-settings.ts` (`secure:true` + 所有者更新パターン)。

`requireCredential`/`secure`/`kind` は決定書 §1 の記載通り:

| endpoint | requireCredential | kind | secure |
|---|---|---|---|
| `live-channels/show` | false | — | — |
| `live-channels/create` | true | `write:account` | true |
| `live-channels/update` | true | `write:account` | true |
| `live-channels/regenerate-key` | true | `write:account` | true |
| `live-channels/my` | true | `read:account` | true |

### 5-1. `live-channels/show.ts`

未ログイン/リモートゲストから `/live/:acct` チャンネルページが到達可能なため `requireCredential: false`
(`twitch/streams/show.ts:16` と同じ理由づけ)。`streamKey` 等の秘匿フィールドは `pack()` の owner 判定で
自動的に `undefined` になるため、endpoint 側で追加のマスキングは不要。

```ts
/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { LiveChannelService } from '@/core/live/LiveChannelService.js';

export const meta = {
	tags: ['live-channel'],

	requireCredential: false,

	description: '指定ユーザーのライブチャンネル設定を返す。チャンネル未開設 (live_channel 行が無い) 場合は NO_SUCH_CHANNEL。' +
		'ストリームキー等の秘匿フィールドは本人がログインしている場合のみ返す。',

	errors: {
		noSuchChannel: {
			message: 'The user has no live channel.',
			code: 'NO_SUCH_CHANNEL',
			id: '7c9f1f2e-2f3a-4b1a-9b3a-9b7b6a1c2d3e',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			id: { type: 'string', format: 'misskey:id', optional: false, nullable: false },
			userId: { type: 'string', format: 'misskey:id', optional: false, nullable: false },
			enabled: { type: 'boolean', optional: false, nullable: false },
			name: { type: 'string', optional: false, nullable: true },
			description: { type: 'string', optional: false, nullable: true },
			bannerId: { type: 'string', format: 'misskey:id', optional: false, nullable: true },
			createdAt: { type: 'string', format: 'date-time', optional: false, nullable: false },
			streamKey: { type: 'string', optional: true, nullable: false },
			streamKeyRegeneratedAt: { type: 'string', format: 'date-time', optional: true, nullable: false },
			lastCutReason: { type: 'string', optional: true, nullable: true },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
	},
	required: ['userId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private liveChannelService: LiveChannelService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const channel = await this.liveChannelService.show(ps.userId);
			if (channel == null) throw new ApiError(meta.errors.noSuchChannel);

			return await this.liveChannelService.pack(channel, me);
		});
	}
}
```

### 5-2. `live-channels/create.ts`

自チャンネルの有効化。二重作成は `ALREADY_EXISTS` で拒否 (§8 e2e ケース参照)。

```ts
export const meta = {
	tags: ['live-channel', 'account'],
	requireCredential: true,
	kind: 'write:account',
	secure: true,
	description: 'ライブチャンネル (自己配信) 機能を有効化する。既に live_channel 行があれば ALREADY_EXISTS。',
	limit: { duration: 60 * 1000, max: 5 },
	errors: {
		alreadyExists: {
			message: 'You already have a live channel.',
			code: 'ALREADY_EXISTS',
			id: '3b2a1c9e-... (実装時に uuid 新規発行)',
		},
	},
	res: { /* live-channels/show.ts の res と同一構造。実装時は共通スキーマに切り出しを検討 */ },
} as const;

// paramDef: {} (作成時パラメータなし。name/description/banner は update で別途設定)

// 処理: liveChannelService.show(me.id) が非 null なら ALREADY_EXISTS、
// null なら liveChannelService.create(me.id) → pack(created, me) を返す。
```

### 5-3. `live-channels/update.ts`

自チャンネルの `enabled`/`name`/`description`/`bannerId` 更新。`twitch/update-settings.ts:43-49` の
`paramDef` (全フィールド optional, `required: []`) と同型。

```ts
export const paramDef = {
	type: 'object',
	properties: {
		enabled: { type: 'boolean' },
		name: { type: 'string', nullable: true, maxLength: 128 },
		description: { type: 'string', nullable: true, maxLength: 2048 },
		bannerId: { type: 'string', format: 'misskey:id', nullable: true },
	},
	required: [],
} as const;

// errors.noSuchChannel (live_channel 未作成で update を呼んだ場合)
// 処理: liveChannelService.update(me.id, ps) → pack(updated, me)
```

`bannerId` の Drive ファイル所有者検証 (他人の Drive ファイルを bannerId に指定できないようにする) は
`packages/backend/src/models/User.ts` の `bannerId` 更新エンドポイント (`i/update.ts` 等) の検証パターンを
実装時に確認し、同等のガードを追加すること (本書は方針のみ明記、詳細実装は Phase 1 実装時に該当ファイルを
Read して踏襲する)。

### 5-4. `live-channels/regenerate-key.ts`

```ts
export const meta = {
	tags: ['live-channel', 'account'],
	requireCredential: true,
	kind: 'write:account',
	secure: true,
	description: 'ストリームキーを再生成する。旧キーは即座に無効化される。' +
		'Phase 2 (OME 連携) では旧キーでの既存接続も強制切断するが、Phase 1 では乱数の入れ替えのみ行う。',
	limit: { duration: 60 * 1000, max: 5 },
	errors: { noSuchChannel: { /* live-channels/show.ts と同一 */ } },
	res: { /* streamKey/streamKeyRegeneratedAt を含む show.ts の res と同一構造 */ },
} as const;

// paramDef: {}
// 処理: liveChannelService.regenerateStreamKey(me.id) → pack(regenerated, me)
```

### 5-5. `live-channels/my.ts`

自分のチャンネル (未作成なら `channel: null` を返す — `create` を促す UI のため例外にしない)。

```ts
export const meta = {
	tags: ['live-channel', 'account'],
	requireCredential: true,
	kind: 'read:account',
	secure: true,
	description: '自分のライブチャンネル設定を返す。未開設なら channel: null。',
	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			channel: { type: 'object', optional: false, nullable: true, ref: /* 実装時に show.ts と共通の res スキーマ参照名を定義 */ },
			// ingest 接続情報 (secure:true の所有者専用 endpoint のためレスポンス直下に返す)
			streamKey: { type: 'string', optional: false, nullable: true }, // channel 未開設時のみ null
			whipUrl: { type: 'string', optional: false, nullable: true },
		},
	},
} as const;

// paramDef: {}
// 処理: const channel = await liveChannelService.show(me.id);
//       if (channel == null) return { channel: null, streamKey: null, whipUrl: null };
//       const urls = config.ome != null ? liveChannelService.generateIngestUrls(channel, config.ome) : null; // 03 §6
//       return {
//         channel: await liveChannelService.pack(channel, me),
//         streamKey: channel.streamKey,
//         whipUrl: urls?.whip ?? null,
//       };
```

`whipUrl` の値は 03 §6 の `LiveChannelService.generateIngestUrls()` を **endpoint ハンドラ内から呼んで組み立てる** (`pack()` には入れない — pack は公開情報用であり、ingest URL は所有者専用情報のため)。`config.ome` 未設定時は `whipUrl` を null で返す (streamKey は返す)。

**段階実装注記**: `generateIngestUrls()` は Phase 2 で実装される。Phase 1 (WI-1.3) 時点の本 endpoint は上記 res スキーマのまま、OME 連携が WI-2.6 で `generateIngestUrls` を接続するまでは `whipUrl` を null 固定で返す。

### endpoint-list.ts への追記位置

`packages/backend/src/server/api/endpoint-list.ts:466-482` の twitch ブロック
(`// twitch (Twitch 連携、private fork 専用)` コメントから始まる) に倣い、独立したコメントブロックを新設する。
挿入位置はファイル全体のアルファベット順配置に従うため、実装時に `endpoint-list.ts` 全体の並び規則
(概ねパス名のアルファベット順) を確認して `live-channels` の挿入箇所を決めること。追記内容:

```ts
// live-channels (ライブチャンネル基盤、fork 独自)
export * as 'live-channels/show' from './endpoints/live-channels/show.js';
export * as 'live-channels/create' from './endpoints/live-channels/create.js';
export * as 'live-channels/update' from './endpoints/live-channels/update.js';
export * as 'live-channels/regenerate-key' from './endpoints/live-channels/regenerate-key.js';
export * as 'live-channels/my' from './endpoints/live-channels/my.js';
```

## 6. `/live` 一覧 API の OME 対応拡張方針 (方針のみ、実装は 03 と連動)

現行 `twitch/live-streams.ts` (`packages/backend/src/server/api/endpoints/twitch/live-streams.ts`) は
`TwitchStreamService.getAllLiveStreams()` の結果のみを返す (`requireCredential: true`, `kind: 'read:account'`)。

決定書 §3 により配信セッションは `twitch_stream` テーブルを `source` カラム (`'twitch'|'ome'`) で汎用化して
共用する方針が確定している。したがって Phase 2 (`03-backend-ome.md`) 側で:

1. `twitch_stream` に `source varchar(16) NOT NULL DEFAULT 'twitch'` を追加する migration
2. `TwitchStreamService.getAllLiveStreams()` (または汎用化リネームした同等メソッド) を `source` に依存せず
   全 `isLive=true` 行を返すよう拡張
3. `live-streams.ts` のレスポンス項目に `source: 'twitch'|'ome'` を追加し、`ome` の場合は `twitchLogin` の代わりに
   `live_channel` から `streamKey`/`name` 等を解決して返す

を行う。**本書 (Phase 1) はこの拡張を実装しない。** Phase 1 で作る `live_channel` テーブルと `live-channels/*`
endpoint は `twitch_stream` を一切参照せず独立して完結する (完了条件チェックリスト参照)。

## 7. i18n: `locales/ja-JP.yml` への追記

**`ja-JP.yml` 以外の locale yml は絶対に編集しないこと** (AGENTS.md 絶対禁止事項#2、Crowdin 自動配信により
次回同期で上書き喪失する)。挿入位置は既存 `_twitch:` セクション (`locales/ja-JP.yml:3667` 開始) の直後などに
新セクション `_liveChannel:` を追加する。

| キー | 日本語文言 |
|---|---|
| `liveChannelSettings` | "ライブチャンネル設定" |
| `enableStreaming` | "配信機能を利用する" |
| `enableStreamingDescription` | "MSJP配信 (自己ホスト配信サーバー経由でのライブ配信) 機能を有効にします。" |
| `channelName` | "チャンネル名" |
| `channelNamePlaceholder` | "未設定の場合はユーザー名が表示されます" |
| `channelDescription` | "チャンネル説明" |
| `channelBanner` | "チャンネルバナー" |
| `changeBanner` | "バナーを変更" |
| `streamKey` | "ストリームキー" |
| `streamKeyDescription` | "配信ソフト (OBS 等) の設定に使用します。他人に知られると勝手に配信されるおそれがあるため、取り扱いに注意してください。" |
| `regenerateStreamKey` | "ストリームキーを再生成" |
| `regenerateStreamKeyConfirm` | "ストリームキーを再生成しますか？ 現在配信中の場合、配信が切断されます。" |
| `regenerateStreamKeySuccess` | "ストリームキーを再生成しました。" |
| `alreadyStreamingChannel` | "既にライブチャンネルを開設しています。" |
| `noSuchLiveChannel` | "このユーザーはライブチャンネルを開設していません。" |
| `channelHome` | "チャンネルホーム" |
| `followChannel` | "チャンネルをフォロー" |
| `lastCutReason` | "直近の強制切断理由" |

Phase 3/4 (フロントエンド) 側で追加のキーが必要になった場合も、必ず `ja-JP.yml` のみへ追記する。

## 8. 検証手順

### 8-1. 静的検証

```fish
pnpm --filter backend check-migrations   # 新規 migration の up() 後に pending DDL 0 件であること
pnpm lint                                 # typecheck + eslint (全パッケージ)
pnpm build-misskey-js-with-types          # endpoint の meta/paramDef/res から misskey-js/src/autogen/ を再生成
```

`check-migrations` の実体は `packages/backend/scripts/check_migrations_clean.js` (`package.json:33`)。
既知ノイズ (§3 参照): `atDid`/`isBot` partial index に対する意図しない DROP/CREATE が生成された場合は
bsky-fork 独自の partial unique index に対する誤検知なので、migration ファイルから該当行を手で除去する。

### 8-2. 手動 curl 例

`.config/default.yml` に `ome:` が無い状態 (Phase 1 完了条件) で全て通ることを確認する。

```fish
# 有効化 (自分のチャンネル作成)
curl -s https://mi.msjp.pro/api/live-channels/create \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}' | jq

# 自分のチャンネル確認 (streamKey が返ること)
curl -s https://mi.msjp.pro/api/live-channels/my \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}' | jq

# 他人からの閲覧 (streamKey が返らないこと)
curl -s https://mi.msjp.pro/api/live-channels/show \
  -H 'Content-Type: application/json' -d '{"userId":"<自分のuserId>"}' | jq '.streamKey'
# → null (undefined はJSONではキー省略またはnullとして表現される。実装時にjson-schemaのoptional挙動を確認)

# ストリームキー再生成
curl -s https://mi.msjp.pro/api/live-channels/regenerate-key \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}' | jq '.streamKey'
```

### 8-3. e2e テスト

新規ファイル: `packages/backend/test/e2e/live-channel.ts`。参照元 `test/e2e/twitch.ts:1-20`
(SPDX ヘッダー、`process.env.NODE_ENV = 'test'`、`initTestDb`/`signup`/`api`/`castAsError` の import、
`describe`/`beforeAll`/`test` の構造) をそのまま踏襲する。`.config/test.yml` が無ければ
`ncp .github/misskey/test.yml .config/test.yml` で作成すること (AGENTS.md 記載)。

ケース列挙:

1. 未設定時 (`live_channel` 行が無い状態): `live-channels/show` が `NO_SUCH_CHANNEL` を返す
2. 未設定時: `live-channels/my` が `{ channel: null }` を返す
3. `live-channels/create` で有効化できる (`enabled: true`, `streamKey` が32文字であること)
4. 二重作成拒否: 2 回目の `live-channels/create` が `ALREADY_EXISTS` を返す
5. 他人のキー不可視: A が作成したチャンネルを B が `live-channels/show` で見ても `streamKey` フィールドが
   存在しない (or `undefined`) こと。A 自身が `live-channels/show` (自分の userId 指定) で見ると
   `streamKey` が含まれること
6. 再生成: `live-channels/regenerate-key` 呼び出し前後で `streamKey` が変化し、`streamKeyRegeneratedAt` が
   更新されること
7. `live-channels/update` で `name`/`description`/`enabled` を更新できること (undefined のフィールドは
   変更されないこと)
8. 未認証で `live-channels/create`/`update`/`regenerate-key`/`my` を呼ぶと 401 になること
   (`live-channels/show` のみ未認証可)
9. 存在しない `userId` で `live-channels/show` を呼ぶと `NO_SUCH_CHANNEL` になること

## 9. Phase 1 完了条件の再確認

本フェーズで新設・変更するファイルは以下に限られ、いずれも `config.ome` の有無に依存しない:

- `packages/backend/src/models/LiveChannel.ts` (新規)
- `packages/backend/src/postgres.ts` / `models/_.ts` / `models/RepositoryModule.ts` / `di-symbols.ts` (差分)
- `packages/backend/migration/{unixMs}-AddLiveChannel.js` (新規)
- `packages/backend/src/core/live/LiveChannelService.ts` (新規)
- `packages/backend/src/core/CoreModule.ts` (差分)
- `packages/backend/src/server/api/endpoints/live-channels/*.ts` (新規5ファイル)
- `packages/backend/src/server/api/endpoint-list.ts` (差分)
- `packages/misskey-js/src/autogen/` (再生成)
- `locales/ja-JP.yml` (差分)
- `packages/backend/test/e2e/live-channel.ts` (新規)

OME REST API・AdmissionWebhooks・ビットレート監視・`config.ome` は一切参照しない。これにより
`.config/default.yml` に `ome:` セクションが存在しない環境 (現行本番含む) でも Phase 1 の全 endpoint が
正常に動作することが本フェーズの完了条件である。
