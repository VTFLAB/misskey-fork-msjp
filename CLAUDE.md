# Misskey – Claude Code Guide (bsky-integration fork)

このリポジトリは Misskey upstream の **私的 fork** で、目的は Bluesky (AT Protocol) の public post を Misskey 内に取り込む inbound 統合の実装。詳細は本文末尾を参照。

## Upstream の規約 (継承)

ルール本体は [AGENTS.md](AGENTS.md) (Codex / Copilot と共有する単一ソース)。本ファイルは Claude Code 用の薄いラッパーで、`@AGENTS.md` 構文で本体規約をセッション開始時にコンテキストへ展開する。

Claude Code 固有の補助 (skills / agents / slash commands / docs) は `.claude/` 配下にコミット済。個人ローカル設定は `.claude/settings.local.json` に、MCP 認証情報は `.claude/.credentials.json` に置く (いずれも `.gitignore` 済)。

@AGENTS.md

---

# Fork 固有: misskey-bsky-fork

ここから下は **fork オリジナル**。Upstream には絶対送らない。Upstream CLAUDE.md (上の `@AGENTS.md` まで) は最小 diff で維持し、rebase 時の conflict を避ける。

## このリポジトリは公開される

Gitea は LAN 限定だが、git 管理したものはすべて GitHub の公開ミラー
[`VTFLAB/misskey-fork-msjp`](https://github.com/VTFLAB/misskey-fork-msjp) に自動で push される。
コミットの差分とコミットメッセージも公開され、rebase 前の古いコミットも GitHub 上に残る。
ファイル・コメント・コミットメッセージに次のものを書かない:

- 秘密情報 (token、パスワード、鍵、client secret)。値だけでなく、置き場所のパスも書かない
- 個人情報 (個人のメールアドレス、実在ユーザーのハンドルや ID、ユーザーの報告内容)
- 自宅や LAN の構成 (WAN/LAN の IP、内部ホスト名、ssh 手順、ルーターやプロキシの設定、バックアップ手順)
- 防御の状態 (どこが無認証か、どの許可リストに頼っているか)
- Claude のセッション URL

これらは非公開の homelab-ops リポジトリの `misskey/docs/` に書く。運用メモ (`OPS.md`)、
セッション引き継ぎ (`HANDOFF.md`)、配信機能の設計資料 (`live-streaming/`) はそこにある。
運用メモは次の行で読み込む (homelab-ops が隣に clone されていない環境では読み込まれない):

@../homelab-ops/misskey/docs/OPS.md

## プロジェクト目的

- Misskey 1 画面で Twitter 移行組の Bluesky 公式アカウント等を購読表示
- **inbound only** (Bsky → Misskey 表示のみ、Misskey → Bsky 投稿は実装しない)
- **anonymous** (自前 Bsky account / OAuth / app password 不要、public AppView API のみ使う)
- **稼働インスタンス (`mi.msjp.pro`) は小規模公開インスタンスとして運用中** (2026-07-01 時点)
  - コードリポジトリ (`git.msjp.pro/VTF/misskey-bsky-fork`) は非公開のまま
  - ソースコード開示用に GitHub の公開ミラー [`VTFLAB/misskey-fork-msjp`](https://github.com/VTFLAB/misskey-fork-msjp) を用意している (AGPL-3.0 §13 の corresponding source 提供のため)。Gitea のミラー設定で自動 push される。運用は上の「このリポジトリは公開される」と下の「GitHub 公開ミラーと Dependabot」を参照

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
- Firefish (Misskey fork) の燃え尽き廃止事例を踏まえ、**fork patch は最小侵襲** を維持 (upstream rebase コスト抑制)
- 当初は private 運用前提だったが、2026-07-01 時点で小規模公開インスタンスへ移行済み。**モデレーション・スパム対策・プライバシー制御まわりの機能要件が新たに発生している** (詳細は今後の機能候補検討を参照)

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

- upstream: `github.com/misskey-dev/misskey` **v2026.5.3** (本番と同 version で fork を開始。現在の base は `.gitea/workflows/build-image.yml` の `BASE_VERSION`)
- branch: `bsky-integration`
- コードリポジトリは非公開のまま: private repo on Gitea (`git.msjp.pro`)。ソース開示は GitHub の公開ミラー (`VTFLAB/misskey-fork-msjp`) で行う。稼働インスタンス自体は公開運用 (上記プロジェクト目的を参照)

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

**本番運用中** (2026-05-19 デプロイ済、`mi.msjp.pro`)。次セッションへの引き継ぎは非公開の homelab-ops `misskey/docs/HANDOFF.md` を参照。

完了:

- [x] #1: Bsky AppView anonymous API + Jetstream 動作確認
- [x] #2: Misskey 2026.5.3 を shallow clone、`bsky-integration` branch
- [x] #3: DB migration `1779174024562-AddAtDidToUser.js`
- [x] #4: AtpLoggerService + AtpHttpClientService + CoreModule flat 登録
- [x] #5: AtpDidResolver + AtpPersonService
- [x] #6: AtpSearchService + `/api/atproto/search`
- [x] #7: AtpJetstreamService (cluster gating、stale handler isolation、stuck connecting 復旧)
- [x] #8: AtpNoteService (lexicon → MFM facets/embed/reply、repost、delete)
- [x] #9: Frontend "Bluesky" 検索タブ + `/api/atproto/follow,unfollow`
- [x] #10: E2E 検証 (search → follow → post 流入 → HTL/GTL 表示、LTL 除外)
- [x] **Phase 7**: Backfill (新規 follow 時 30 日 + `/api/atproto/backfill` endpoint)
- [x] **Phase 8**: Avatar/Banner を DriveService.uploadFromUrl で取り込み
- [x] **本番デプロイ**: image `2026.5.3-bsky-d3e620f` 稼働中、6 アカウント follow + 3,266 note + avatar 全件取り込み済
- [x] **Phase 9**: CI/CD 化 — Gitea Actions (upstream-sync 毎日 03:00 JST + build-image on push) + 本番の podman auto-update (5 分間隔) で完全自動化

検証コマンド (deploy 後):

```fish
# 1. 検索が走るか
curl -s "https://mi.msjp.pro/api/atproto/search" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"q":"jay.bsky.team"}' | jq '.actors[0]'

# 2. follow して Jetstream 開始
curl -s "https://mi.msjp.pro/api/atproto/follow" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"did":"did:plc:oky5czdrnfjpqslsw2a5iclo"}' | jq '.'

# 3. 30 秒待ってから HTL に post が流入するか
sleep 30 && curl -s "https://mi.msjp.pro/api/notes/timeline" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"limit":5}' | jq '.[] | {uri, text}' | head -30

# 4. LTL に Bsky 投稿が混じっていないこと (userHost IS NULL filter)
curl -s "https://mi.msjp.pro/api/notes/local-timeline" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"limit":50}' | jq '[.[] | select(.user.host == "bsky.social")] | length'
# → 0 が出れば OK
```

## Git 運用 — Gitea

### Remote 設定方針

- **origin**: `https://git.msjp.pro/VTF/misskey-bsky-fork` (**private** repo、未作成なら次 session 冒頭で gitea-mcp 経由で作成)
- **upstream**: `https://github.com/misskey-dev/misskey.git` (read-only fetch、月 1 で rebase 取り込み)

Gitea の認証と到達経路は非公開の運用メモ (`OPS.md`) を参照。

### GitHub 公開ミラーと Dependabot

- GitHub `VTFLAB/misskey-fork-msjp` (public) は Gitea からの push ミラー。**GitHub へ直接 commit / PR merge しない**。修正は常に Gitea に commit + push し、ミラーで反映させる
- Dependabot alerts はミラー側で確認する: `gh api --paginate "repos/VTFLAB/misskey-fork-msjp/dependabot/alerts?state=open&per_page=100"`
- 間接依存の修正は `pnpm-workspace.yaml` の `overrides` 先頭にある bsky-fork ブロックへ `'pkg@^N': ^<修正版>` の形で足す (値も範囲にして、upstream の新しい版を戻さない)。版は `minimumReleaseAge` (7 日) を満たすものを選ぶ。upstream が追いついた行は消す
- 修正版が無い、または誤報のアラートは、理由を書いて GitHub 上で dismiss する (2026-10-06: braces #202、http-cache-semantics #203)
- Dependabot のセキュリティ更新 PR は GitHub 上に作られるが、ミラーの push でブランチが消える。merge しない
- 2026-10-06 の一括対応 (121 件) の経緯は commit「fix(deps): Dependabot のセキュリティアラートに対応する」と「fix(deps): セキュリティ用 overrides の値を範囲指定にする」を参照

### 上流追従

**自動 (推奨)**: Gitea Actions `upstream-sync.yml` が毎日 03:00 JST (= 18:00 UTC) に
`upstream/master` を fetch → `bsky-integration` 上で rebase → `git push --force-with-lease`
を試行する。conflict が出たら `rebase --abort` して Gitea Issue を立てて停止するので、
それを見て手動で対応する。手動 trigger は Gitea Web UI から `workflow_dispatch`。

**手動 (conflict 解消用)**:

```fish
git fetch upstream
git log upstream/master --oneline | head -20
git rebase upstream/master
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

- 本番は Podman Quadlet (rootless) で fork の image を動かす。Quadlet などの deploy 側の定義は非公開の homelab-ops `misskey/` にある
- `bsky-integration` に push すると、Gitea Actions の `build-image.yml` が image を build して registry に push する (`<base_version>-bsky-<short_sha>` と `bsky-latest`)
- 本番は `bsky-latest` の digest 変化を 5 分間隔で検出し、pull + restart する。container の entrypoint (`pnpm migrate && pnpm start`) が migration を自動適用する
- `.md`、`.claude/`、`.gitea/` などだけの push では build しない (`build-image.yml` の `paths-ignore`)
- fork 独自 migration `1779174024562-*` などは upstream に送らない
- ホスト構成、確認コマンド、rollback 手順は非公開の運用メモ (`OPS.md`) を参照

## 動作確認 / 検証コマンド

### Bsky public API (anonymous、token 不要)

```fish
curl -s 'https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors?q=jay.bsky.team&limit=3' | jq
curl -s 'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=jay.bsky.team' | jq
curl -s 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=jay.bsky.team&limit=2' | jq
```

### Jetstream subscribe (anonymous WS)

Node 24 built-in `WebSocket` で OK:

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

- `~/.claude/CLAUDE.md` (global) と homelab-ops の `CLAUDE.md` の規律は継承
  - 日本語応答、§3 WAN 確認、§4 destructive 確認、secrets-guard、etc.
- 上の `@AGENTS.md` で Misskey upstream の codex/copilot 共有ルールも継承
- このプロジェクト固有:
  - **AGPL-3.0-only** 維持 (Misskey upstream に倣う、ファイル冒頭の SPDX 行を踏襲)。§13 のソース開示は GitHub の公開ミラーで行う (上記プロジェクト目的を参照)
  - **upstream に PR を送らない** (fork 固有の atproto 統合コードのため、upstream の関心事と無関係)
  - **`core/activitypub/` の AP 関連 file は touch しない** (upstream rebase コスト爆発防止)
  - **既存 timeline query は touch しない** (LTL の Bsky 自動除外を維持)
  - **`---` より上 (upstream 由来部分) は touch しない** (rebase 容易性維持)
