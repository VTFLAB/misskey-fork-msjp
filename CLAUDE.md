# Misskey – Claude Code Guide (bsky-integration fork)

このリポジトリは Misskey upstream の **私的 fork** で、目的は Bluesky (AT Protocol) の public post を Misskey 内に取り込む inbound 統合の実装。詳細は本文末尾を参照。

## Upstream の規約 (継承)

ルール本体は [AGENTS.md](AGENTS.md) (Codex / Copilot と共有する単一ソース)。本ファイルは Claude Code 用の薄いラッパーで、`@AGENTS.md` 構文で本体規約をセッション開始時にコンテキストへ展開する。

Claude Code 固有の補助 (skills / agents / slash commands / docs) は `.claude/` 配下にコミット済。個人ローカル設定は `.claude/settings.local.json` に、MCP 認証情報は `.claude/.credentials.json` に置く (いずれも `.gitignore` 済)。

@AGENTS.md

---

# Fork 固有: misskey-bsky-fork

ここから下は **fork オリジナル**。Upstream には絶対送らない。Upstream CLAUDE.md (上の `@AGENTS.md` まで) は最小 diff で維持し、rebase 時の conflict を避ける。

## プロジェクト目的

- Misskey 1 画面で Twitter 移行組の Bluesky 公式アカウント等を購読表示
- **inbound only** (Bsky → Misskey 表示のみ、Misskey → Bsky 投稿は実装しない)
- **anonymous** (自前 Bsky account / OAuth / app password 不要、public AppView API のみ使う)
- **自分 1 人用の private fork** (公開しない、Bridgy Fed 系の consent 論争を回避)

### 非スコープ (明確に「やらない」もの)

- 自分の Bsky account を紐付けて投稿 (Phase 2 候補、現状実装しない)
- reaction の Bsky federation (Bsky は Like のみで custom emoji mapping 不能)
- LTL への Bsky post 流入 (wrapping 戦術で自動的に除外)
- Bridgy Fed 経由統合 (相手の opt-in 必須、対象が応じない bot/公式アカウントのため却下)
- AiScript plugin での実装 (client-side only で外部 HTTP 不可、structural に無理)

### 動機 / 経緯

- 検討した代替案と却下理由:
  - **A. 外部 bot で Bsky → Misskey 転写**: 第三者 post を勝手に転載する灰色運用、却下
  - **B. fork で server-level 統合** ← **採用**
  - **C. Bridgy Fed**: 対象が bot/公式アカウントで opt-in 窓口なし、却下
  - **D. 2 画面運用 (Phanpy + Misskey)**: 統合という目的を達成しない、却下
- 工数評価: 1-2 週間専念で Phase 1 (= inbound 統合) 完成見込み
- Firefish (Misskey fork) の燃え尽き廃止事例を踏まえ、**fork patch は最小侵襲・private 運用** で炎上回避

## 設計の核

### Wrapping 戦術 (Misskey 改造を最小化)

- Bsky user = `host='bsky.social'` の **pseudo-remote `MiUser`** として表現
  - `uri='at://did:plc:xxx'` (AT Protocol URI)
  - 新規 column `atDid` (DID 保持、partial unique index で null は許容、DID は global unique)
- Bsky post を `userHost IS NOT NULL` の note として既存 `NoteCreateService.create()` で生成
- 既存 timeline query を**一切改造しない**:
  - LTL: `userHost IS NULL` filter で Bsky 自動除外 ✓
  - HTL: follow ベース、pseudo-MiUser を follow すれば流入 ✓
  - GTL: `userHost IS NOT NULL` も含むので自動流入 ✓
- upstream rebase は `core/atproto/` 以外無侵入 → 月 1 minor で 30 分以内の見込み

### Fork base

- upstream: `github.com/misskey-dev/misskey` **v2026.5.3** (現運用 CT 200 mi-host と同 version)
- branch: `bsky-integration`
- 公開しない: private repo on Gitea (`git.msjp.pro`)

### 認証 / 取得経路

- Bsky **AppView** (`https://public.api.bsky.app`) を anonymous で叩く
  - `app.bsky.actor.searchActors` — 検索
  - `app.bsky.actor.getProfile` — profile 取得 (avatar / displayName / description)
  - `app.bsky.feed.getAuthorFeed` — backfill / 必要時 fetch
