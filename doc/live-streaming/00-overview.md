# ライブチャンネル機能 設計書 — 総論 (00)

作成日: 2026-07-14
対象リポジトリ: `misskey-repo` (branch: `bsky-integration`)
ステータス: 設計確定 (未実装)。本ディレクトリの文書群が実装の正本。

## 1. この文書群の位置づけ

Misskey bsky-fork に既存実装済みの Twitch 配信連携に加え、以下 3 要件を実装するための設計書群である。

1. **チャンネルページ** — YouTube Live / Twitch 型のユーザーチャンネルページ (バナー・名前・説明・タイムライン・フォロー)。1 ユーザー 1 チャンネル、設定の「配信機能を利用する」で開設。
2. **独自配信システム** — OvenMediaEngine (OME) を PVE2 に構築し、Twitch 連携と合わせたマルチ配信システムとする。映像/音声とも Bypass (無トランスコード)、入力 WebRTC (WHIP)/E-RTMP/SRT、出力 WebRTC のみ。SignedPolicy によるストリームキー、AdmissionWebhooks による認可、ビットレート超過 (映像 3000kbps / 音声 128kbps) の自動遮断。
3. **プレイヤー** — Twitch と独自配信を同一視聴ページ (`/live/:acct`) で視聴。OvenPlayer ベースのライブ特化カスタムプレイヤー (再生/停止/シークなし) と、Twitch プレイヤーとの切替 UI。

読者は「実装を任される LLM または初級エンジニア」を想定する。各文書は単体で作業指示として成立する粒度で書かれており、曖昧語 (適宜・必要に応じて) を排し、参照すべき既存コードを file:line で指定する。

### 文書一覧と読み順

| 文書 | 内容 | 実装フェーズ |
|---|---|---|
| `00-overview.md` (本書) | 全体アーキテクチャ・確定決定・フェーズ計画・未確定事項 | — |
| `01-infra-ome-setup.md` | PVE2 への OME 構築、Server.xml、ネットワーク/WAN 公開 | Phase 0 |
| `02-backend-channel.md` | `live_channel` テーブル・チャンネル API・設定トグル | Phase 1 |
| `03-backend-ome-integration.md` | AdmissionWebhooks・ストリームキー/SignedPolicy・監視/遮断・セッション統合・通知 | Phase 2 |
| `04-frontend-channel-page.md` | チャンネルページ UI・設定ページ | Phase 3 |
| `05-frontend-player.md` | OvenPlayer 統合・カスタムプレイヤー・切替 UI | Phase 4 |
| `06-implementation-phases.md` | フェーズ分割・作業手順・検証チェックリスト (実装者はまずこれを読む) | 全体 |

実装作業を開始する LLM は **06 → 00 → 担当フェーズの文書** の順で読むこと。

## 2. 全体アーキテクチャ

```
                         WAN                    │ LAN (192.168.1.0/24, PVE2 上)
                                                │
 OBS (配信者) ──RTMP 1935/tcp──────NAT──────────┼──▶ ┌─────────────────────┐
              ──SRT 9999/udp──────NAT──────────┼──▶ │ OME (新規 LXC CT)    │
              ──WHIP──┐                        │    │ ovenmedialabs/       │
                      ├─wss── HAProxy ─────────┼──▶ │  ovenmediaengine     │
 視聴者 ─signalling───┘  (stream.msjp.pro)     │    │ app: live / Bypass   │
        ─ICE/SRTP 10000-10009/udp──NAT─────────┼──▶ │ REST API :8081 (LAN) │
                                                │    └──────┬──────────────┘
                                                │           │ AdmissionWebhooks (opening/closing)
                                                │           │ REST API (統計ポーリング/強制切断)
                                                │           ▼
 ブラウザ ──https── HAProxy (mi.msjp.pro) ──────┼──▶ ┌─────────────────────┐
                                                │    │ Misskey (VM 200)     │
                                                │    │ /ome/admission ルート │
                                                │    │ core/live/ サービス群 │
                                                │    └─────────────────────┘
```

