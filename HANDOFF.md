# misskey-bsky-fork — 次セッションへの引き継ぎ

## TL;DR

**本番運用中 + CI/CD 自動化済**。`mi.msjp.pro` (CT 200 mi-host VM on pve2) で fork image が稼働中。
直近 30 日分の backfill 込みで Bluesky の post を取り込み、avatar/banner も DriveFile 化済。
LTL から除外、GTL / HTL に流入、検索可。

deploy は `git push` → Gitea Actions build → registry push → mi-host が 5 分以内に pull + restart
の完全自動化。upstream rebase も毎日 03:00 JST に Gitea Actions が試行 (conflict 時のみ Issue 経由で人間介入)。

## 現在の状態 (2026-05-19 時点)

| 場所 | 状態 |
|---|---|
| ソース | `~/Document/misskey-bsky-fork` (branch `bsky-integration`) — origin = `git.msjp.pro/VTF/misskey-bsky-fork` (private) |
| upstream | `github.com/misskey-dev/misskey` v2026.5.3 base、毎日 03:00 JST に自動 rebase 試行 |
| CI/CD | Gitea Actions `.gitea/workflows/{upstream-sync,build-image}.yml` |
| 本番 image (rolling) | `git.msjp.pro/vtf/misskey-bsky-fork:bsky-latest` — mi-host が AutoUpdate=registry で参照 |
| 本番 image (immutable) | `git.msjp.pro/vtf/misskey-bsky-fork:2026.5.3-bsky-<sha>` (rollback 用) |
| 本番ホスト | mi-host (CT 200 / pve2) — rootless podman + Quadlet @ `/home/misskey/.config/containers/systemd/` |
| 本番 Quadlet | image swap + `FORCE_FOLLOW_REMOTE_USER_FOR_TESTING=true` 追加。元 Quadlet は `.bak-20260519-*` 保存 |
| homelab-ops 側 Quadlet | `/mnt/data/seafile/documents/homelab-ops/misskey/quadlet/misskey-web.container` も同期済 (commit `606b310`) |
| 6 follow 中アカウント | gigazine / nikkei / sankei / hon.jp / sanwadirect / github-trending-js (合計 3,266 note + 直近 1 日追加分を backfill 済) |
| Jetstream | wantedDids=6、cursor 永続化中 (`atproto:jetstream:cursor` in Redis) |
| backup (deploy 前) | PBS: `tnas-pbs` (vzdump 完了通知済) + qm snapshot `pre-bsky-deploy` |
| staging | workstation podman で `127.0.0.1:13000` に常駐中。`/tmp/atproto-staging/scripts/` に up/down/logs/smoke スクリプト一式 |

## 実装した Phase

| Phase | 内容 | commit |
|---|---|---|
| 1 | DB schema (`atDid` column + partial unique index) + atproto module skeleton | `5b72539` |
| 2 | AtpDidResolver (plc.directory + did:web) + AtpPersonService | `e312f9a` |
| 3 | AtpSearchService + `/api/atproto/search` | `b15bc8f` |
| 4 | AtpJetstreamService + AtpNoteService (post/repost/delete) | `aed0edf` |
| 5 | Frontend Bluesky 検索タブ + `/api/atproto/follow,unfollow` | `79a9f2b` |
| 6a | 診断ログ追加 (stats/ingest path/follow endpoint) | `ac39a31`, `f14bd43`, `35a6f99` |
| 6b | バグ修正 (Docker context, fetch, cluster, WS race) | `295ce91`, `529da51`, `169440f`, `694be54` |
| 7 | Backfill (新規 follow 時 30 日分 + `/api/atproto/backfill` endpoint) | `7abf3e2`, `65a3715` |
| 8 | Avatar/Banner を DriveService.uploadFromUrl で取り込み | `d3e620f` |

## 解決した bug (staging/production 検証で発見) — 学び

