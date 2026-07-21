# misskey-bsky-fork — 次セッションへの引き継ぎ

## 🔴 次スレッド: アーカイブ視聴をMSJP内で完結させる (コメントリプレイ・削除機能) (2026-07-22 時点、最優先・未着手)

作業ツリーは clean、`bsky-integration` は `origin` と一致 (`1f2a26d64f` まで push 済み、本番デプロイ・実機検証済み)。配信アーカイブの録画パイプライン自体 (前スレッド) はクローズ済みで、これは**その先の視聴体験の作り込み**。ユーザーからの要望 (2026-07-22) は以下の通り、**実装はまだ一切していない、次セッションでゼロから着手すること**。

### 要望 (ユーザー原文の要旨)

1. 現状「チャンネルの履歴から直接YouTubeに飛ぶ」仕様になっているが、そうではなく**MSJP (Misskeyインスタンス) 上で完結する視聴体験**にしたい
2. 当時のライブ配信中のチャット (コメント) を**復元して表示**する
3. 動画プレイヤーは**埋め込み**でMSJP上に表示
4. アーカイブ視聴中は**新規コメント投稿は無効化** (あくまで過去の再現、書き込み不可)
5. 可能であれば**動画の再生時間に同期してコメントが出現する** (YouTubeのライブアーカイブのチャットリプレイと同じ体験)
6. **アーカイブを削除できる機能**も必要

### 事前調査で判明した現状 (2026-07-22、Explore調査済み、コード未変更)

**A. 現状の視聴UI**:
- `packages/frontend/src/pages/live-stream.channel-home.vue` (50-141行目): Drive側は**既にiframe埋め込み実装済み** (`<iframe :src="https://drive.google.com/file/d/${fileId}/preview">`, 133-138行目)。**YouTube側は外部リンクのみ** (`<a href="https://www.youtube.com/watch?v=...">`, 53-65行目)、埋め込みは無い。しかも `youtubeVideoId != null` なら常にYouTubeリンクが優先され、Drive iframeは表示されない (129行目の条件分岐)。
- `live-stream.archive-history.vue` (配信者本人向け): 状態バッジ+YouTubeキャンセルボタンのみ、埋め込み・削除ボタンいずれも無し。

**B. コメント永続化 (最重要、設計の土台)**:
- テーブル `MiTwitchStreamComment` (`packages/backend/src/models/TwitchStreamComment.ts`) に配信中コメントは既に永続化されている (`streamId`/`source`/`userId`/`text`/`fragments`等)。**`createdAt`カラムは存在せず**、Misskey ID (ULID) から `idService.parse(comment.id).date` で生成時刻を逆算する設計。動画同期には `コメント生成時刻 (ID由来) - stream.startedAt` のオフセット計算が必要 (`stream.startedAt`は`MiTwitchStream.startedAt`として実在)。
- 履歴取得API `twitch/streams/comments.ts` (streamId+sinceId/untilId/limit) が**既に終了済みセッションでもそのまま動作する設計**、これを流用できる見込み。
- **無期限保存、削除処理は現状無い** (CASCADE削除はstream行自体が消えた場合のみだが、その削除経路も無い)。

**C. YouTube埋め込みの可否 (要検証)**:
- `privacyStatus` (`public`/`unlisted`/`private`、配信者が選択可能、デフォルト`unlisted`) の embeddable 可否は**コードから確認できず、YouTube側の一般仕様として `private` は埋め込み再生不可の可能性が高い**(未検証、次セッションで実機確認要)。埋め込みiframeの実装はフロント/バック全体で0件、新規実装が必要。

**D. 削除機能の現状**:
- アーカイブ削除APIは存在しない。`GoogleDriveService.deleteFile(userId, fileId)` (`GoogleDriveService.ts` 139-152行目) は**実装済みだが内部処理専用** (リトライ時の一時ファイル掃除のみ)、ユーザー向け削除には未使用。
- YouTube動画の削除メソッド (`videos.delete`) はバックエンド全体で0件、新規実装が必要。**現在のOAuthスコープは`youtube.upload`のみで、このスコープで`videos.delete`が許可されるか未検証** (次セッションで最初に確認すべき事項、許可されなければスコープ追加+再認可フローが必要になり手戻りが大きい)。

### 次セッションで最初にやるべきこと (推奨順)

