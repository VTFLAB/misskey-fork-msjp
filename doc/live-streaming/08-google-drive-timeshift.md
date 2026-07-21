<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

# 08: Google Drive 配信アーカイブ 実装記録

## 位置づけ

本書は「ライブチャンネル」機能 (misskey-bsky-fork 独自配信システム、命名は `00-overview.md` §0 準拠) のうち、**配信終了後の録画視聴 (配信アーカイブ)** を Google Drive 連携で実現する機能の実装記録である。全ユーザーの録画データを自前インフラで保持するのは非現実的であるため、各ユーザーが自分の Google Drive 容量 (15GB 無料) の範囲で録画を保持する方式を採用した。

**2026-07-20〜21 セッションでコード実装完了、2026-07-21〜22 セッションで OME 側インフラ構築+実機検証まで完了、本番デプロイ済み。** 当初のドラフト計画からいくつかの重要な設計変更があったため、本書は「実装記録」として実装済み内容を正として書き直している (旧ドラフトの WI 表は履歴として末尾に残す)。

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
5. **OME File publisher は Server.xml から一度除去されていた** (PVE2 のメモリ圧迫対策、`01-infra-ome-setup.md` 参照)。2026-07-21〜22 セッションで再追加・本番稼働まで完了した (下記「インフラ構築記録」参照)。コード実装は `config.ome.recordingsDir` が未設定なら機能全体が縮退する設計を維持している。
8. **File Publisher は配信開始と同時に自動録画しない (2026-07-22 実機検証で判明、重要)**。当初 `HANDOFF.md` の引き継ぎは「Server.xml に File Publisher を追加すれば自動的に録画される」という前提だったが、実際の OME (v0.20.5) は REST API `POST /v1/vhosts/{vhost}/apps/{app}:startRecord` / `:stopRecord` の明示的呼び出しが必要 (ボディで `stream.name` を指定、streamKey は URL パスに含めない — `.../streams/{streamKey}:startRecord` という形式は `404 Controller not found` になることを実機で確認済み)。このため `OmeApiService.startRecord`/`stopRecord` を新設し、`TwitchStreamService.markOmeStreamLive`/`markOmeStreamEnded` (配信開始/終了検知の唯一の入口) から fire-and-forget で呼ぶ実装を追加した。録画要否判定 (Drive/YouTube連携チェック) は `LiveRecordingService.isRecordingEnabledForUser(userId)` として開始判定・終了判定の両方から共有する形に共通化した。
6. **`.config/example.yml` に go記載のサンプルは追加していない**。既存の `twitch`/`ome` ブロックもこのファイルには記載例が無いため (本番値は homelab-ops 側で管理)、`google` ブロックも同様の扱いとした。
7. **`twitch/streams/show` の `sessions[]`** は既に (Twitch/OME ライブセッション用に) 実装済みだったため、「新規追加」ではなく「過去 (endedAt 非null) セッションの取得クエリ追加 + 録画フィールドの追記」として実装した。

## 実装済みアーキテクチャ