| # | 症状 | 根本原因 | 修正 |
|---|---|---|---|
| 1 | atproto コード一切実行されず、bundled CoreModule に atproto 参照無し | host の `packages/backend/built/` が `.dockerignore` のネスト不一致で build context に混入。runner stage 末尾の `COPY . ./` が native-builder 由来の新 chunk を host の古い chunk で上書き | `.dockerignore` に `**/built/`, `packages/*/built/` 追記 + host のクリーン (`295ce91`) |
| 2 | `/api/atproto/search` が `APPVIEW_UNAVAILABLE: fetch failed` | Node 22 built-in fetch は undici dispatcher を期待するが Misskey の HttpRequestService は `node:https.Agent` を返す型不一致 (`@ts-expect-error` 抑制で隠れていた) | plain fetch に切替、dispatcher 渡しを廃止 (`529da51`) |
| 3 | main + worker 二重 Jetstream 購読、`refreshSubscription()` で close→connect race により 2 つの WS が並走 | `cluster.isPrimary` ガード無し + closeWs 後の close handler が独自に scheduleReconnect を呼ぶ | cluster gating + `suppressNextReconnect` フラグ (`169440f`) |
| 4 | 連続 follow で WS が "connecting" 状態のまま固まり再接続しない | `closeWs()` で `connecting=false` を戻していなかった + 古い WS の handler が新 WS を null 化 | closeWs で connecting 明示クリア + handler 内で `this.ws !== ws` でステイル判定 + refreshSubscription で disconnect 状態を検出して蘇生 (`694be54`) |
| 5 | follow しても `following` テーブルに行が入らない | Misskey の `UserFollowingService.follow` は local→remote follow を **AP follow request** として扱い Accept 待ち。pseudo-MiUser には inbox 無く永遠に pending | env `FORCE_FOLLOW_REMOTE_USER_FOR_TESTING=true` で即時 follow に切替 (Quadlet に追加) |
| 6 | profile アイコンが未表示 | Misskey の pack 関数は `avatarId IS NULL` の場合 `avatarUrl` 値を捨て identicon にフォールバック | DriveService.uploadFromUrl で MiDriveFile 作成、avatarId を non-null に (`d3e620f`) |

## API (本 fork 専用、private 運用)

すべて `requireCredential: true`、auth は通常の Misskey access token (`Authorization: Bearer ...`):

| Endpoint | 用途 | 入力 | 出力 |
|---|---|---|---|
| `POST /api/atproto/search` | Bluesky AppView 検索 | `{ q, limit?, cursor? }` | `{ actors[], cursor }` ※ `isFollowedByMe` 付き |
| `POST /api/atproto/follow` | DID 指定で follow + 自動 30 日 backfill (background) | `{ did }` | packed `UserDetailedNotMe` |
| `POST /api/atproto/unfollow` | DID 指定で unfollow (pseudo-user は残す) | `{ did }` | packed `UserDetailedNotMe` |
| `POST /api/atproto/backfill` | 既存 follow 済 user の profile 再取得 + 直近 N 日 post 取り込み | `{ did, days?=30 }` | `{ did, scanned, ingested, pagesRequested, reachedCutoff }` |

## 既知の未対応 TODO

2026-05-20 までに #1, #8, #9 を除く 6 件は対応済。残るのは構造的に対応不要 / 別 phase なものだけ。

### 対応済 (history としてのみ残す)

- ~~#2 `FORCE_FOLLOW_REMOTE_USER_FOR_TESTING` env 依存~~ — `AtpPersonService.directFollow / directUnfollow` を新設し follow/unfollow endpoint をそちらに切替。`UserFollowingService.follow` の AP follow request 経路を bypass。env は no-op になったので Quadlet からも削除済。
- ~~#3 `AtpLoggerService` の constructor `console.error` 診断~~ — 撤去。
- ~~#4 `listAllDids()` の順序不安定~~ — `order: { id: 'ASC' }` を追加、spurious reconnect 解消。
- ~~#5 Jetstream watermark / heartbeat~~ — `lastEventAt` を handleMessage で更新、`scheduleHeartbeatCheck` (30s 毎) で 5 分以上無音なら強制 close → 通常 reconnect 経路に乗せる。
- ~~#6 Backfill の大量並列実行~~ — 自前 in-memory FIFO queue (`acquireBackfillSlot` / `releaseBackfillSlot`) で `BACKFILL_MAX_PARALLEL=2` に制限。50 同時 follow でも順次 2 並列まで。
- ~~#7 Quote post (`app.bsky.embed.record`)~~ — `extractQuoteSubjectUri` + `fetchOrIngestPostByUri` (`com.atproto.repo.getRecord` 経由で subject を AppView fetch) を新設。`ingestPost` で `renote` 引数として `noteCreateService.create` に渡し、Misskey の quote (renote) として表示。`ingestRepost` も同じ pattern で subject 未取り込み時に AppView fetch するように改善 (これまでは skip)。