- **配信開始**: OBS → OME に接続 → OME が AdmissionWebhooks で Misskey に問い合わせ → Misskey が streamKey を検証して許可/拒否 → 許可時に配信セッション作成・フォロワー通知。
- **視聴**: ブラウザ → Misskey API から再生 URL 取得 → OvenPlayer が OME と WebRTC signalling (wss, HAProxy 経由) + ICE/メディア (UDP 直接) で接続。
- **遮断**: Misskey が OME REST API を 10 秒間隔ポーリング → ビットレート超過 30 秒継続で強制切断 + 10 分間ブラックリスト (AdmissionWebhooks で再接続拒否)。

## 3. 確定済み設計決定 (変更には本書の改訂が必要)

### 命名・配置

| 項目 | 決定 |
|---|---|
| 機能呼称 | ライブチャンネル (Live Channel)。独自配信の user-facing 名は「MSJP配信」(インスタンス名かつ旧配信サービスの短縮呼称に由来) |
| backend 新設ディレクトリ | `packages/backend/src/core/live/` の 1 つのみ |
| 新サービス | `LiveChannelService` / `OmeApiService` / `OmeAdmissionService` / `OmeStreamMonitorService` / `LiveLoggerService` |
| 新テーブル | `live_channel` のみ。配信セッションは既存 `twitch_stream` に `source` カラムを追加して共用 |
| 新 fastify ルート | `server/ome/OmeServerService.ts` (prefix `/ome`)。raw body の HMAC 検証が必要なため API endpoint ではなく生ルート |
| i18n 接頭辞 | `_liveChannel` (`locales/ja-JP.yml` のみ編集) |
| OME ホスト | PVE2 新規 LXC、LAN 名 `ome.msjp-local.org`、公開 FQDN 案 `stream.msjp.pro` (未確定事項 6) |
| OME app 名 | `live` 固定。stream 名 = ストリームキー |

### D1: チャンネル = `live_channel` テーブル、フォロー/タイムラインは既存機能流用

- `live_channel.userId` unique = 1 ユーザー 1 チャンネル。「配信機能を利用する」トグル = 行の作成 + `enabled`。
- チャンネルアイコンはユーザーアイコン流用 (専用カラムなし)。バナー/名前/説明は `live_channel` の専用カラム (null 時は user.banner / user.name / 非表示にフォールバック)。
- チャンネルフォロー = 既存 `following` テーブル + `MkFollowButton` をそのまま流用。専用フォローテーブルは作らない (既存 `TwitchStreamService.notifyFollowers` が同方式の実績)。
- チャンネルタイムライン = 既存 `users/notes` API + `MkNotes` の埋め込み。専用タイムラインは作らない。
- チャンネルページは新 URL を切らず **既存 `/live/:acct` を拡張** (ライブ中=視聴 UI + チャンネル情報バー、オフライン=チャンネルホーム表示)。

### D2: 配信セッションは `twitch_stream` を汎用化して共用

`twitch_stream` に `source varchar(16) NOT NULL DEFAULT 'twitch'` ('twitch' | 'ome') を追加し、`twitchUserId`/`twitchStreamId`/`twitchLogin` を nullable 化する。新テーブルは作らない。

理由: コメント (`twitch_stream_comment`)・ブロック (`twitch_stream_block`)・翻訳・OBS オーバーレイ・読み上げ・コメントジェネレーター・streaming channel (`twitchLiveStream`) はすべて `streamId` 単位で動いており、セッションテーブルを共用すれば **これら既存機能が無改修〜最小改修で独自配信にも効く**。テーブル名の歪み (twitch_ 接頭辞) は差分最小化のため許容し、リネームはしない。

Twitch⇔OME 同時配信 (マルチ配信) 時は source 違いの isLive セッションが 2 行並存する。チャットはセッションごとに独立。

### D3: 認可は AdmissionWebhooks が正、SignedPolicy は併用

