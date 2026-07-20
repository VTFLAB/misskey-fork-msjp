<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

# 08: Google Drive 配信アーカイブ 実装記録

## 位置づけ

本書は「ライブチャンネル」機能 (misskey-bsky-fork 独自配信システム、命名は `00-overview.md` §0 準拠) のうち、**配信終了後の録画視聴 (配信アーカイブ)** を Google Drive 連携で実現する機能の実装記録である。全ユーザーの録画データを自前インフラで保持するのは非現実的であるため、各ユーザーが自分の Google Drive 容量 (15GB 無料) の範囲で録画を保持する方式を採用した。

**2026-07-20〜21 セッションでコード実装完了 (未デプロイ)。** 当初のドラフト計画からいくつかの重要な設計変更があったため、本書は「実装記録」として実装済み内容を正として書き直している (旧ドラフトの WI 表は履歴として末尾に残す)。

前提として読んでおくと良いもの:
- `00-overview.md` — 用語・命名
- `03-backend-ome-integration.md` — OME 連携、OmeStreamMonitorService
- `05-frontend-player.md` — OvenPlayer 統合
- `07-consolidation-plan.md` — 「配信チャンネル」統合 (現在の `/live/:acct` はこの後の構造)

## ドラフトからの主な設計変更 (実装前調査で判明)

1. **OAuth callback は `/api` 配下ではない**。既存 `TwitchOAuthService`/`TwitchServerService` の実装パターンに倣い、`{config.url}/google-drive/oauth/callback` を `ServerService.ts` に prefix `/google-drive` で直接登録した (ドラフトの `/api/google-drive/oauth/callback` は誤り)。redirectUri は config に持たず導出。
2. **依存は `googleapis` でなく `@googleapis/drive`** (モジュラー版) を採用。
3. **設定画面は `settings/integration.vue` ではなく `settings/streaming.vue`**。2026-07-15 のチャンネル統合整備で Twitch 連携 UI もこのファイルに統合済みだったため、Google Drive 連携もここに追加した。
4. **配信終了検知は単一箇所ではなく3経路** (`OmeAdmissionService.handleClosing` = webhook、`OmeStreamMonitorService.detectEndedStreams` = poll、`OmeStreamMonitorService.cutStream` = ビットレート超過切断)。共通ヘルパー `TwitchStreamService.markOmeStreamEnded()` を新設し、既存の `markOmeStreamLive` と対称の形で3(4)箇所全てから呼ぶよう置換した。末尾で `LiveRecordingService.triggerRecording()` を fire-and-forget 起動する。
5. **OME File publisher は Server.xml から一度除去されていた** (PVE2 のメモリ圧迫対策、`01-infra-ome-setup.md` 参照)。本機能を有効化するには **インフラ側で再度追加する判断が必要** (下記「インフラ適用手順」参照)。コード実装はこの前提を織り込んでおり、`config.ome.recordingsDir` が未設定なら機能全体が縮退する。
6. **`.config/example.yml` に go記載のサンプルは追加していない**。既存の `twitch`/`ome` ブロックもこのファイルには記載例が無いため (本番値は homelab-ops 側で管理)、`google` ブロックも同様の扱いとした。
7. **`twitch/streams/show` の `sessions[]`** は既に (Twitch/OME ライブセッション用に) 実装済みだったため、「新規追加」ではなく「過去 (endedAt 非null) セッションの取得クエリ追加 + 録画フィールドの追記」として実装した。

## 実装済みアーキテクチャ