1. **YouTube APIのスコープ・embeddable検証を最優先で行う** (上記C/D、これ次第で設計が変わる大きな不確定要素)。`youtube.upload`スコープで`videos.delete`が呼べるか、`privacyStatus: 'unlisted'`の動画がembed可能か、実際にAPIを叩いて確認してから設計を確定させること (Googleの複数プロダクトスコープ絡みで過去2回設計をやり直した教訓を踏まえ、小さなテストを先にすること)
2. YouTube埋め込みiframe実装 (`live-stream.channel-home.vue`のDriveパターンを踏襲、130行目前後を参考に)
3. コメントリプレイ機能: `twitch/streams/comments.ts`で該当streamIdの全コメント取得→フロントで動画再生位置(currentTime)と`コメント時刻オフセット`を突き合わせて逐次表示するロジックを新規実装。YouTube IFrame Player APIの`getCurrentTime()`が使えるはず (Drive埋め込み`/preview`形式は再生位置取得APIが乏しい可能性があり、Drive視聴時は同期リプレイを諦める/劣化させる判断もありうる、要検討)
4. アーカイブ視聴モードでの新規コメント投稿無効化 (既存のコメント入力コンポーネントをreadonly化 or 非表示)
5. 削除機能: Drive側は`deleteFile`を新規endpoint経由でユーザーに公開するだけで比較的軽い。YouTube側は新規削除メソュード実装+DB側のレコード扱い(アーカイブ一覧から除外する方式か、レコード自体削除か)を設計すること

## ✅ 完了スレッド: 配信アーカイブ (Google Drive + YouTube) — OME側インフラ構築+実機検証 (2026-07-21〜22 クローズ)

### 現在地: バックエンド/フロントエンド実装+OME側インフラ+実機検証まで全て完了、本番稼働中

前セッション終了時点では「バックエンド/フロントエンド実装は完了、OME側インフラが未着手のため機能は実質休眠中」だったが、本セッションで全て解消しクローズした。

**最大の見落とし (当初の引き継ぎの前提が誤りだった)**: 「Server.xmlにFile Publisherを追加すれば自動的に録画される」という前提は誤りで、実際のOME (v0.20.5) はREST API (`POST /v1/vhosts/{vhost}/apps/{app}:startRecord`/`:stopRecord`、bodyの`stream.name`でstreamKey指定、streamKeyをURLパスに含めると`404 Controller not found`になる) の明示的呼び出しが必要だった。これは実機検証で発見し、`OmeApiService.startRecord`/`stopRecord`を新規実装、`TwitchStreamService`の配信開始/終了検知(`markOmeStreamLive`/`markOmeStreamEnded`)から呼ぶ形で対応した(commit `1f2a26d64f`)。

**インフラ構築の要点**:
1. TNAS (192.168.1.33) に `ome-recordings` NFS共有を新設 (`omv-rpc`経由、`all_squash`+クライアント別anonuid/anongidでUID不一致を吸収)
2. CT100 (OME, unprivileged LXC) は user namespace 制約で直接NFS mount不可と判明 → PVE2ホスト側でNFS mount + `pct set 100 -mp0` でbind mountする方式に変更
3. CT200 (mi-host、実体はQEMU VM) は直接NFS mount可能、Quadletに `Volume=/mnt/nfs-recordings:/misskey/recordings:Z` 追加
4. Server.xml `<Publishers>`最後尾に`<FILE>`(全大文字、`<File>`だと`Unknown item found`でOMEクラッシュ、実機で一度発生させ即ロールバック済み)追加
5. `homelab-ops`のIaC (`config/default.yml`) に `google:` ブロックが存在しない (IaC外で直接投入されていた) ことを発見。放置すると`deploy.sh`実行時に本番の値ごと消える、過去の`admissionSecret`消失事故と同型の罠だったため先に復元 (homelab-ops commit `0fb964b0a7`)

**実機検証結果 (2026-07-22)**: OBS実配信で全パイプライン (録画開始→NFS上にファイル生成→配信終了→rename+remux→YouTubeアップロード→DB更新→クリーンアップ) が正常動作することを確認。CT100/CT200のブートディスク使用量は録画前後で無変化 (NAS直接読み書き設計の裏付け)。

詳細な設計・トラブルシューティング記録は `doc/live-streaming/08-google-drive-timeshift.md` の「インフラ構築記録」節、プロジェクトメモリ (`~/.claude/projects/-home-vtf-projects-misskey/memory/`) を参照。

### この機能スレッドの実装経緯 (2026-07-20〜22、6 commit)

