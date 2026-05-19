# misskey-bsky-fork — 次セッションへの引き継ぎ

## TL;DR

**本番運用中**。`mi.msjp.pro` (CT 200 mi-host VM on pve2) で
`git.msjp.pro/vtf/misskey-bsky-fork:2026.5.3-bsky-d3e620f` 稼働中。
直近 30 日分の backfill 込みで Bluesky の post を取り込み、avatar/banner も
DriveFile 化済。LTL から除外、GTL / HTL に流入、検索可。

## 現在の状態 (2026-05-19 時点)

| 場所 | 状態 |
|---|---|
| ソース | `~/Document/misskey-bsky-fork` (branch `bsky-integration`) — push 先未設定 |
| upstream | `github.com/misskey-dev/misskey` v2026.5.3 base |
| 本番 image | `git.msjp.pro/vtf/misskey-bsky-fork:2026.5.3-bsky-d3e620f` (commit `d3e620f`) |
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

優先順:

1. **CHANGELOG 未記載** — private fork なので skip 中。upstream rebase 時に必要なら追加。

2. **`FORCE_FOLLOW_REMOTE_USER_FOR_TESTING` env 依存** — 命名がテスト用で気持ち悪い。本来は fork 専用の `AtpPersonService.directFollow(me, pseudoUser)` 等で `UserFollowingService.insertFollowingDoc` を直接呼ぶ実装にすべき (insertFollowingDoc が private なので別経路要)。
   - 影響: env を外すと既存 6 user の再 follow ができなくなるが、現状の follow 関係は維持される。

3. **AtpLoggerService の constructor `console.error` 診断** — staging で build context バグを追跡したときの遺物。stderr のみで害は無いが、本番では雑音。`feat(atproto): cleanup diagnostic` で消す。

4. **`listAllDids()` の順序が不安定 → spurious reconnect** — `ORDER BY id` 抜けで PostgreSQL がランダム順を返すことがあり、`refreshSubscription` 内の `join(',')` 比較で「変化したと誤判定 → 不必要に WS reconnect」が発生する。実害は WS 切断時間 1〜2s のみで自動回復。修正は 1 行 (`select` クエリに `order: { id: 'ASC' }` 追加)。

5. **Jetstream の watermark / heartbeat** — `idleTimeoutMs` 相当の watchdog 無し。WS が無音で死ぬケースを 60s 周期の did refresh tick で蘇生しているが、もっと早期の検出にしたいなら ping/pong を入れる。

6. **Backfill の大量並列実行**: `/api/atproto/follow` の自動 backfill は background `.catch()` で並列に走る。50 アカウントを一気に follow すると AppView 50 並列 + DB INSERT 50 並列で本番 PG にも負荷。実用上は 1-2 アカウント /分 のペースなので問題化していないが、将来的に follow 多発する用途なら queue 化したい。

7. **Quote post (`app.bsky.embed.record`)**: 現状は trailer URL を text に挿入するのみで Misskey の quote (renote) 化していない。subject post を fetchOrIngest して renote として作る実装が望ましい。

8. **Avatar URL の SVG fallback**: Bluesky の avatar が無い user の場合 `profile.avatar` が undefined。今は何もしないので identicon になる。Misskey 流の挙動と一致しているので問題なし。

9. **upstream rebase**: 月 1 で `git fetch upstream && git rebase upstream/master`。conflict 期待ファイル: `CoreModule.ts` の flat 列挙、`MiUser.ts` の atDid column 周辺、`endpoint-list.ts`。

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

### ビルド & デプロイ (次回コード変更時の手順)

```fish
# 1. workstation でコードを修正、commit
cd ~/Document/misskey-bsky-fork
# (lint check) — host built が必須なので shared deps を rebuild してから
pnpm --filter misskey-js build && pnpm --filter i18n build && \
  pnpm --filter misskey-reversi build && pnpm --filter misskey-bubble-game build && \
  pnpm --filter backend lint

# 2. host の built/ を必ずクリーン (Docker context 混入防止)
rm -rf built packages/*/built packages/misskey-js/generator/built packages/misskey-js/generator/api.json

# 3. commit
git add <files>
git commit -m "..."

# 4. image build
set SHA (git rev-parse --short HEAD)
set TAG "git.msjp.pro/vtf/misskey-bsky-fork:2026.5.3-bsky-$SHA"
podman build -t $TAG --build-arg NODE_ENV=production .

# 5. 転送 + load
podman save --format docker-archive -o /tmp/misskey-image.tar $TAG
scp /tmp/misskey-image.tar root@mi-host.msjp-local.org:/home/misskey/misskey-bsky-fork.tar
ssh root@mi-host.msjp-local.org "chown misskey:misskey /home/misskey/misskey-bsky-fork.tar && su - misskey -c 'podman load -i /home/misskey/misskey-bsky-fork.tar' && rm /home/misskey/misskey-bsky-fork.tar"

# 6. Quadlet image tag swap + restart (.bak 取得込み)
ssh root@mi-host.msjp-local.org "su - misskey -c \"cp ~/.config/containers/systemd/misskey-web.container ~/.config/containers/systemd/misskey-web.container.bak-\$(date +%Y%m%d-%H%M%S) && sed -i 's|^Image=git.msjp.pro/vtf/misskey-bsky-fork:.*|Image=$TAG|' ~/.config/containers/systemd/misskey-web.container\" && systemctl --user --machine=misskey@.host daemon-reload && systemctl --user --machine=misskey@.host restart misskey-web.service"

# 7. boot 待ち + atproto 起動確認
ssh root@mi-host.msjp-local.org 'sudo -iu misskey journalctl --user-unit=misskey-web.service --since "1 minute ago" --no-pager' | grep -iE "atproto|Now listening"

# 8. homelab-ops の Quadlet 同期 commit
cd /mnt/data/seafile/documents/homelab-ops
# misskey/quadlet/misskey-web.container の Image 行を bump
git add misskey/quadlet/misskey-web.container
git commit -m "chore(misskey): image bump <OLD> → <NEW> (..)"
```

### Backfill / refresh (既存 follow への遡及取り込み)

```fish
# user の token を psql で取得 (mi-host 内に一時保存して使い、消す)
ssh root@mi-host.msjp-local.org "sudo -iu misskey podman exec misskey-postgres psql -U misskey -d misskey -tA -c \"SELECT token FROM \\\"user\\\" WHERE id = 'alttwjwh7vw90001';\" | tr -d ' \r' > /tmp/.user-i && curl -sS http://127.0.0.1:3000/api/atproto/backfill -H \"Authorization: Bearer \$(cat /tmp/.user-i)\" -H 'Content-Type: application/json' -d '{\"did\":\"did:plc:xxx\",\"days\":30}' && rm /tmp/.user-i"
```

### Rollback (緊急時)

```fish
# 即時 (snapshot 経由、VM 内のすべての状態が pre-bsky-deploy 時点に戻る、follow 等も消える)
ssh root@192.168.1.3 'qm rollback 200 pre-bsky-deploy'

# image だけ戻す (atDid column はそのまま残るが Misskey 本家は使わないので無害)
ssh root@mi-host.msjp-local.org "su - misskey -c \"sed -i 's|^Image=git.msjp.pro/vtf/misskey-bsky-fork:.*|Image=docker.io/misskey/misskey:2026.5.3|' ~/.config/containers/systemd/misskey-web.container\" && systemctl --user --machine=misskey@.host daemon-reload && systemctl --user --machine=misskey@.host restart misskey-web.service"

# PBS full restore (最重)
ssh root@192.168.1.3 'pvesm list tnas-pbs | grep -i 200' # ID 確認
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