```
配信中 (変更なし):
  OBS → WHIP → OME (WebRTC publisher) → ライブ視聴者
  OBS → WHIP → OME (File publisher, ★要インフラ再有効化) → .ts on CT100 recordings volume

配信終了 (3経路のいずれかで検知、共通ヘルパー markOmeStreamEnded 経由):
  OmeAdmissionService.handleClosing (webhook, 最速)
  OmeStreamMonitorService.detectEndedStreams (10s poll、webhook 取りこぼしの保険)
  OmeStreamMonitorService.cutStream (ビットレート超過強制切断)
    ↓ (共通)
  TwitchStreamService.markOmeStreamEnded()
    - isLive=false, endedAt=now を保存 + streamEnded イベント配信 (既存動作、不変)
    - LiveRecordingService.triggerRecording(stream) を fire-and-forget 起動

LiveRecordingService.processRecording (非同期):
  1. 条件確認: source='ome' かつ config.google/config.ome.recordingsDir 設定済みかつ
     配信者が Google Drive 連携済み。満たさなければ recordingStatus='none' のまま何もしない
  2. 10秒待機 (OME がファイルをクローズするのを待つ)
  3. live_channel の streamKey で `*_${streamKey}.ts` を recordingsDir から検索、
     mtime が [startedAt-5min, endedAt+5min] の最新ファイルを採用
  4. status='remuxing' → fluent-ffmpeg `-c copy` で .ts→.mp4 (無劣化・高速)
  5. status='uploading' → GoogleDriveService.uploadRecording (resumable upload、
     permissions.create({type:'anyone', role:'reader', allowFileDiscovery:false}))
  6. status='processing'→'ready' (thumbnailLink 取得済みなら即ready)、fileId 等を DB 保存
  7. ローカルの .ts/.mp4 を削除 (成功・失敗いずれの経路でも実行、容量保護)

視聴:
  /live/:acct のチャンネルホーム「ホーム」タブ (オフライン時) → 配信アーカイブ一覧
    → recordingStatus='ready' のカードをクリック
    → インライン <iframe src="https://drive.google.com/file/d/{fileId}/preview">
  処理中 (pending/remuxing/uploading/processing) → 30秒ポーリングで状態更新
  失敗 (failed) → 配信者本人にのみエラー内容を表示
```

## 実装済みファイル一覧

### Backend

| ファイル | 内容 |
|---|---|
| `packages/backend/src/models/GoogleAccount.ts` | `MiGoogleAccount` entity |
| `packages/backend/migration/1784554189066-GoogleDriveArchive.js` | `google_account` テーブル + `twitch_stream` 録画6カラム追加 |
| `packages/backend/src/core/google/GoogleOAuthService.ts` | OAuth 認可URL生成・callback処理・token refresh・unlink (TwitchOAuthService 雛形) |
| `packages/backend/src/core/google/GoogleDriveService.ts` | resumable upload・permissions.create・processing status 照会 |
| `packages/backend/src/core/google/GoogleLoggerService.ts` | ログ用サブロガー |
| `packages/backend/src/core/live/LiveRecordingService.ts` | 録画パイプライン本体 (トリガー判定・remux・upload・後始末) |
| `packages/backend/src/server/google/GoogleDriveServerService.ts` | `GET /google-drive/oauth/callback` (ブラウザリダイレクト受け) + `GET /google-drive/about` (OAuth同意画面検証用の未ログイン静的ホームページ、下記参照) |
| `packages/backend/src/server/api/endpoints/google-drive/generate-oauth-url.ts` | 認可URL発行 API |
| `packages/backend/src/server/api/endpoints/google-drive/unlink.ts` | 連携解除 API |
| `packages/backend/src/server/api/endpoints/google-drive/my-account.ts` | 連携状態取得 API |
| `packages/backend/src/server/api/endpoints/google-drive/recording-status.ts` | 処理中アーカイブのステータス照会 (ポーリング用、認証不要) |
| `packages/backend/src/server/api/endpoints/twitch/streams/show.ts` (改修) | `sessions[]` に過去 (アーカイブ) セッションを追加、title/startedAt/endedAt/recordingStatus 等を返却 |
| `packages/backend/src/core/twitch/TwitchStreamService.ts` (改修) | `markOmeStreamEnded()`、`getRecentEndedOmeStreamsByUserId()` 追加 |
| `packages/backend/src/core/live/OmeAdmissionService.ts` / `OmeStreamMonitorService.ts` (改修) | 配信終了処理を `markOmeStreamEnded()` に一本化 |