| commit | 内容 |
|---|---|
| `b3dd8abe0a` | 配信アーカイブ (Google Drive連携) 追加。OAuth (`drive.file`+`openid`+`email`)・remux→アップロードパイプライン・設定UI一式 |
| `2d5bf833a2` | YouTube直接アップロード追加 (v1: Drive/YouTube独立ON/OFF・並行アップロード方式) |
| `f0f4ab6dc4` | **v2 に全面書き換え**: YouTube優先+クォータ超過時Driveフォールバック+1時間ごとのBullMQリトライキュー。ユーザーからの「YouTube日次クォータが厳しいのでキュー方式にすべき」という設計指摘を受けて再設計 |
| `cda127e263` | **OAuthスコープ統合の破棄**: `drive.file` と `youtube.upload` は同一ユーザー+同一OAuthクライアントに対し「単一リクエストでも `include_granted_scopes=true` の段階的追加でも同時に許可できない」ことが実機検証 (Error 400: invalid_request, "scopes that cannot be requested together") で判明。Drive/YouTube用トークンを `google_account` テーブル内で完全に独立したカラム (`youtubeAccessToken`/`youtubeRefreshToken`/`youtubeExpiresAt`/`youtubeScopes`) として持つよう作り直した |
| `8262ec871d` | YouTube単独連携解除ボタン追加 (Drive→YouTube段階認証の非対称性を解消)。**Google OAuth審査完了まで一般ユーザーが機能を使えないため、配信アーカイブ機能全体 (Google Drive/YouTube連携セクション・配信アーカイブ履歴リンク) を `iAmAdmin` 限定表示にする暫定措置** |
| `1f2a26d64f` | **OME録画REST API連携を追加**。`OmeApiService.startRecord`/`stopRecord`新設+`TwitchStreamService`の配信開始/終了検知から呼ぶ配線。録画要否判定は`LiveRecordingService.isRecordingEnabledForUser`として開始/終了両方の経路で共通化。これで前セッションまで休眠していた録画パイプラインが実際に動くようになった |

**学び (次に同種の機能を作るとき用)**:
- Googleの複数プロダクトスコープ (今回は Drive と YouTube) は、同一 OAuth クライアント + 同一ユーザーに対して同時に許可できない組み合わせが存在する。実装前に小さなテストで実際に両スコープを同時取得できるか検証してから設計すべきだった (今回は本番デプロイ後の実機検証で発覚し、2 回の設計やり直しが発生した)。
- OMEのようなサードパーティ製ミドルウェアの「設定を追加すれば自動的に機能する」という思い込みは危険。File Publisherは典型例で、設定を足しただけでは動かず、REST APIの明示的な呼び出しが必要だった。ドキュメントの記述を鵜呑みにせず、実機のAPIレスポンスで確認してから設計・実装すべき。

### Google OAuth 審査 (テストユーザーでの検証は完了、一般公開はまだ)

- `satellite.doll@gmail.com` (VTF) をテストユーザーに登録し、Drive→YouTube 両方の段階認証に成功済み
  (`google_account` テーブルで `drive_linked=t`, `youtube_linked=t` を確認済み)
- スコープ使用方法の説明文・デモ動画要件の回避手順 (テストユーザーモードでの撮影) はプロジェクトメモリ
  `youtube-upload-oauth-verification-text` に保存済み。**アプリ公開申請時に再展開すること**
- YouTube Data API v3 のクォータ増枠申請は未着手 (デフォルト 10,000 units/日 ≒ 1 日 6 アップロード)

### 実装ファイルの要点

- `packages/backend/src/core/live/LiveRecordingService.ts` — 録画パイプライン中核。`youtubeUploadEnabled`
  で Drive-only / YouTube優先+Driveフォールバック を分岐。`isRecordingEnabledForUser`が録画要否判定の単一入口
- `packages/backend/src/core/live/OmeApiService.ts` — OME REST APIクライアント。`startRecord`/`stopRecord`は
  appレベルエンドポイント+body `stream.name`形式 (streamKeyをURLに含めると404になる罠に注意)
- `packages/backend/src/core/twitch/TwitchStreamService.ts` — `markOmeStreamLive`/`markOmeStreamEnded`が
  配信開始/終了の唯一の入口。`stopRecordingIfNeeded`は`OmeAdmissionService.decideOpening`経由で
  AdmissionWebhooks応答(3000msタイムアウト)として同期awaitされる経路があるため絶対にfire-and-forgetのまま維持すること
