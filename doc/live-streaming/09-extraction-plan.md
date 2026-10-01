# 09. 配信機能の独立サイト化 (切り出し) 計画

作成日: 2026-10-01
対象: `misskey-bsky-fork` (branch: `bsky-integration`) の配信機能一式
ステータス: 方針確定・未着手

## 0. 目的と確定事項

fork に実装した配信機能 (MSJP配信 / Twitch 中継 / アーカイブ / コメント / OBS 連携) を Misskey から切り離し、
Fediverse アカウント (Misskey 系・Mastodon) でログインする独立配信サイトに再構成する。
参考: sonora.social (Fediverse ログイン型の音声ルーム。ユーザー名義で開始告知を投稿する方式)。

ユーザー決定 (2026-10-01):

| 項目 | 決定 |
|---|---|
| 技術構成 | SvelteKit で新規実装 (既存 Vue / NestJS コードは移植ではなく仕様の参照元として扱う) |
| 既存データ | 移行する (配信チャンネル・過去セッション・コメント・アーカイブ・Twitch/Google 連携トークン) |
| 移植範囲 | 全部 (MSJP配信・Twitch 中継・Google Drive/YouTube アーカイブ・字幕・翻訳・OBS ページ) |
| ActivityPub | 新サイトはアクターにならない。告知は配信者名義で配信者のインスタンスへ投稿する |

## 1. 現行実装の範囲 (2026-10-01 時点)

| 層 | 主な場所 | 規模 |
|---|---|---|
| backend core | `core/live/` `core/twitch/` `core/google/` `core/remote-guest/` | 約 5,800 行 |
| entity / migration | `models/{LiveChannel,Twitch*,GoogleAccount,RemoteGuest*}.ts`、migration 約 20 本 | 約 1,700 行 |
| endpoint / raw route | `endpoints/{live-channels,twitch,google-drive,remote-guest}/`、`/ome/admission` `/twitch/*` `/google-drive/*` `/recording-download/*` `/remote-guest/*` | 約 3,800 行 |
| WebSocket | `twitchLiveStream` / `liveSubtitle` channel | 87 行 |
| queue | 翻訳 / YouTube ヘルスチェック / アップロード再試行 | 約 300 行 |
| OBS ページ | `assets/misc/{comment-generator,subtitles}.*`、`views/*.tsx` | 約 1,550 行 |
| frontend | `pages/live-stream*.vue` `pages/live-streams.vue` `settings/streaming.vue` `MkOmePlayer` 他 | 約 11,500 行 |

Misskey 本体への依存 (切り出しで置き換えが必要なもの):

| 現行の依存 | 新サイトでの置き換え |
|---|---|
| `MiUser` (配信者・コメント投稿者) | `account` テーブル。キーは `(host, remoteUserId)` |
| `following` テーブル (チャンネルフォロー) | サイト内 `follow` テーブル |
| `NotificationService` + 通知型 `twitchLiveStreamStarted` + SW push | サイト内通知 + Web Push (VAPID 自前) |
| `NoteCreateService` (配信開始の自動ノート) | 配信者のトークンでその人のインスタンスへ投稿 (Misskey `notes/create` / Mastodon `POST /api/v1/statuses`) |
| `MiChannel.isLiveChannel` + `channels/timeline` | 廃止。チャンネルホームは独自ページ |
| `GlobalEventService` + Misskey streaming | 自前 WebSocket + Redis pub/sub |
| `UserEntityService` の `twitchLive` フィールド | 廃止 (Misskey 側は新サイトへのリンクのみ) |
| remote-guest (MiAuth で他鯖ユーザーがコメント) | 正式なログイン手段に昇格 |

Misskey に依存しない部分 (ロジックをそのまま移植できる):
OME REST クライアント、SignedPolicy 署名、ビットレート監視・遮断・ブラックリスト、録画 → remux → YouTube/Drive アップロード、
Twitch OAuth / EventSub / チャット中継、翻訳、閲覧制限 (パスワード / フォロワー限定)。