- **DID 解決**: `plc.directory` (PLC DID) + `.well-known/atproto-did` (did:web)
- **Subscription**: **Jetstream** (`wss://jetstream2.us-east.bsky.network/subscribe`、anonymous、wantedDids filter で帯域制御)
- 自前 PDS は持たない、write endpoint は呼ばない

## ファイル構成

```
packages/backend/
├── migration/
│   └── 1779174024562-AddAtDidToUser.js     [完了] 新 column 追加
├── src/
│   ├── models/
│   │   └── User.ts                         [完了] atDid: string | null 追加
│   └── core/
│       ├── CoreModule.ts                   [完了] AtpXxx の flat 登録 (12 か所追記)
│       └── atproto/                        全 atproto 関連 service
│           ├── AtpLoggerService.ts         [完了] sub-logger
│           ├── AtpHttpClientService.ts     [完了] AppView/PLC への anonymous HTTP
│           ├── AtpDidResolver.ts           [Task #5]
│           ├── AtpPersonService.ts         [Task #5]
│           ├── AtpSearchService.ts         [Task #6]
│           ├── AtpJetstreamService.ts      [Task #7]
│           └── AtpNoteService.ts           [Task #8]
└── src/server/api/endpoints/atproto/
    └── search.ts                           [Task #6]

packages/frontend/src/
└── pages/search.* (該当 Vue file)          [Task #9] Bluesky tab 追加
```

## 進捗

完了 (2026-05-19、`/mnt/data/seafile/documents/homelab-ops/` から着手したセッション):

- [x] #1: Bsky AppView anonymous API + Jetstream 動作確認 (token 不要、Jetstream 15.6 events/sec 受信)
- [x] #2: Misskey 2026.5.3 を `~/Document/misskey-bsky-fork/` に shallow clone、`bsky-integration` branch
- [x] #3: DB migration `1779174024562-AddAtDidToUser.js` (partial unique index)
- [x] #4: AtpLoggerService + AtpHttpClientService + CoreModule flat 登録 (AtpModule 別 module 化は circular import で却下、Misskey 流儀の flat 列挙に統一)

残り:

- [ ] #5: AtpDidResolver (plc.directory + did:web) + AtpPersonService (DID → pseudo-MiUser upsert、profile fetch、avatar URL 取扱い)
- [ ] #6: AtpSearchService (searchActors wrap) + `/api/atproto/search` endpoint (Misskey の endpoint registration 含む)
- [ ] #7: AtpJetstreamService (WS subscriber、reconnect、cursor 永続化、BullMQ worker、wantedDids 動的更新)
- [ ] #8: AtpNoteService (lexicon → MFM、facets / embed / reply chain、NoteCreateService 呼び出し、repost 処理)
- [ ] #9: Frontend "Bluesky" tab in 検索画面 (Vue 3 component、`/api/atproto/search` 呼び出し、follow ボタン)
- [ ] #10: E2E 検証 (search → follow → post 流入 → HTL/GTL 表示、LTL 除外)

合計 8-12 日専念分。

## 次セッション開始

```fish
cd ~/Document/misskey-bsky-fork
# claude 起動 → 「Task #5 から再開」と伝えれば続行できる
```

## Git 運用 — Gitea

### Remote 設定方針

- **origin**: `https://git.msjp.pro/VTF/misskey-bsky-fork` (**private** repo、未作成なら次 session 冒頭で gitea-mcp 経由で作成)
- **upstream**: `https://github.com/misskey-dev/misskey.git` (read-only fetch、月 1 で rebase 取り込み)

### 初期 setup (未実施)

```fish
cd ~/Document/misskey-bsky-fork
git remote -v   # 現状は origin = github.com/misskey-dev/misskey (clone 元)
git remote rename origin upstream
git remote add origin https://git.msjp.pro/VTF/misskey-bsky-fork.git
# 初回 push は WAN 確認対象 (§3)、user に確認後
git push -u origin bsky-integration
```

### Gitea credential