- **AdmissionWebhooks** (rtmp/webrtc/srt すべての Provider で有効) が「Misskey 経由の配信者しか OME を使えない」の実体。streamKey が有効な `live_channel` に一致しなければ `allowed:false`。
- **SignedPolicy** は要件どおり併用する。RTMP ingest への適用は公式確定。WebRTC/SRT provider への適用可否は未確定事項 1 (03 に検証結果を反映)。視聴 (Publishers) 側には適用しない (匿名視聴のため)。
- ストリームキー = 32 文字 URL-safe 乱数。stream 名そのものとして使用。再生成可 (旧キーの接続は REST DELETE で即切断)。

### D4: ビットレート制限はポーリング + 強制切断 + ブラックリスト

OME に ingest ビットレート上限機能は存在しない (調査確定)。`OmeStreamMonitorService` が 10 秒間隔で OME REST API をポーリングし、映像 3000kbps・音声 128kbps を 10% マージン付きで 3 回連続 (≒30 秒) 超過したら (1) REST DELETE で強制切断、(2) Redis ブラックリスト TTL 10 分 → AdmissionWebhooks で再接続拒否、(3) 配信者に通知。瞬間バーストは検知できない (ポーリング方式の限界) — あくまで防衛策としての位置づけ。

### D5: プレイヤーは OvenPlayer (npm) + `controls:false` + 自前 UI

- `ovenplayer` (MIT, v0.10.x) を npm 依存として採用。フォークはしない。WebRTC signalling の自前実装はしない (プロトコルが図解のみで仕様化されておらず難易度過剰)。
- dynamic import で OME 視聴時のみ遅延ロード (メインバンドルに含めない)。
- `MkOmePlayer.vue` (OvenPlayer ラップ + ミュート/音量/全画面のみの自前コントロール + 再接続 watchdog) / `MkTwitchPlayer.vue` (既存 iframe の切り出し) / `MkStreamPlayer.vue` (source 切替スイッチャー) の 3 コンポーネント構成。
- 両 source 同時ライブ時はプレイヤー右上のセグメントトグルで切替。片方のみなら自動選択。
- 再生 URL (SignedPolicy 含む) は backend が組み立てて返す。フロントに署名ロジックを置かない。

### D6: config は既存 twitch と同じ縮退方式

`.config/default.yml` に `ome:` ブロック (apiUrl / apiToken / admissionSecret / signedPolicySecret / publicSignallingUrl / publicRtmpUrl / publicSrtUrl / vhost / app / maxVideoBitrate / maxAudioBitrate)。必須項目が揃わなければ `config.ome = undefined` = 機能無効。Phase 1 (チャンネル基盤) は config.ome 非依存で完結する。

### D7: インフラは PVE2 の LXC + Docker

mi-host (Misskey 本番, VM 200) は PVE2 上にあり、OME を同ノードに置くことで同一 L2 直結になる (調査で確認済み)。LXC + Docker 構成 (クラスタ標準パターン)、rootfs は m2 (NVMe) プール、RAM 4GB / 4 vCPU から (PVE2 は swap 逼迫のため控えめに始めて実測調整)。AdmissionWebhooks は LAN 直 (`http://mi-host.msjp-local.org:3000/ome/admission`)。WAN 公開 (OPNsense NAT / HAProxy / DNS) は現行公開ポリシーの例外追加になるため、**すべて人間の承認後に実施** (01 §WAN 公開参照)。

## 4. 実装フェーズ

| Phase | 内容 | 依存 | 完了条件 (詳細は 06) |
|---|---|---|---|
| 0 | OME インフラ構築 (LAN 内疎通まで) | なし | OBS→OME→OvenPlayer デモ再生成功、bitrate 統計実測 |
| 1 | チャンネル基盤 backend (`live_channel`) | なし (0 と並行可) | 全 endpoint 動作、check-migrations/typecheck/e2e 通過 |
| 2 | OME 連携 backend (admission/監視/セッション統合) | 0, 1 | LAN 内で配信開始→通知→遮断→再接続拒否の一連が動く |
| 3 | チャンネルページ frontend | 1 | 3 状態×PC/モバイル/デッキの表示確認 |
| 4 | プレイヤー frontend | 2, 3 | Twitch⇔OME 切替・再接続・全画面の実機確認 |
| 5 | 統合検証・WAN 公開・本番デプロイ | 0-4 | e2e 全通過、実配信テスト、運用手順確立 |