## 2. 新サイトの構成

```
OBS ──WHIP──▶ stream.msjp.pro (OME, CT100 @ PVE2) ※変更なし
                   │ AdmissionWebhook / REST
                   ▼
ブラウザ ──https──▶ live.msjp.pro (仮)
                   ├─ web: SvelteKit (adapter-node) + WebSocket (同一プロセスの custom server)
                   └─ worker: OME 監視 / 録画パイプライン / Twitch EventSub / BullMQ ジョブ
                   │
                   ├─ Postgres (新規 DB)
                   └─ Redis (pub/sub, BullMQ, viewtoken, blacklist)
ログイン ──MiAuth / OAuth──▶ 利用者の Misskey / Mastodon インスタンス
```

- リポジトリ: Gitea `VTF/msjp-live` (private)。pnpm monorepo (`apps/web`, `apps/worker`, `packages/db`, `packages/shared`)。
- web と worker は同じ DB スキーマ・ドメインロジックを共有する。OME ポーリングと録画は web から分離し、
  web を水平に増やしても監視が重複しない形にする (現行はクラスタの primary 判定で回避している)。
- ORM は新規選定 (Drizzle を第一候補)。既存 migration は移植せず、新スキーマを 1 本目から作る。
- ライセンス: AGPL-3.0-only を維持 (現行コードの移植を含むため)。§13 の扱いは fork 側の保留事項を引き継ぐ。

### 2.1 認証

| 対象 | 方式 | 要求権限 |
|---|---|---|
| Misskey 系 (Misskey / Sharkey / CherryPick 等) | MiAuth (`/miauth/{session}` → `/api/miauth/{session}/check`) | `read:account`, `write:notes` |
| Mastodon 系 | OAuth 2.0。インスタンスごとに `POST /api/v1/apps` で動的登録し、client 情報を DB にキャッシュ | `read:accounts`, `write:statuses` |

- インスタンス種別は NodeInfo で判定する。
- `account` の一意キーは `(host, remoteUserId)`。username は表示用スナップショットとして保持する
  (現行 remote-guest は `username + host` がキーなので、移行時にリモート ID を解決して付け替える)。
- 取得したアクセストークンは暗号化して保存する (告知投稿に使うため)。告知を使わない利用者には `write` 権限を要求しない選択肢を残す。
- サイトのセッションは独自 cookie。ホスト許可リストは現行 `remoteGuestLogin.allowedHosts` の運用を引き継ぎ、管理画面で編集可能にする。

### 2.2 移植対象の機能

| 機能 | 備考 |
|---|---|
| 配信チャンネル (バナー・説明・オフライン画像・閲覧制限) | `live_channel` 相当。1 アカウント 1 チャンネル |
| MSJP配信 (WHIP + SignedPolicy) | signedPolicySecret と WHIP ホストを変えなければ、配信者の OBS 設定は変更不要 |
| ビットレート監視・遮断 | worker へ |
| 視聴ページ / OvenPlayer / Twitch プレイヤー切替 | Svelte コンポーネントとして書き直し |
| コメント・ブロック・翻訳・TTS・字幕 | WebSocket は自前 |
| OBS コメントジェネレーター / 字幕ページ | vanilla JS なので API パスと WS プロトコルの差し替えで移植 |
| Twitch 中継・チャット中継 | OAuth redirect URI と EventSub callback の URL 変更が必要 |
| Google Drive / YouTube アーカイブ | OAuth redirect URI 変更。Google Cloud の承認済みドメイン追加と、YouTube upload スコープの再審査が必要になる可能性がある |
| フォロー・配信開始通知 | サイト内 + Web Push + 任意の告知投稿 |

## 3. 実装フェーズ