- `packages/backend/src/queue/processors/YoutubeUploadRetryProcessorService.ts` — 1時間ごとの
  リトライキュー (`core/QueueService.ts` の `REPEATABLE_SYSTEM_JOB_DEF` に登録)
- `packages/backend/src/core/google/{GoogleOAuthService,GoogleDriveService,GoogleYoutubeService}.ts`
- `packages/frontend/src/pages/settings/streaming.vue` (Section 2/2.5, `iAmAdmin` 限定表示中、Google審査完了後に解除)
- `packages/frontend/src/pages/live-stream.archive-history.vue` — 配信者本人向け履歴確認画面 (これも `iAmAdmin` 限定表示中)
- `homelab-ops/misskey/{config/default.yml,deploy.sh,quadlet/misskey-web.container}` — `google:`ブロック/
  `ome.recordingsDir`/NFS Volume。IaCとして正しく管理されている状態 (前セッションまでの`google:`欠落は解消済み)

---

## ✅ 完了スレッド: AT-proto残検対応 (2026-07-15、詳細ユーザー未共有のまま完了扱い)

上記YouTube/Driveスレッドの前に予定されていた「残検対応」は、本ファイルへの記録が無いまま
別セッションで解消済みと判断 (作業ツリーが2026-07-15時点でclean だった形跡)。詳細が必要になったら
git log (`39f5680267`〜`b3dd8abe0a` 間) を確認すること。

---

## ✅ 完了スレッド: ライブ配信 / 配信チャンネル (2026-07-15 クローズ)

**AT-proto (Bluesky 統合) スレッドとは別。** ライブチャンネル (自己配信、OME=OvenMediaEngine連携)
機能は **Phase 0〜5 完了・本番 `mi.msjp.pro` デプロイ済み・実機検証済み**。さらに独自「配信チャンネル」
への導線統合整備 (2026-07-15) も **完了・6課題すべて実機検証で問題なし・クローズ**。

このスレッドで新規に着手すべき残作業は無い。詳細な一次情報は以下:

- 設計: `doc/live-streaming/00〜06`(元設計)、`doc/live-streaming/07-consolidation-plan.md`(統合整備の確定計画)。
- プロジェクトメモリ(セッション開始時に自動ロードされる `MEMORY.md` 索引):
  - `live-streaming-channel-consolidation` — 2026-07-15 配信チャンネル統合(最新・クローズ)。
  - `live-streaming-tls-handoff` — OME TLS 終端 + 本番デプロイ。
  - `live-streaming-phase0〜4-*` — 各フェーズ実装詳細。

### 2026-07-15 統合整備で入れた変更(push済み・本番反映済み、`18195999dd..39f5680267`、18コミット)

- native `MiChannel` はコアに編み込まれ破棄不可 → **ノート集約エンジンとして裏に存置、discovery導線のみ
  配信チャンネルへ置換**、が確定原則(今後もこの原則を守る)。
- `MiChannel.isLiveChannel` フラグで native channels 検索/featured/owned から配信用チャンネル除外(既存データ backfill済)。
- `live-channels/list` API + `/live` 配信チャンネル一覧ページ(配信中バッジ、Twitch中継はタブ統合)。
- navbar「配信チャンネル」へ一本化(native `channels` エントリ撤去、`/channels` ルートは残置)、deck の
  channel カラムを配信チャンネル選択へ転用(既存プロファイル後方互換)。
- 自動配信開始ノート(`live_channel.autoPostNoteEnabled`/`autoPostNoteTemplate`、ON/OFF可、視聴URL自動埋込)。
- offline反映 ≤10s化(`OmeStreamMonitorService.detectEndedStreams`、reconcile 2分は自己修復で存置)。
- navbar 既定順を `preferences/def.ts menu.default` で調整。**ナビ並びは各ブラウザ localStorage 保存で
  サーバー同期はオプトイン → 管理者側から全ユーザー強制リセットは不可**(既定変更は未カスタマイズ者のみ反映)。

### 完了(2026-07-16、旧・保留事項)