各 Phase 内の作業順は定型: migration → entity → service → endpoint → `pnpm build-misskey-js-with-types` → frontend → 検証。最終チェックは `shipping-misskey-change` skill (lint / check-migrations / SPDX / ja-JP.yml / CHANGELOG) に従う。

## 5. 未確定事項

実装前または実装中に解消する。解消したら本表と該当文書を更新すること。

| # | 項目 | 解消方法 | 影響先 |
|---|---|---|---|
| 1 | SignedPolicy の webrtc/srt Provider 対応可否 | **ソース検証済 (2026-07-14)**: `AccessController::VerifyBySignedPolicy()` はプロトコル汎用実装で webrtc/srt も通る見込み。公式 doc の「rtmp のみ」は保守的記載と判断。最終確認は Phase 0 実機検証 (失敗時は rtmp のみに縮退、AdmissionWebhooks 単独で認可は成立) | 01, 03 |
| 2 | OSS v1 統計 API での視聴者数取得可否 | **ソース検証済 (2026-07-14)**: `GET /v1/stats/current/vhosts/{vhost}/apps/{app}/streams/{stream}` が OSS 版に存在 (`streams_controller.cpp`)。`totalConnections` は host レベルで実在確認、stream レベルはキー名の実機確認を Phase 0 で実施。並行して AdmissionWebhooks outgoing の Redis カウント方式も実装 (03 参照) | 03 |
| 3 | WHEP egress 対応の有無 | **ソース検証済 (2026-07-14)**: v0.20.5 時点で未実装 (2025 Roadmap に計画のみ)。視聴は OvenPlayer の独自 WebSocket signalling 一択 — D5 (OvenPlayer 採用) の裏付け | 解消済 |
| 4 | `bitrateLatest`/`bitrateAvg` の実挙動 (瞬間値/平均の意味) | Phase 0 実機検証 | 01, 03 |
| 5 | OBS WHIP の Bearer Token と SignedPolicy の統合方法 | Phase 0 実機検証。不可なら WHIP URL の query に直付け | 01, 03 |
| 6 | 公開 FQDN (`stream.msjp.pro` 案) と WAN 公開ポリシー例外 | **ユーザー承認済 (2026-07-14)**: FQDN は `stream.msjp.pro` に確定、WAN 公開ポリシー例外も許容。二重ルーター構成のため上位ルーターのポート開放 (人間の手動作業) が別途必要 — 開放ポート一覧は 01 §7.1.5 | 解消済 (作業は WI-0.5) |
| 7 | OME の視聴同時接続数の実用上限 (PVE2 リソース) | Phase 0/5 負荷試験。**ユーザー方針 (2026-07-14)**: RAM 控えめ開始で進め、PVE2 のメモリ圧があまりに厳しい場合は Coder スタック (CT 129 docker-coder 等) を PVE1 へ退避してリソースを確保する案を採る (退避作業は §11 Coder 規律に従い coder CLI 経由 + 別途計画) | 01 |

ライセンス注記: OME は AGPLv3 だが、改変せず公式イメージを実行するだけならソース開示義務は発生しない。OvenPlayer は MIT で npm 依存としての組み込みに問題なし。fork 本体の AGPL §13 論点は既存の保留事項のまま (本機能で新たな論点は増えない)。

## 6. 調査の出典

本設計は 2026-07-14 実施の 4 系統調査 (既存コードベース / OME 公式ドキュメント・ソース / OvenPlayer 公式 / PVE2 実機) に基づく。OME 仕様の一次出典 URL は 01・03 の各所に記載。既存コードの file:line 引用は執筆時点の `bsky-integration` HEAD に対するもので、rebase 後はずれる可能性がある — 実装時は必ず現物を確認すること。