- token は `~/.config/opencode/secrets/gitea.env` から credential helper 経由で読まれる (homelab-ops と同じ pattern)
- 不足時は **`fetch-gitea-token`** helper (Bitwarden Desktop agent 経由) で取得
- MCP `gitea-mcp` も `GITEA_ACCESS_TOKEN` env が必要、同じ token を使う

### git.msjp.pro = LAN-only

- HAProxy で `git.msjp.pro` を待受、WAN port-forward 無し (homelab-ops/CLAUDE.md と同じ規律)
- push / fetch / clone は **LAN または WireGuard VPN 経由でのみ可能**
- §3 上は WAN host 名のため confirmation 対象だが、実体は LAN 限定

### 上流追従 (月 1 推奨)

```fish
git fetch upstream
git log upstream/master --oneline | head -20      # 何が変わったか確認
git rebase upstream/master                         # bsky-integration 上で rebase
# conflict は主に CoreModule.ts (flat 列挙の末尾追加) で発生する可能性
# core/atproto/ 配下は upstream に存在しないため conflict 発生せず
git push --force-with-lease origin bsky-integration  # ※force push は §4 destructive 扱い、要確認
```

### Commit 規約

- 言語: **日本語** (private fork なので global rule §1 通り human-facing 内容)
- 接頭辞: `feat(atproto): ...`, `fix(atproto): ...`, `chore(rebase): upstream v2026.6.0 取込`
- 1 機能 = 1 commit
- AGPL-3.0-only ライセンス維持 (Misskey upstream に倣う)
- **upstream CLAUDE.md / AGENTS.md は touch しない** (本ファイルの `---` より上の部分も触らない)

## Deploy 方法

### 現運用 (Misskey 公式 image)

- ホスト: CT 200 mi-host (pve2 = 192.168.1.3、`mi-host.msjp-local.org`)
- 公開: HAProxy 経由 `mi.msjp.pro` (Cloudflare → OPNsense → CT 200)
- 構成: **Podman Quadlet** + Misskey 公式 image (`docker.io/misskey/misskey:2026.5.3`)
- deploy 元: `/mnt/data/seafile/documents/homelab-ops/misskey/` (config/, deploy.sh, quadlet/)
- Postgres / Redis / Object storage (Versity S3 on TNAS) は別 service

### Fork deploy 計画

#### Step 1: 自前 image build

Misskey は repo root に `Dockerfile` を持つ (multi-stage):

```fish
cd ~/Document/misskey-bsky-fork
set TAG "2026.5.3-bsky-"(git rev-parse --short HEAD)
docker build -t git.msjp.pro/vtf/misskey-bsky-fork:$TAG .
```

Registry 選択肢:

- **(推奨) Gitea Container Registry** (`git.msjp.pro` の packages 機能、要有効化確認)
  - push: `docker login git.msjp.pro` → `docker push git.msjp.pro/vtf/misskey-bsky-fork:$TAG`
- **homelab 自前 registry を立てる** (CT 新規、`registry:2` image)
- **緊急回避**: `docker save | ssh mi-host docker load` で image を直送

#### Step 2: Staging 検証 (推奨)

- 別 CT (例: CT 201 mi-host-staging) を立てて、本番と同じ Quadlet + 別 DB で動作確認
- 簡略化したい場合: 本番に直接当てる代わりに **PBS で full backup 必須**

#### Step 3: 本番切替

```fish
# 1. PBS で CT 200 の full backup (絶対必須、rollback の根拠)
ssh pve2 'vzdump 200 --storage pbs --compress zstd'

# 2. Quadlet の image 行を fork 版に書き換え
#    /mnt/data/seafile/documents/homelab-ops/misskey/quadlet/ で編集して deploy.sh 経由
#    image=docker.io/misskey/misskey:2026.5.3
#      ↓
#    image=git.msjp.pro/vtf/misskey-bsky-fork:2026.5.3-bsky-<sha>

# 3. migration 実行 (atDid column 追加)
ssh mi-host 'podman exec misskey pnpm --filter backend run migrate'

# 4. Quadlet reload + restart
ssh mi-host 'systemctl daemon-reload && systemctl restart misskey'

# 5. 動作確認
curl -fsS https://mi.msjp.pro/api/meta | jq '.version'   # 2026.5.3 表示
curl -fsS -X POST https://mi.msjp.pro/api/atproto/search -d '{"q":"jay.bsky.team"}' | jq
```