- **WI-0.5 WAN公開**: 完了・実機検証済み。`stream.msjp.pro` は Cloudflare proxied A レコード → 上位ルーター
  443 → OPNsense rdr (source cloudflare_v4 限定) → HAProxy 443 TLS 終端 (`is_ome_stream_host` ACL を
  `ext_ok` に追加) → OME 3333 の経路で WAN 公開済み(設計書 §7 原案の「3333/3334 HAProxy 素通し・専用
  frontend」は不採用)。メディア (UDP 10000-10009 / TCP 3478) は上位ルーター→OPNsense WAN→192.168.1.111
  の NAT (XML 直接追記) で開通。`${PublicIP}` STUN 解決が二重 NAT 環境でも真のグローバル IP に正しく
  解決されることも実機確認済み。外部3拠点・Docomo/Softbank 実回線での視聴成功を確認。詳細は
  `doc/live-streaming/06-implementation-phases.md` WI-0.5 完了メモ、`01-infra-ome-setup.md` §7.5/§7.6。

### この機能群で不変の環境の罠(次に触るとき用)

1. **Node 26 必須**: PATH 先頭に nix store の nodejs-26(`.node-version`=26.4.0。ハッシュは
   `find /nix/store -maxdepth 1 -iname "*nodejs-26*"` で都度探す)。デフォルト node v24 は re2 ABI 不一致で
   全 pnpm スクリプトが落ちる。pnpm は `/home/vtf/.npm-global/bin/pnpm`。
2. **check-migrations**: 新規 migration の DDL は `nix-shell -p postgresql` の psql で dev DB
   (127.0.0.1:5432 postgres 無pass test-misskey)へ**直接 up() 適用**して clean 確認。`pnpm migrate` は
   dev DB の typeorm migrations テーブル desync で Init から失敗するため使わない。制約/カラム名は
   check-migrations 実出力で確認、手書き推測名禁止。
3. **本番 DB dump 手順が未確立**: mi-host (CT200) は rootless podman、DB は pod 内で 5432 未公開。
   デプロイ前バックアップは今回 **PVE VM200 スナップショット**で代替した。pod内 pg_dump するなら
   misskey ユーザーの `XDG_RUNTIME_DIR=/run/user/10000` でコンテナ特定が要る(`sudo -iu misskey`)。
4. **locale は `locales/ja-JP.yml` のみ編集**、backend API 変更後は `pnpm build-misskey-js-with-types` 再生成。

---

## ⚠️ 最優先で読むこと (2026-07-02 更新、AT-proto統合スレッド)

1. **作業ディレクトリが2つ存在し、片方が origin から乖離している。**
   - `/home/vtf/projects/misskey/misskey-repo` — このセッションで実際に commit/push した**最新かつ正**のコピー。`origin/bsky-integration` と完全に一致 (`e2fecef474` まで)。
   - `~/Document/misskey-bsky-fork` (実体 `/mnt/data/seafile/documents/misskey-bsky-fork`) — Seafile 同期の旧コピー。**`upstream-sync.yml` の自動 rebase (`git push --force-with-lease`) で origin 側の履歴が書き換わった結果、ローカル HEAD が origin と非 fast-forward に乖離している** (`git fetch` すると `(forced update)` と出る)。このディレクトリで作業を再開する場合は、まず以下で同期を取ってから始めること (ローカルに未push の独自 commit が無いことを確認した上で):
     ```fish
     cd ~/Document/misskey-bsky-fork
     git fetch origin
     git log --oneline origin/bsky-integration..HEAD   # 何か出たら要確認、force-pushで消えた古い履歴の可能性が高い
     git reset --hard origin/bsky-integration           # ★destructive、内容確認してから実行
     ```
   - 次回セッション開始時は **`/home/vtf/projects/misskey/misskey-repo` を使うことを推奨**。もし `~/Document/misskey-bsky-fork` を使い続けるなら、上記の同期を毎回冒頭で確認する。
2. **「1人用 private fork」という前提はもう古い。** 2026-07-01 に運用実態を修正済み。現在は**完全オープン登録・連合オープンの小規模公開インスタンス**。コードリポジトリ自体は非公開のまま。詳細・AGPL-3.0 §13 (source-offer 義務) の未解決論点は本ファイル下部の「Fork 固有」セクションおよび `CLAUDE.md` の「プロジェクト目的」を参照。
3. ~~地震速報機能にPWA/OSプッシュ通知が届かない既知のギャップがある。~~ **本セッションで対応済** (アップデート情報のpush欠落も合わせて修正)。backendの通知パイプライン (作成→pack→API露出) は実サーバー起動+実API呼び出しで検証済み。**ブラウザでの実OS通知描画のみ未検証** — 「次回セッションの推奨開始ポイント」の先頭に詳細。