### Frontend

| ファイル | 内容 |
|---|---|
| `packages/frontend/src/pages/settings/streaming.vue` (改修) | 「配信アーカイブ (Google Drive連携)」セクション追加 |
| `packages/frontend/src/pages/live-stream.vue` (改修) | `sessions` を channel-home へ受け渡し |
| `packages/frontend/src/pages/live-stream.channel-home.vue` (改修) | 「ホーム」タブに配信アーカイブ一覧 (カード・埋め込み再生・処理中ポーリング) を実装 |
| `locales/ja-JP.yml` (改修) | `_liveChannel` ブロックにアーカイブ関連キー追加 |

## 設定追加 (実装済み)

```typescript
// config.ts
google: {
  clientId: string;
  clientSecret: string;
} | undefined;

ome: {
  // ...既存フィールド
  recordingsDir?: string; // CT100 File publisher の出力先を backend から見えるローカルパスで指定
} | undefined;
```

`clientId`/`clientSecret` が未設定の場合は `config.google = undefined` = 機能無効 (既存 `twitch`/`ome` と同じ縮退方式)。`ome.recordingsDir` が未設定の場合も録画パイプラインは起動しない。

## データベース変更 (実装済み、migration `1784554189066-GoogleDriveArchive.js`)

`google_account` テーブル新規作成、`twitch_stream` に `recordingStatus`/`recordingFilePath`/`recordingFileSize`/`recordingGoogleDriveFileId`/`recordingGoogleDriveThumbnailLink`/`recordingError` の6カラムを追加。詳細はテーブル定義 (models/GoogleAccount.ts, models/TwitchStream.ts) を参照。

## OAuth 同意画面のブランディング要件対応 (2026-07-21 追記)

Google の審査で以下3点が指摘された:
1. ホームページ (mi.msjp.pro トップ) が未ログインだとログイン画面を表示する
2. ホームページにアプリの目的説明が無い
3. OAuth 同意画面のアプリ名「MixerStreamJP」とホームページのサイト名 (「えむえすじぇぴすきー」) が不一致

原因は mi.msjp.pro のトップページが Misskey インスタンス全体の一般公開エントランス
(`entrancePageStyle: classic`, `showTimelineForVisitor: false` の意図的な設定) であり、
「MixerStreamJP というアプリ」の説明ページではないこと。インスタンス全体の未ログイン挙動を
変更するのは影響範囲が広すぎるため、**専用の静的ページを追加**して対応した:

- `GET https://mi.msjp.pro/google-drive/about` — 認証不要・JS不要の静的 HTML。
  `<title>MixerStreamJP</title>` で OAuth 同意画面のアプリ名と完全一致させ、
  Google アカウント連携 (drive.file スコープ) の目的を明記。
- **新規 WAN 露出は不要** (`mi.msjp.pro` は全ユーザー登録オープンな公開インスタンスとして
  既に WAN 公開済みのため、HAProxy/OPNsense 側の変更は無し)。
- OAuth 同意画面の「ホームページ」設定値をこの URL に変更すること。

## 未完了・要インフラ対応 (コードのデプロイ前に必要)