```
配信開始 (markOmeStreamLive、OmeStreamMonitorService.detectStartedStreams / OmeAdmissionService.afterOpeningAllowed から):
  OBS → WHIP → OME (WebRTC publisher) → ライブ視聴者
  markOmeStreamLive → startRecordingIfEnabled (isRecordingEnabledForUserがtrueの場合のみ)
    → OmeApiService.startRecord(streamKey, streamId) — POST .../apps/{app}:startRecord
      body: {"id": streamId, "stream": {"name": streamKey}}
    → OME File publisher が録画開始、一時ファイル名 (tmp_<random>) で書き込み

配信中の物理経路 (2026-07-22 構築):
  CT100 (OME) の recordings volume → PVE2ホスト (192.168.1.3) が NFS クライアントとして
  TNAS (192.168.1.33) の ome-recordings 共有をマウント → `pct set 100 -mp0` で CT100 に
  bind mount (unprivileged LXC は user namespace 制約で直接 NFS mount 不可のため、
  ホスト側マウント+bind 方式を採用)
  CT200 (mi-host、実体は QEMU VM) は自身で直接 NFS マウント (VM は該当制約なし)
  → Quadlet Volume=/mnt/nfs-recordings:/misskey/recordings で misskey-web コンテナに bind

配信終了 (4経路のいずれかで検知、共通ヘルパー markOmeStreamEnded 経由):
  OmeAdmissionService.handleClosing (webhook, 最速)
  OmeStreamMonitorService.detectEndedStreams (10s poll、webhook 取りこぼしの保険)
  OmeStreamMonitorService.cutStream (ビットレート超過強制切断)
  OmeAdmissionService.decideOpening (再接続時の旧セッション閉鎖)
    ↓ (共通)
  TwitchStreamService.markOmeStreamEnded()
    - isLive=false, endedAt=now を保存 + streamEnded イベント配信 (既存動作、不変)
    - stopRecordingIfNeeded(stream) を fire-and-forget 起動
      → OmeApiService.stopRecord(streamKey, streamId) — POST .../apps/{app}:stopRecord
      → OME が一時ファイルを ${StartTime:YYYYMMDDhhmmss}_${Stream}.ts に rename +
        info/${StartTime}_${Stream}.xml (完了マーカー) を生成
    - LiveRecordingService.triggerRecording(stream) を fire-and-forget 起動
    ※ decideOpening 経由の呼び出しは OmeServerService.ts で AdmissionWebhooks の応答として
      3000ms 以内に await される経路のため、stopRecordingIfNeeded は絶対に同期 await しない
      (fire-and-forget 必須、実コードで確認済みの制約)

LiveRecordingService.processRecording (非同期):
  1. 条件確認: source='ome' かつ isRecordingEnabledForUser(userId) (config.google/
     config.ome.recordingsDir 設定済みかつ配信者が Drive連携済みまたはYouTube有効)。
     満たさなければ recordingStatus='none' のまま何もしない
  2. 10秒待機 (OME がファイルをクローズ・renameするのを待つ)
  3. live_channel の streamKey で `*_${streamKey}.ts` を recordingsDir から**単一階層のみ**検索、
     mtime が [startedAt-5min, endedAt+5min] の最新ファイルを採用
  4. status='remuxing' → fluent-ffmpeg `-c copy` で .ts→.mp4 (無劣化・高速)
  5. status='uploading' → YouTube優先アップロード、クォータ超過時のみDriveへフォールバック
     (GoogleYoutubeService / GoogleDriveService.uploadRecording、resumable upload)
  6. status='processing'→'ready' (thumbnailLink 取得済みなら即ready)、fileId/videoId等を DB 保存
  7. ローカルの .ts/.mp4 を削除 (成功・失敗いずれの経路でも実行、容量保護。
     info/*.xml は OME 自身の完了マーカーで Misskey の削除対象外、そのまま残置される)

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

## インフラ構築記録 (2026-07-21〜22、完了)

- [x] **Google Cloud Console 準備**: プロジェクト作成・Drive API 有効化・OAuth 2.0 クライアントID発行・リダイレクトURI `https://mi.msjp.pro/google-drive/oauth/callback` 登録済み。`clientId`/`clientSecret` は `homelab-ops/misskey/secrets/google.env` (off-repo、Twitch/OME と同型) 経由で本番投入 (`deploy.sh` が `sed` 置換)。**この `google.env` は IaC 管理外で直接投入していたため、`homelab-ops` 側の `config/default.yml` に `google:` ブロックのプレースホルダーが存在しない状態だった** (次の項参照)。
- [x] **homelab-ops IaC の `google:` ブロック欠落を発見・復元**: `deploy.sh` は IaC 側の `default.yml` を本番へ `scp` で上書きするため、IaC にブロックが無いと本番の値が消える。過去の `admissionSecret` 消失事故 (commit `330a169445`) と同型の罠。`config/default.yml`/`deploy.sh` にプレースホルダー+置換ロジックを追加して解消 (homelab-ops commit `0fb964b0a7`)。
- [x] **OME File publisher の再有効化**: Server.xml の `<Publishers>` ブロック**最後尾** (既知の罠: OME は `<FILE>` が最後の要素でないと binding エラーになる。タグ名も `<File>` ではなく **`<FILE>` 全大文字**、これを誤って一度本番でクラッシュさせ即ロールバックした実機教訓あり) に追加:
  ```xml
  <FILE>
    <RootPath>/opt/ovenmediaengine/bin/recordings</RootPath>
    <FilePath>${StartTime:YYYYMMDDhhmmss}_${Stream}.ts</FilePath>
    <InfoPath>info/${StartTime:YYYYMMDDhhmmss}_${Stream}.xml</InfoPath>
  </FILE>
  ```
  `AdmissionWebhooks><Enables>` は `webrtc` のみで `file` は含まれない = File Publisher は admission webhook 対象外であることを実機確認済み。CT100 のメモリは実測 available 9.4GiB (PVE2ホスト全体) で「進めてよい」水準と判断、File Publisher自体の追加コストは軽微 (CT100は4GB中93MB使用のほぼアイドル状態)。