## TL;DR

**本番運用中 + CI/CD 自動化済**。`mi.msjp.pro` (CT 200 mi-host VM on pve2) で fork image が稼働中。
直近 30 日分の backfill 込みで Bluesky の post を取り込み、avatar/banner も DriveFile 化済。
LTL から除外、GTL / HTL に流入、検索可。あわせて AT-proto 以外の独自機能 (MFM ツールバー、絵文字一括
インポート、アップデート情報、天気予報ウィジェット、地震速報) も追加済み (詳細は後述セクション)。

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

上記テーブルは 2026-05-19 時点のスナップショットで一部古い (follow アカウント数等は未再確認)。以下は 2026-07-02 時点で確認済の差分のみ:

| 項目 | 2026-07-02 時点 |
|---|---|
| git HEAD (`bsky-integration`) | `e2fecef474` (origin と一致) |
| upstream base | v2026.6.0 (`BASE_VERSION` bump 済、`5210b6a1b3`) |
| 本番 image (rolling) | `git.msjp.pro/vtf/misskey-bsky-fork:bsky-latest` → digest `075b815d68e2...` (地震速報機能デプロイ後) |
| 運用形態 | **公開小規模インスタンスへ移行済** (完全オープン登録・連合オープン)。コードリポジトリは非公開のまま。詳細は本ファイル冒頭の「⚠️ 最優先で読むこと」参照 |
| ソースの正 | `/home/vtf/projects/misskey/misskey-repo` (このセッションの作業コピー、origin と同期済) |

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

## 追加機能 (AT-proto 以外、2026-06〜07 のセッションで追加、bsky-fork 独自)

AT-proto integration とは独立した、一般的な UX/運用改善機能。misskey-tempura (別の Misskey フォーク)
の changelog を参考に洗い出した候補リストがプロジェクトメモリ `tempura-feature-candidates` にあり、
今後の機能追加もそこを起点に検討する。