| Phase | 内容 | 完了条件 |
|---|---|---|
| A | リポジトリ・monorepo・DB スキーマ・CI (Gitea Actions で image build) | 空の SvelteKit が live 用 LXC で起動する |
| B | 認証 (MiAuth / Mastodon OAuth / セッション / ホスト許可リスト) | mi.msjp.pro と Mastodon テスト鯖の両方でログインできる |
| C | チャンネル・ストリームキー・SignedPolicy・OME 監視 (worker) | LAN の OME に新サイト発行の WHIP URL で配信し、開始/終了を検知できる |
| D | 視聴ページ・プレイヤー・コメント・WebSocket・フォロー・通知・告知投稿 | 視聴とコメントが E2E で動く |
| E | OBS ページ (コメントジェネレーター・字幕)・翻訳・TTS | OBS ブラウザソースで表示できる |
| F | Twitch 連携・Google/YouTube アーカイブ・録画パイプライン | 配信終了 → 録画 → アップロード完了まで動く |
| G | データ移行スクリプト + 本番切替 | 下記 §4 |
| H | fork から配信機能を削除 | 下記 §5 |

## 4. データ移行と切替手順

1. 移行スクリプトが mi.msjp.pro の DB から読み、新 DB へ書く。対象は `live_channel`、`twitch_stream`、
   `twitch_stream_comment`、`twitch_stream_block`、`twitch_account`、`google_account`、`remote_guest_*`。
   - mi.msjp.pro ローカルユーザーは `account(host='mi.msjp.pro', remoteUserId=<MiUser.id>)` に対応付ける。
   - チャンネルフォロー: `following` のうち followee が配信チャンネル保有者の行を `follow` に変換する。
     リモートのフォロワーは `(host, remoteUserId)` に対応付ける。
   - Twitch / Google のトークンはそのまま移す (redirect URI 変更後もリフレッシュトークンは有効な想定。切替前に検証する)。
2. 切替当日: Misskey 側の配信機能を読み取り専用にし、差分を再移行してから OME の AdmissionWebhook 先を新サイトへ向ける。
3. Misskey の `/live`、`/live/:acct` とその配下を新サイトへ 301 リダイレクトする (OBS ブラウザソース URL を含む)。
4. 並行運用期間 (2 週間程度) の後、Phase H へ進む。

## 5. fork 側の削除 (Phase H)

- 削除: `core/{live,twitch,google,remote-guest}/`、関連 entity・endpoint・raw route・queue・WS channel・OBS assets・frontend ページ・`_liveChannel` `_twitch` `_remoteGuestLogin` (ja-JP.yml)・e2e。
- upstream ファイルへの差分を戻す: `GlobalEventService`、`QueueService`、`NoteCreateService`、`NotificationService`、
  `models/{Channel,Notification}.ts`、`Connection.ts`、`ClientServerService.ts`、`UserEntityService.ts`、通知スキーマ、
  misskey-js、frontend の `MkNotification` `navbar` `router.definition` `deck/channel-column` `user/home`、`packages/sw`。
- テーブル削除は新規 migration で行う (既存 migration は編集しない)。`channel.isLiveChannel` も削除し、通知型
  `twitchLiveStreamStarted` の既存行を削除する migration を入れる。
- navbar には新サイトへの外部リンクを 1 つ残す。

## 6. 未確定事項

| # | 項目 |
|---|---|
| 1 | 公開 FQDN (`live.msjp.pro` 案) と WAN 公開 (HAProxy / Cloudflare) |
| 2 | 新サイトのホスト (PVE2 に新規 LXC を置き、録画 NFS をマウントするか) |
| 3 | ORM (Drizzle / Kysely) と WebSocket 実装 (`ws` + custom server / SvelteKit 実験的 WebSocket) |
| 4 | Google OAuth のドメイン追加と YouTube スコープ再審査の要否 |
| 5 | 対応するログイン先 (Misskey 系・Mastodon 以外に Pleroma/Akkoma 等を入れるか) |