### 残 (構造的・別 phase)

1. **CHANGELOG 未記載** — private fork なので skip 中。upstream への PR を出さない限り不要。

8. **Avatar URL の SVG fallback**: Bluesky の avatar が無い user の場合 `profile.avatar` が undefined。今は何もしないので identicon になる。Misskey 流の挙動と一致しているので問題なし。

9. **upstream rebase**: 自動化済 (`.gitea/workflows/upstream-sync.yml` が毎日 03:00 JST に試行 → conflict 時のみ Issue 起票)。conflict 期待ファイル: `CoreModule.ts` の flat 列挙、`MiUser.ts` の atDid column 周辺、`endpoint-list.ts`。

## 運用コマンド集

### サーバーログ tail

```fish
ssh root@mi-host.msjp-local.org 'sudo -iu misskey journalctl --user-unit=misskey-web.service -f --no-pager' | grep --line-buffered atproto
```

### atproto 関連の最近のエラー

```fish
ssh root@mi-host.msjp-local.org 'sudo -iu misskey journalctl --user-unit=misskey-web.service --since "1 hour ago" --no-pager' | grep -iE "atproto.*(warn|error|failed)"
```

### Postgres 直接確認

```fish
ssh root@mi-host.msjp-local.org 'sudo -iu misskey podman exec misskey-postgres psql -U misskey -d misskey'
# 中で:
# SELECT username, "atDid", "avatarId" IS NOT NULL AS avatar FROM "user" WHERE "atDid" IS NOT NULL;
# SELECT COUNT(*) FROM note WHERE uri LIKE 'at://%';
# SELECT u.username, COUNT(n.id) AS notes FROM "user" u LEFT JOIN note n ON n."userId" = u.id WHERE u."atDid" IS NOT NULL GROUP BY u.username ORDER BY notes DESC;
```

### Redis cursor

```fish
ssh root@mi-host.msjp-local.org 'sudo -iu misskey podman exec misskey-redis redis-cli get atproto:jetstream:cursor'
```

### ビルド & デプロイ (CI/CD 経由 — Phase 9 以降)

```fish
# 1. workstation でコードを修正、commit、push
cd ~/Document/misskey-bsky-fork
git add <files>
git commit -m "..."
git push origin bsky-integration

# 2. Gitea Actions が自動で走る (https://git.msjp.pro/VTF/misskey-bsky-fork/actions)
#    - build-image.yml: Dockerfile → image build → registry push
#    - bsky-latest tag が更新される
#
# 3. mi-host CT 200 上の podman-auto-update.timer (5 分間隔) が
#    bsky-latest の digest 変化を検出 → pull + container restart まで自動
#
# 4. 動作確認
ssh root@mi-host.msjp-local.org 'sudo -iu misskey journalctl --user-unit=misskey-web.service --since "5 minutes ago" --no-pager' | grep -iE "atproto|Now listening"
curl -fsS https://mi.msjp.pro/api/meta | jq '.version'
```

ローカルビルドが必要な場面 (CI を待たず手元で確認したい / Gitea ダウン時):

```fish
cd ~/Document/misskey-bsky-fork
# host built/ を必ずクリーン (Docker context 混入防止)
rm -rf built packages/*/built packages/misskey-js/generator/built packages/misskey-js/generator/api.json

set SHA (git rev-parse --short HEAD)
set TAG "git.msjp.pro/vtf/misskey-bsky-fork:2026.5.3-bsky-$SHA"
podman build -t $TAG --build-arg NODE_ENV=production .

# registry に push して auto-update に任せる
podman push $TAG
podman tag $TAG git.msjp.pro/vtf/misskey-bsky-fork:bsky-latest
podman push git.msjp.pro/vtf/misskey-bsky-fork:bsky-latest
```