- [x] **CT100→TNAS→CT200 のファイル共有 (NFS)**: 当初想定 (CT100→CT200 直接マウント) から設計変更。TNAS (192.168.1.33、OpenMediaVault) に `ome-recordings` 共有フォルダを新設し、`omv-rpc` 経由で NFS エクスポート (`ome.msjp-local.org`/`mi-host.msjp-local.org` 個別、`rw,all_squash,anonuid=<後述>,anongid=<後述>,no_subtree_check,sync`) を構築。
  - **CT100 (unprivileged LXC) は user namespace のカーネル制約で NFS を直接 mount できない** (AppArmor/seccomp の問題ではなく、NFSv3/v4 いずれも同一の EPERM で失敗することを実機で確認し、当初の「AppArmor が nfs4 を許可していない」という診断は誤りだったと後に訂正)。**PVE2ホスト自身が NFS クライアントとしてマウントし、`pct set 100 -mp0 <hostpath>,mp=/mnt/nfs-recordings` で CT100 に bind mount する方式** (Proxmox 標準パターン) を採用、ホットプラグで再起動不要。
  - CT200 (mi-host、実体は QEMU VM) は user namespace 制約が無いため直接 NFS mount 可能。
  - **UID/GID 不整合**: OME コンテナは Docker 内 root 実行 (CT100 内 uid0 は idmap で PVEホスト側 uid100000)、Misskey は rootless podman (uid991→ホスト misskey uid10000)。TNAS exports の anonuid/anongid を **CT100向け=100000、CT200向け=10000** とクライアントごとに分けて設定し、`all_squash` で個々の実UIDを吸収。加えて共有フォルダの実ディレクトリに `chmod o+w` (所有権 10000:10000 は維持) を1回実施し、両クライアントからの書き込みを両立させた。
  - Quadlet `misskey-web.container` に `Volume=/mnt/nfs-recordings:/misskey/recordings:Z` を追加、`config.ome.recordingsDir: '/misskey/recordings'` を設定。
- [x] `pnpm check-migrations`: 本機能は entity/migration 変更なし (前回セッションで完結済み)、対象外。
- [x] **録画トリガー方式 (最大の見落とし、下記「設計変更 #8」参照)**: File Publisher 追加だけでは録画されないことが判明し、`OmeApiService.startRecord`/`stopRecord` の新規実装が必要になった。OME REST API の正しい形式 (streamKey は URL でなく body の `stream.name`) も実機検証で確定した。
- [x] **実機検証 (2026-07-22)**: OBS実配信で全経路を確認。`ome stream online` → `recording started` → NFS上に一時ファイル(`tmp_*`)生成 → 配信終了で `recording pending` → ファイルが `${StartTime}_${Stream}.ts` にrename+`info/*.xml`生成 → remux (`.mp4`生成) → `youtube upload complete` (実際の videoId 発行) → DB `recordingStatus='ready'`/`youtubeUploadStatus='ready'` → NFS上の `.ts`/`.mp4` 削除 (`info/*.xml`のみ残置) を確認。CT100/CT200双方のブートディスク使用量が録画前後で無変化であることも確認 (詳細は上記リスク表)。

## 検証結果

### 2026-07-20〜21、ローカル dev環境

- [x] `pnpm lint` (全パッケージ typecheck + eslint + check-dts) — pass
- [x] `pnpm --filter backend check-migrations` — clean (up/down 双方向確認済み)
- [x] `pnpm build-misskey-js-with-types` — pass、autogen 型に反映済み
- [x] 新規ファイル全てに SPDX ヘッダー付与済み
- [x] `locales/ja-JP.yml` 以外の locale yml に差分なし
- [x] backend e2e (`twitch.ts`/`live-channel.ts`) — pass

### 2026-07-22、本番実機検証

- [x] **OAuth 認可フロー**: `satellite.doll@gmail.com` (テストユーザー) で Drive→YouTube 段階認証済み (前セッションで確認済み、継続有効)
- [x] **OME REST API 単体検証**: `startRecord`/`stopRecord` の正しいリクエスト形式を実機で確定 (上記「設計変更 #8」参照)
- [x] **実配信でのアーカイブ生成・再生**: OBS実配信で全パイプライン (録画開始→ファイル生成→検知→remux→YouTubeアップロード→ステータス更新→クリーンアップ) が正常動作することを確認済み。詳細は上記「インフラ構築記録」末尾を参照
- [x] **CT100/CT200 ブートディスク影響**: 録画前後でディスク使用量無変化を確認 (NAS直接読み書き設計の裏付け)
- [x] `pnpm lint` (今回のOME連携コード追加分、`OmeApiService.ts`/`LiveRecordingService.ts`/`TwitchStreamService.ts`) — pass

## 制約・リスクと緩和策 (ドラフトから継続)

| リスク | 緩和策 |
|--------|--------|
| Google Drive 動画処理遅延 (数分〜十数分) | 処理中はインジケータ表示。MP4 remux で高速化。30秒間隔ポーリングで完了検知 |
| 埋め込み iframe の Google ブランディング | 許容範囲。非表示にはできないが、実用上問題ない |
| upload 中にネットワークエラー | Resumable upload が自動再開。再開不能時は failed ステータス |
| refresh_token 無効化 (ユーザーが Google アカウント設定から解除) | `getValidAccessToken` が invalid_grant 検出時に google_account 行を削除、再連携を促す |
| CT100/CT200 ブートディスク枯渇 | 録画(.ts)・remux後(.mp4)とも `recordingsDir` (NFS mount先、TNAS実体) に直接読み書きし、ローカルディスクを経由しない設計。2026-07-22 実機テストでCT100/CT200双方のディスク使用量が録画前後で無変化であることを確認済み (成功・失敗いずれの経路でも `cleanupFiles()` でNFS上の.ts/.mp4を削除、info/\*.xmlのみ残置) |
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