### Rollback

- image tag を `docker.io/misskey/misskey:2026.5.3` に戻す + Quadlet restart
- **atDid column は残しても害なし** (Misskey 本家 code は触らない)、down migration は不要
- 万が一 schema が壊れた場合のみ PBS backup から full restore

### 重要な注意

- **homelab-ops/misskey/quadlet/** も fork image を指すよう更新が必要、homelab-ops 側に commit する
- 公式 Misskey upgrade 時の追従:
  1. upstream rebase → 2. `pnpm install && pnpm build` → 3. image rebuild → 4. registry push → 5. Quadlet image tag 更新 → 6. CT 200 で migrate + restart
- Misskey DB は CT 200 内 Postgres、fork branch 独自 migration `1779174024562-*` は **upstream には絶対送らない**

## 動作確認 / 検証コマンド

### Bsky public API (anonymous、token 不要)

```fish
curl -s 'https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors?q=jay.bsky.team&limit=3' | jq
curl -s 'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=jay.bsky.team' | jq
curl -s 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=jay.bsky.team&limit=2' | jq
```

### Jetstream subscribe (anonymous WS)

Node 24 built-in `WebSocket` で OK (`/tmp/jetstream-test.js` に動作サンプル残ってる、前 session 作成):

```fish
node -e '
const ws = new WebSocket("wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post&wantedDids=did:plc:oky5czdrnfjpqslsw2a5iclo");
ws.onmessage = e => { console.log(JSON.parse(e.data).commit?.record?.text?.slice(0,80)); ws.close(); process.exit(0); };
setTimeout(()=>process.exit(0), 10000);
'
```

## 参考 path (Misskey core、雛形 / 流儀 確認用)

- `packages/backend/src/models/User.ts` — MiUser entity (host/uri/inbox の AP federation column 群)
- `packages/backend/src/core/CoreModule.ts` — NestJS provider flat 登録 (我々の追記済み)
- `packages/backend/src/core/NoteCreateService.ts` — protocol-agnostic な Note 生成 entry (Task #8 で呼ぶ)
- `packages/backend/src/core/activitypub/models/ApPersonService.ts` — remote user upsert の参考実装 (Task #5 の雛形)
- `packages/backend/src/core/activitypub/models/ApNoteService.ts` — remote note ingest の参考実装 (Task #8 の雛形)
- `packages/backend/src/core/QueryService.ts` — `userHost IS NULL` の本拠地、**触らない**
- `packages/backend/src/server/api/endpoints/notes/local-timeline.ts` — LTL filter (確認用、**触らない**)
- `packages/backend/src/core/FanoutTimelineService.ts` — Redis fanout (`NoteCreateService` 経由で自動呼出)
- `packages/backend/src/queue/QueueProcessorService.ts` — BullMQ worker 設定 (Task #7 で Jetstream worker を並べる場所)

## 外部 docs

- AT Protocol: https://atproto.com
- Bluesky API: https://docs.bsky.app
- AT Proto lexicon: https://github.com/bluesky-social/atproto/tree/main/lexicons
- Jetstream blog: https://docs.bsky.app/blog/jetstream
- Bridgy Fed (CC0、AP↔ATProto 翻訳の参考実装): https://github.com/snarfed/bridgy-fed
- Misskey dev docs: https://misskey-hub.net/docs/

## 規律 (継承)

- `~/.claude/CLAUDE.md` (global) と `/mnt/data/seafile/documents/homelab-ops/CLAUDE.md` の規律は継承
  - 日本語応答、§3 WAN 確認、§4 destructive 確認、secrets-guard、etc.
- 上の `@AGENTS.md` で Misskey upstream の codex/copilot 共有ルールも継承
- このプロジェクト固有:
  - **AGPL-3.0-only** 維持 (Misskey upstream に倣う、ファイル冒頭の SPDX 行を踏襲)
  - **upstream に PR を送らない** (private fork、公開しない)
  - **`core/activitypub/` の AP 関連 file は touch しない** (upstream rebase コスト爆発防止)
  - **既存 timeline query は touch しない** (LTL の Bsky 自動除外を維持)
  - **`---` より上 (upstream 由来部分) は touch しない** (rebase 容易性維持)