### Backfill / refresh (既存 follow への遡及取り込み)

```fish
# user の token を psql で取得 (mi-host 内に一時保存して使い、消す)
ssh root@mi-host.msjp-local.org "sudo -iu misskey podman exec misskey-postgres psql -U misskey -d misskey -tA -c \"SELECT token FROM \\\"user\\\" WHERE id = 'alttwjwh7vw90001';\" | tr -d ' \r' > /tmp/.user-i && curl -sS http://127.0.0.1:3000/api/atproto/backfill -H \"Authorization: Bearer \$(cat /tmp/.user-i)\" -H 'Content-Type: application/json' -d '{\"did\":\"did:plc:xxx\",\"days\":30}' && rm /tmp/.user-i"
```

### Rollback (緊急時)

```fish
# (a) 即時 image revert: Quadlet を immutable な sha tag に切り替えて AutoUpdate=disabled に
# <good_sha> = 戻したい安定版の short sha (例: d3e620f)
set GOOD_SHA d3e620f
ssh root@mi-host.msjp-local.org "su - misskey -c \"sed -i 's|^Image=.*misskey-bsky-fork:.*|Image=git.msjp.pro/vtf/misskey-bsky-fork:2026.5.3-bsky-$GOOD_SHA|; s|^AutoUpdate=registry|AutoUpdate=disabled|' ~/.config/containers/systemd/misskey-web.container\" && systemctl --user --machine=misskey@.host daemon-reload && systemctl --user --machine=misskey@.host restart misskey-web.service"
# 復旧後、修正 commit + push → image build 完了後に Quadlet を bsky-latest + AutoUpdate=registry に戻す

# (b) VM 全体を初期状態に戻す (follow 等も消える、PBS snapshot 経由)
ssh root@192.168.1.3 'qm rollback 200 pre-bsky-deploy'

# (c) PBS full restore (最重、DB 含めて完全に戻す)
ssh root@192.168.1.3 'pvesm list tnas-pbs | grep -i 200'
# pve UI から復元するのが安全 (CLI でやるなら qmrestore)
```

### Staging (workstation podman)

```fish
# 起動 (/tmp/atproto-image-tag の image を読む)
bash /tmp/atproto-staging/scripts/up.sh
# ログ tail
bash /tmp/atproto-staging/scripts/logs.sh
# 停止 (DB は残す)
bash /tmp/atproto-staging/scripts/down.sh
# 完全削除
rm -rf /tmp/atproto-staging/pg-data && podman network rm atproto-staging
```

## 次回セッションの推奨開始ポイント

1. **状態確認**: `mi.msjp.pro/api/meta` の version、`/atproto/search` の 401 (= endpoint 生存)、ingest 件数 (上記 SQL) を最初に見る
2. **新規バグ報告**: ユーザーから「○○が動かない」と来たら、まず該当ログを `journalctl ... | grep atproto` で抽出。Phase 6 で 6 件のバグを見つけたパターン (staging で再現 → 直す → 本番に当てる) を踏襲
3. **未対応 TODO 着手**: 上記の 1-9 で気になるものから。avatar 動作確認できているなら #3 (console.error 撤去) と #4 (listAllDids 順序) はサクッと片付くはず
4. **upstream rebase**: 月 1 で `git fetch upstream && git rebase upstream/master` を試す。conflict は `CoreModule.ts` の flat 列挙箇所が主

## 参照する CLAUDE.md / docs

- `/mnt/data/seafile/documents/misskey-bsky-fork/CLAUDE.md` — fork 全体の規約
- `/home/vtf/.claude/CLAUDE.md` — global rules (§3 WAN, §4 destructive, §11 backup)
- `/mnt/data/seafile/documents/homelab-ops/CLAUDE.md` — mi-host 側の運用規律
- `/tmp/atproto-staging/README.md` — staging スクリプトの説明