- [ ] **Google Cloud Console 準備**: プロジェクト作成、Drive API 有効化、OAuth 2.0 クライアントID (Web application) 発行、リダイレクトURI `https://mi.msjp.pro/google-drive/oauth/callback` (**`/api` 配下ではない点に注意**、ドラフト当初の想定から変更)。ホームページURLは `https://mi.msjp.pro/google-drive/about` (上記参照)。取得した `clientId`/`clientSecret` を本番 config (homelab-ops 側) に投入。
- [ ] **OME File publisher の再有効化**: `01-infra-ome-setup.md` の経緯通り、CT100 の Server.xml から File publisher は一度除去されている (PVE2 メモリ圧迫のため)。再追加する場合:
  - `<Publishers>` に `<File><RootPath>/opt/ovenmediaengine/bin/recordings</RootPath><FilePath>${StartTime:YYYYMMDDhhmmss}_${Stream}.ts</FilePath></File>` を追加
  - compose.yml に `/opt/ome/recordings:/opt/ovenmediaengine/bin/recordings` volume を追加
  - CT100 のメモリ余裕を事前確認すること (除去した経緯の再確認が必要)
- [ ] **CT100→CT200 (mi-host) のファイル共有**: `config.ome.recordingsDir` で backend から参照できるよう、CT100 の `/opt/ome/recordings` を NFS 等で CT200 に mount し、Podman Quadlet の misskey-web コンテナに bind volume として追加する。現状この経路は未構築 (最大のインフラギャップ)。
- [ ] `pnpm check-migrations` は dev DB では clean 確認済みだが、**本番 DB への migration 適用はデプロイ時の通常フロー (`pnpm migrate` on container start) に従う**。

## 検証結果 (2026-07-20〜21、ローカル dev環境)

- [x] `pnpm lint` (全パッケージ typecheck + eslint + check-dts) — pass
- [x] `pnpm --filter backend check-migrations` — clean (up/down 双方向確認済み)
- [x] `pnpm build-misskey-js-with-types` — pass、autogen 型に反映済み
- [x] 新規ファイル全てに SPDX ヘッダー付与済み
- [x] `locales/ja-JP.yml` 以外の locale yml に差分なし
- [ ] backend e2e (`twitch.ts`/`live-channel.ts`) — 実行中/要確認 (このセッションの最終ステップ)
- [ ] 実機確認 (OAuth 認可フロー、実際の配信でのアーカイブ生成・再生) — インフラ対応完了後に実施

## 制約・リスクと緩和策 (ドラフトから継続)

| リスク | 緩和策 |
|--------|--------|
| Google Drive 動画処理遅延 (数分〜十数分) | 処理中はインジケータ表示。MP4 remux で高速化。30秒間隔ポーリングで完了検知 |
| 埋め込み iframe の Google ブランディング | 許容範囲。非表示にはできないが、実用上問題ない |
| upload 中にネットワークエラー | Resumable upload が自動再開。再開不能時は failed ステータス |
| refresh_token 無効化 (ユーザーが Google アカウント設定から解除) | `getValidAccessToken` が invalid_grant 検出時に google_account 行を削除、再連携を促す |
| CT100 rootfs 枯渇 | 録画は別 volume 想定、成功・失敗いずれでもローカルファイルを削除 |
| TS → MP4 remux 時の CT100 CPU 負荷 | ffmpeg `-c copy` は無負荷 (container変換のみ) |
| `drive.file` scope で `type: 'anyone'` 共有が可能か | 自アプリがアップロードしたファイルへの権限操作は scope 内。`allowFileDiscovery: false` で検索非表示 |
| ISP upstream 速度が遅い場合の upload 時間 | 非同期実行のため配信者・視聴者の UX に直接影響なし。`recordingStatus` で進捗表示 |

## 代替案 (実装しないが検討した案、ドラフトから継続)

| 案 | 不採用理由 |
|----|-----------|
| TNAS/NFS に録画保存 (Misskey インフラ側で全保持) | 自前インフラで全ユーザーのデータを保持するのは非現実的 |
| Versity S3 直接アップロード | OME が S3 非対応。sidecar が必要で複雑化 |
| ローカルダウンロードのみ提供 | UX が悪い (ユーザーが手動でダウンロード→アップロード) |
| LLHLS DVR (ライブ巻き戻し) | 要件が VoD のみのため不要。実装コスト高 |