| 機能 | 内容 | commit |
|---|---|---|
| MFM 構文挿入ツールバー | 投稿フォームに MFM タグを挿入するツールバー (`MkMfmToolbar.vue`) | `1bd2d1a973`, `13561a09a8`, `7a1e93df2e` |
| リモート絵文字一括インポート | 検索結果のリモートカスタム絵文字を全件一括取り込み、同名絵文字は上書き | `79b9ae7bd8` |
| アップデート情報機能 | 「お知らせ」とは別に、フォーク独自機能の更新をコントロールパネルから告知。公開すると通知経由で全ユーザーに届く。管理: `admin/update-info/*`、閲覧: `update-info/show`, `update-infos` | `e0c64275b4` |
| 天気予報ウィジェット | 緯度・経度・地点名を設定し、Open-Meteo API (無料・APIキー不要) から現在の気温・天気・湿度・風速を取得表示。`get-weather` エンドポイントがサーバー側でプロキシ | `0dad6740b7` |
| 地震速報 (JMA EEW) | Wolfx (https://wolfx.jp) の WebSocket feed をサーバー側で購読し、`earthquakeAlert` broadcast ストリームで全接続中クライアントへ配信 → `os.toast` で通知。直近30件の履歴を返す `earthquake/history` エンドポイントと `WidgetEarthquakeHistory.vue` も追加。実装は `AtpJetstreamService` と同じ接続 watchdog + 指数バックオフパターンを踏襲 (heartbeat による無音死活判定は EEW の性質上不採用) | `e2fecef474` |
| 地震速報/アップデート情報の PWA push 対応 | 新規通知type `earthquakeAlert` を追加し重要イベント (isWarn初回/isFinal/警報後isCancel) のみ全ユーザーに通知 + push。アップデート情報はService Worker側のcase文欠落 (push自体は届くがOS通知が汎用フォールバックになる) を修正。DB migration不要 (`notification.type`はRedis Stream上のJSON discriminantでPostgres enumではない) | 未commit (このセッション) |

## 解決した bug (staging/production 検証で発見) — 学び

| # | 症状 | 根本原因 | 修正 |
|---|---|---|---|
| 1 | atproto コード一切実行されず、bundled CoreModule に atproto 参照無し | host の `packages/backend/built/` が `.dockerignore` のネスト不一致で build context に混入。runner stage 末尾の `COPY . ./` が native-builder 由来の新 chunk を host の古い chunk で上書き | `.dockerignore` に `**/built/`, `packages/*/built/` 追記 + host のクリーン (`295ce91`) |
| 2 | `/api/atproto/search` が `APPVIEW_UNAVAILABLE: fetch failed` | Node 22 built-in fetch は undici dispatcher を期待するが Misskey の HttpRequestService は `node:https.Agent` を返す型不一致 (`@ts-expect-error` 抑制で隠れていた) | plain fetch に切替、dispatcher 渡しを廃止 (`529da51`) |
| 3 | main + worker 二重 Jetstream 購読、`refreshSubscription()` で close→connect race により 2 つの WS が並走 | `cluster.isPrimary` ガード無し + closeWs 後の close handler が独自に scheduleReconnect を呼ぶ | cluster gating + `suppressNextReconnect` フラグ (`169440f`) |
| 4 | 連続 follow で WS が "connecting" 状態のまま固まり再接続しない | `closeWs()` で `connecting=false` を戻していなかった + 古い WS の handler が新 WS を null 化 | closeWs で connecting 明示クリア + handler 内で `this.ws !== ws` でステイル判定 + refreshSubscription で disconnect 状態を検出して蘇生 (`694be54`) |
| 5 | follow しても `following` テーブルに行が入らない | Misskey の `UserFollowingService.follow` は local→remote follow を **AP follow request** として扱い Accept 待ち。pseudo-MiUser には inbox 無く永遠に pending | env `FORCE_FOLLOW_REMOTE_USER_FOR_TESTING=true` で即時 follow に切替 (Quadlet に追加) |
| 6 | profile アイコンが未表示 | Misskey の pack 関数は `avatarId IS NULL` の場合 `avatarUrl` 値を捨て identicon にフォールバック | DriveService.uploadFromUrl で MiDriveFile 作成、avatarId を non-null に (`d3e620f`) |

## API (本 fork 専用、AT-proto integration 関連)

すべて `requireCredential: true`、auth は通常の Misskey access token (`Authorization: Bearer ...`)。
(旧記載「private 運用」は 2026-07-01 に訂正済み、現在は公開インスタンス — 認証必須なのは元々の設計判断で変更なし):

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

- ~~#1 CHANGELOG 未記載~~ — 2026-06 以降のセッションから `CHANGELOG.md` の `## Unreleased` に fork 独自機能を記載する運用に変更済み (`(bsky-fork 独自)` 表記)。private fork 前提で skip していたが、AGENTS.md の shipping-misskey-change スキル運用と合わせるため復活させた。

8. **Avatar URL の SVG fallback**: Bluesky の avatar が無い user の場合 `profile.avatar` が undefined。今は何もしないので identicon になる。Misskey 流の挙動と一致しているので問題なし。

9. **upstream rebase**: 自動化済 (`.gitea/workflows/upstream-sync.yml` が毎日 03:00 JST に試行 → conflict 時のみ Issue 起票)。conflict 期待ファイル: `CoreModule.ts` の flat 列挙、`MiUser.ts` の atDid column 周辺、`endpoint-list.ts`。**force-push で履歴が書き換わるため、ローカルクローンの同期に注意** (本ファイル冒頭「⚠️ 最優先で読むこと」参照)。

### 対応済 (2026-07-02 セッションで追加)

- ~~#10 地震速報の PWA/OS プッシュ通知~~ — 対応済。新規通知type `earthquakeAlert` (DB migration不要、`notification.type` はRedis Stream上のJSON discriminantでありPostgres enumではないため) を追加し、`EarthquakeAlertService` に `NotificationService`/`UsersRepository` を注入。通知欄が埋まらないよう **重要イベントのみ push** (該当EventIDでisWarnが最初にtrueになった瞬間 / isFinal / 警報後のisCancel) に絞り込み、それ以外の中間serialは既存の `publishBroadcastStream` トーストのみ。フロントは `MkNotification.vue` に表示分岐、`settings/notifications.vue` の `nonConfigurableNotificationTypes` に追加 (updateInfoと同様、relationshipベースではないシステム通知のため受信設定の対象外)。判定ロジックのユニットテストを `test/unit/EarthquakeAlertService.ts` に追加。
- ~~アップデート情報の push 未着(見落とし)~~ — 対応済。バックエンドの通知パイプラインは既に配線済みだったが、Service Worker側 (`packages/sw/src/scripts/create-notification.ts`) に `updateInfo` のcase文が無く、push自体は届いてもOS通知は汎用フォールバック (`Misskey vX`) にしかならなかった。case追加 + クリックで `/updates/{id}` へ遷移する分岐を `sw.ts` に追加して解消。

### 新規 (2026-07-02 時点、未着手)

11. **AGPL-3.0 §13 (Remote Network Interaction) の扱い**: 稼働インスタンスを公開ネットワークサービスとして提供している以上、corresponding source 提供義務がリポジトリ非公開のままで良いかという論点が未整理。結論保留 (詳細はプロジェクトメモリ `bsky-scope-correction` および `CLAUDE.md` プロジェクト目的セクション参照)。
12. **tempura 機能候補の継続検討**: misskey-tempura (別 Misskey フォーク) の changelog から洗い出した候補リストがプロジェクトメモリ `tempura-feature-candidates` にある。スパム対策 (FriendlyCaptcha・メール認証)・モデレーション系が完全オープン登録の現状では優先度高。
13. **地震速報/アップデート情報 push のブラウザ実機検証未実施**: backendの通知パイプライン (実サーバー起動 → `admin/update-info/create` / 実DIコンテナ経由の `NotificationService.createNotification` → `/api/i/notifications` で正しくpackされた結果を確認済み) とフィルタリングロジック (ユニットテスト) は検証済み。**未検証なのはSW (`create-notification.ts`) の実ブラウザ実行によるOS通知の実描画とクリック遷移のみ** — frontend dev server起動 + push購読 + 実際にOS通知が正しいタイトル/本文で出るかの目視確認が必要 (次セッションの最優先タスク)。

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

0. **作業ディレクトリの確認**: `/home/vtf/projects/misskey/misskey-repo` を使うか、`~/Document/misskey-bsky-fork` を使うなら本ファイル冒頭「⚠️ 最優先で読むこと」の同期手順を先に踏む
1. **状態確認**: `mi.msjp.pro/api/meta` の version、`git log --oneline -5` が origin と一致しているか、`/atproto/search` の 401 (= endpoint 生存) を最初に見る
2. **地震速報 / アップデート情報 push のブラウザ実機検証** (TODO #13、未着手): 本セッションでcommit済。backendパイプラインは実サーバー起動+実API呼び出しで検証済みだが、SWによる実際のOS通知描画・クリック遷移は未確認。frontend dev server起動 → push購読 → `admin/update-info/create` および同様の手口でearthquakeAlert通知を発生させ、OS通知の表示・クリック遷移を目視確認してから本番デプロイすること
3. **tempura 機能候補からの追加実装** (TODO #12): プロジェクトメモリ `tempura-feature-candidates` 参照。完全オープン登録の現状ではスパム対策 (FriendlyCaptcha・メール認証) が費用対効果高い
4. **新規バグ報告**: ユーザーから「○○が動かない」と来たら、まず該当ログを `journalctl ... | grep atproto` (atproto以外の機能なら該当ロガー名、例 `earthquake`) で抽出。Phase 6 で 6 件のバグを見つけたパターン (staging で再現 → 直す → 本番に当てる) を踏襲
5. **upstream rebase**: 自動化されているが (`.gitea/workflows/upstream-sync.yml`)、conflict 時は Issue が立つのでそれを見て手動 rebase。conflict は `CoreModule.ts` の flat 列挙箇所が主

## 参照する CLAUDE.md / docs / プロジェクトメモリ

- `/home/vtf/projects/misskey/misskey-repo/CLAUDE.md` (= `/mnt/data/seafile/documents/misskey-bsky-fork/CLAUDE.md`) — fork 全体の規約。「Fork 固有」セクション (`---` より下) に運用実態 (公開インスタンス化・AGPL論点) を記載
- `/home/vtf/.claude/CLAUDE.md` — global rules (§3 WAN, §4 destructive, §11 backup)
- `/mnt/data/seafile/documents/homelab-ops/CLAUDE.md` — mi-host 側の運用規律
- Claude Code プロジェクトメモリ (`~/.claude/projects/-home-vtf-projects-misskey/memory/MEMORY.md` から辿る、セッション開始時に自動ロードされる): `bsky-scope-correction` (公開インスタンス化の経緯・AGPL §13論点)、`tempura-feature-candidates` (今後の機能候補)、`update-info-feature` / `mfm-toolbar-post-form` / `bsky-jetstream-lag-fix` / `bsky-cursor-keyprefix-false-alarm` (個別機能・障害対応の詳細)
- `/tmp/atproto-staging/README.md` — staging スクリプトの説明
