# misskey-bsky-fork — 次セッションへの引き継ぎ

## 🔥 最優先・未解決: コメント読み上げ (TTS) の多重再生 (2026-08-01)

**課題 (ユーザー定義)**: 音声読み上げが**前の再生終了を待たずに次のコメントの読み上げを開始してしまう**。数秒〜1秒以内に複数コメントが投稿されると読み上げ音声が2重以上で同時再生される。要求仕様は「常に再生される読み上げ音声は1つ。前の読み上げが完了してから次を読む」。丸1日かけて5回修正デプロイしたが**未解決**。

### 確定している事実 (証拠ベース、時系列)

1. 実装は `packages/frontend/src/composables/use-twitch-tts.ts`。AivisSpeech Engine (VOICEVOX互換, `http://127.0.0.1:10101`) に `/audio_query` → `/synthesis` して WAV blob を `new Audio(URL.createObjectURL(wav))` で再生する構成 (配信者ブラウザ内で完結、サーバー非関与)
2. **v4 診断マーカーがユーザーのコンソールに4回出力された** → チャンク分割により**モジュール複製が同一ページに4つロード**され、複製ごとに独立キュー・再生器が並走していたことが確定 (モジュールスコープのシングルトン前提が崩壊していた)
3. v5 で全状態を `globalThis.__msjpTwitchTtsState` の単一オブジェクトへ移動 → **マーカー1回 = キュー一本化は成功**
4. しかし v5 で **全コメントの `audio.play()` が `AbortError: The play() request was interrupted because the media was removed from the document.` で失敗** (ユーザーのコンソールで5連発を確認)。つまり**このタブからは1件も音が出ていない**にも関わらずユーザーには多重再生が聞こえている
5. → **最有力仮説: 発話している実体が複数ある**。Web Locks は同一ブラウザプロファイル内しか効かない。OBS のシーンには「コメジェネ」browser_source が存在し (OBSログで確認済み)、OBS の CEF は別ブラウザ。視聴ページを OBS カスタムブラウザドック/別ブラウザ/別端末で開いて TTS を有効化していれば、そちらが (おそらく旧コードで) 喋っている。**ユーザーにまだ確認できていない**

### 次セッションの手順 (この順で)

1. **【必須・最初に】ユーザーへ確認**: 視聴ページ (/live/:acct/stream) を開いている場所を全列挙してもらう — メインブラウザのタブ数 / OBS カスタムブラウザドック / OBS ブラウザソース / 別PC・スマホ。各所で F12 コンソールに `[TTS] pipeline vN` マーカーが出るか (= そこが喋っているか)。**2箇所以上で TTS 有効なら、それが多重再生の正体** (コード側では防御不能、TTS を1箇所に限定してもらう)
2. **AbortError の根治: HTMLAudioElement を廃止して Web Audio API へ置換** (設計済み、着手したが v5 デプロイ状態へ巻き戻し済み):
   - `state` に `audioContext: AudioContext | null` / `currentSource: AudioBufferSourceNode | null` を追加 (currentAudio を置換)
   - `synthesizeAndPlay`: `synthRes.arrayBuffer()` → `audioContext.decodeAudioData()` → `AudioBufferSourceNode` + `connect(destination)` + `start()`。blob URL / Audio 要素を一切使わない
   - **再生時間は `audioBuffer.duration` でデコード時点に確定** (PCMから算出、メタデータイベント不要)
   - **完了は `source.onended`** (バッファソースでは stop()時も自然終了時も確実に発火) **+ `duration + 1s` のタイマー**の二重化。settle は一度きり
   - `stopTtsSpeech` は `currentSource.stop()` (InvalidStateError は握り潰し)
   - AudioContext は suspended なら `resume()` (autoplay policy)。音量は audioQuery.volumeScale で適用済みなので GainNode 不要
   - 診断マーカーを v6 に更新
3. デプロイ後、ユーザーに **Ctrl+F5 → `[TTS] pipeline v6` を確認してから** 連投テストしてもらう。AbortError が消えて再生開始/終了の debug ログ (`[TTS] play start/end`) が交互に並ぶことを確認

### これまでのコミット (すべてデプロイ済み、v5 = 7e52cd5e6d が現行)

- `d42c81357c` キュー単一実行 (playing フラグ → processing Promise)
- `da24a2885e` タブ間オーナーロック (Web Locks) + コメントID二度読み防止 + 以下略 + URL読み替え + スラング辞書
- `5fdcaeeb00` 完了判定から pause 排除 + 音声長ウォッチドッグ
- `512fbd8b75` 再生自体の Web Lock 排他 + 診断ログ (v4)
- `7e52cd5e6d` globalThis シングルトン化 (v5) ← 現行。キュー一本化は達成、AbortError が残存
- 関連 (解決済み): 読み上げの翻訳スキップ (`b7e57290da` detectJaEn の w連続除外、URL除外は `da24a2885e` と同時期)、翻訳表示スキップも対応済み

### 環境情報

- 配信者PC: Ryzen 9 7945HX / Radeon RX 6700 XT (NVENC無し) / Windows 11 / OBS 32.2.1 / ブラウザは Edge 系 (コンソールに拡張機能 content-script.js のノイズあり)
- AivisSpeech Engine: `http://127.0.0.1:10101` (CORS 許可済み前提)。過去メモに vox-aivis CORS 403 の残課題あり (下記 残タスク6)
- テスト協力者: tamu2501。テスト用チャンネル: @VTF (/live/@VTF/stream)
- 本番デプロイ: push → Gitea Actions (~5分) → mi-host podman-auto-update (5分間隔)。**即時反映は `ssh pve-2 -- "qm guest exec 200 -- bash -c 'sudo -iu misskey podman auto-update'"`**。フロント変更はさらに**ブラウザの Ctrl+F5 が必須** (これを忘れて旧コードをテストする事故が本日複数回発生、診断マーカーで必ず世代確認すること)

## ⚠️ 次アクション: 視聴制限4モードの実地検証・コメントリプレイ精度確認 (2026-07-22時点)

**現在地**: アーカイブ視聴制限・MSJP内完結視聴・コメントリプレイ・削除機能は実装・push・本番デプロイ済み (`88f3db7a49` まで反映確認済み)。**Drive埋め込みプレイヤーの実機検証は完了・クローズ済み** (下記参照)。残る未検証は主に視聴制限4モードの実地検証とコメントリプレイの同期精度確認 (詳細は下の「未検証事項」)。

### 今回セッション (2026-07-22 後半) で完了した項目

1. **配信視聴ページの没入レイアウト修正**: デフォルトUI (universal) / 未ログイン (visitor) UI で配信視聴・アーカイブ視聴・OBSオーバーレイページを開くとサイドバー・ウィジェット等のグローバルUIが残留する不具合を修正 (`PageMetadata.immersive` 新設、commit `3ba526b12b`)。**重要な技術的発見**: Misskeyのルーティング (Nirax) は通常SPA内遷移 (`pushState`) のため `boot/main-boot.ts` は初回ロード時にしか実行されない。「特定パスだけUIモードを変える」対応は `main-boot.ts` のパス判定では機能せず (既存の `deck.useSimpleUiForNonRootPages` も同じ制約を受けている可能性がある)、`PageMetadata` (provide/inject でリアクティブに伝播) ベースの制御が必須。詳細はプロジェクトメモリ `live-streaming-immersive-layout-fix` 参照
2. **Drive埋め込みプレイヤーの実機検証完了 (クローズ)**: 事前コードレビュー (YouTube側で踏んだ「DOM要素置換によるVueバインディング焼き付き」問題は、Drive側が素の `<iframe>` のみで外部JS APIを使わないため構造的に発生しない、共有権限 `permissions.create(anyone/reader)` も正しく付与済み、Misskey側CSPもブロック要因なし、まで確認済み) → 実際に5分間OBS配信 → 終了 → バックエンドログ・DBで録画→Google Driveアップロード→アーカイブ登録の全パイプラインが正常動作することを確認。詳細はプロジェクトメモリ `live-streaming-drive-archive-verification` 参照
3. **NAS/OME/Misskeyインスタンス上のファイル残留チェック**: TNAS/CT100(OME)/CT200(mi-host)いずれも `.ts`/`.mp4` 実体ファイルの残留なし (`LiveRecordingService.cleanupFiles()` が正常機能、成功・失敗どちらの経路でも確実に削除される設計)。ただし `info/*.xml` 完了マーカーファイル (691バイト/配信) はクリーンアップ対象から漏れており配信のたびに残り続ける (軽微、実害僅少、対応保留)
4. **アーカイブ連携未設定ユーザーの録画抑制を確認**: `markOmeStreamLive` → `startRecordingIfEnabled` → `isRecordingEnabledForUser` のガードにより、Drive/YouTubeいずれも連携していないユーザーは `OmeApiService.startRecord` 自体が呼ばれず、OME側で録画ファイル (`.ts`) が一切生成されないことをコードレベルで確認済み (ストレージ消費面で健全な設計)
5. **YouTube埋め込みプレイヤーの音量デフォルト値修正**: 初期音量が100% (最大) だった問題を `onReady` 時の `setVolume(50)` で修正 (commit `071e4051a5`)。**Drive側は技術的に対応不可と確定** (Google Drive `/preview` 埋め込みには音量制御用のJS API/URLパラメータが一切存在しない。代替の `<video>` タグ直接埋め込みも「100MB超ファイルはウイルススキャン対象外で再生不可」という制約がありアーカイブ用途には不採用と判断。出典・詳細は basic-memory `tools/Google Drive iframe embed の音量制御は不可能` 参照)

**⚠️ 重大インシデント (次回必読)**: NASのファイル残留調査中に `built/.config.json` を安易に `cat` してしまい、複数のシークレット値 (`objectStorage.secretKey`/`twitch.clientSecret`/`ome.apiToken`/`ome.admissionSecret`/`ome.signedPolicySecret`/`google.clientSecret`) が会話ログに平文で出力される事故が発生した。ユーザーに開示済み、ローテーションの要否はユーザー判断待ち (2026-07-22時点で未対応)。**次回このプロジェクトで設定ファイルの中身を確認する必要がある場合、`cat`ではなく`grep`で該当キーのみ抽出すること**。詳細・教訓はプロジェクトメモリの feedback (`secrets-handling-config-json` 相当、下記参照) にも記録。

### 未検証事項・残タスク (優先順位順)

1. **視聴制限4モード (public/followers/password/users) の実地検証**: 実際にOBS配信→視聴制限を各モードに設定→終了→アーカイブ化→意図通り遮断/許可されるか。特にpasswordモードの `verify-archive-view-password` → `viewToken` → 再取得のフローをブラウザで
2. **コメントリプレイの同期精度**: YouTube再生位置とコメント表示タイミングのズレが体感で許容範囲か (プレイヤー自体の表示バグ・音量は修正済みなので、次はこの精度確認に進める)
3. **`archive-settings.vue` のフロント側パスワード必須バリデーション**: 現状バックエンドのfail-closeのみ、UXとしては改善余地あり
4. **Google OAuth再申請**: 前々回セッションで判明、前回の検証リクエストがキャンセルされていた (Gmail確認済み)。Cloud ConsoleでPublishing Statusを確認し、Testing/Internalになっていれば戻して再申請
5. `info/*.xml` マーカーファイルのクリーンアップ漏れ対応 (優先度低、実害僅少、`LiveRecordingService.cleanupFiles` に対応するinfoファイル削除を追加するだけの見込み)
6. vox-aivis CORS 403 (Twitch読み上げ機能、NixOS側 `--cors_policy_mode all` 追加要)
7. live-subtitle: googleエンジンのCORS実測・Chrome Translator API実機確認
8. upstream-sync cron復活 (stableリリース到達までブロック中、現在alpha.6)

### 実装した機能

1. **視聴制限の引き継ぎ** (最重要、当初のプライバシー問題への対応): `twitch_stream` に `archiveViewVisibility`/`archiveViewPassword`/`archiveVisibleUserIds`/`archiveUnpublishedAt` を追加。配信終了時 (`TwitchStreamService.markOmeStreamEnded`) に `live_channel` の視聴制限を**スナップショット**してコピーする (以後 `live_channel` 側を変えてもこのアーカイブの制限は変わらない)。`LiveArchiveAccessService.canWatchArchive()` が新設の認可判定ロジック (owner常時許可→public→followers→users→password)。アーカイブ設定画面から個別に上書き変更可能
2. **YouTube/Drive埋め込みの統一**: `channel-home.vue` の非対称実装 (YouTube=外部リンク/Drive=iframeトグル) を廃止し、新設の専用視聴ページ `/live/:acct/archive/:streamId` (`live-stream.archive-watch.vue`) への内部リンクに統一。`MkArchivePlayer`(dispatcher)+`MkYoutubeArchivePlayer`(IFrame Player API) を新設
3. **コメントリプレイ**: 新設 `XArchiveCommentReplay` (`live-stream.archive-comment-replay.vue`)。YouTube視聴時は `getCurrentTime()` を1秒ポーリングし再生位置に同期して段階表示 (シーク・巻き戻しにも自動追従)。**Drive視聴時は再生位置取得APIが存在しないため同期不可**、全コメントを時系列一覧で静的表示するのみ
4. **アーカイブ公開取り消し (削除機能)**: `twitch/streams/unpublish-archive`。**YouTube/Google Drive上の実ファイルは一切削除しない** (ユーザー明示の要件)。MSJP側の一覧・視聴・コメントリプレイから見えなくなるだけ、一方向のみ (再公開エンドポイントは無い)。`archive-history.vue` の確認ダイアログで「コメントリプレイも含めて閲覧不可になること」を警告

新規コメント投稿の無効化は、既存の `comments/create.ts` が既に `!stream.isLive` で弾く実装済みだったため追加実装不要だった。

### 設計上の重要な制約 (次に触るとき必読)

- **視聴制限の実効性はAPI層での情報秘匿まで**。ライブ配信は `OmeAdmissionService.decideOpening()` がOME WebRTC接続を直接遮断できるが、アーカイブ (Drive iframe/YouTube embed) はGoogle CDNから直接配信されMisskeyバックエンドを経由しないため、「非認可ユーザーにはAPIがYouTube video ID/Drive file IDを返さない」以上の遮断はできない (ユーザー確認済み・許容範囲)。認可済みユーザーがURLを直接転送すれば防げない
- **視聴制限はコメント読み取りにも適用したが、対象はアーカイブのみ**。`twitch/streams/comments.ts` は `stream.source==='ome' && !stream.isLive` の場合だけ `canWatchArchive()` を通す。ライブ配信中 (`isLive:true`) のコメント取得はOBSオーバーレイの匿名アクセス要件により無制限のまま (意図的に変更していない、回帰テスト有り)
- 視聴トークンはライブ用 (`ome:viewtoken:`, TTL12h, OME AdmissionWebhooksが消費) とは別のRedisキー空間 (`archive:viewtoken:`, TTL30日, API層のみが消費) を使う
- `settings/streaming.vue`・`live-stream.watch.vue`・`live-stream.chat.vue` は**一切変更していない** (ユーザー方針: 既存の安定コードに触れずアーカイブ側は独立実装、3箇所目の重複が生じたら将来 rule of three で共通化を検討)

### 実機検証で発見・修正したバグ (2026-07-22、YouTube側のみ)

デプロイ後ユーザーが実際に既存アーカイブ (`aoyo84e6hjmp000g`) を開いたところ、プレイヤー領域が真っ黒で何も表示されないと報告があった。調査の経緯 (次に類似の埋め込みバグを踏んだ時の参考に残す):

1. **最初に誤って「embeddable=falseが原因」と結論しかけた**。iframe内DOMを`page.frames()`経由で覗いたところ「見る」ボタン付きのプレビューカードが表示されており、これはembeddable=false動画の典型的挙動に見えた。ユーザーがYouTube Studioで確認したところ実際には埋め込み許可は有効で、この仮説は誤りだった (**disclose the correction**: 一度「これが原因」と報告したが、ユーザーの実機確認で覆り撤回した)
2. **oEmbed API (認証不要、200 OK) → YouTube本家では正常再生 (`readyState:4`) → 埋め込みiframeでは`<video>`に`src`すら付かず`readyState:0`のまま**、という切り分けで「embeddable以外の何かが埋め込み内でのみ阻害している」ところまで絞り込んだ
3. **ユーザーが実際のiframe HTMLソースを転記してくれたことで確定**: `style="visibility: hidden;"`が固定されたまま。**根本原因**: `MkYoutubeArchivePlayer.vue`で`new YT.Player(playerEl.value, {...})`に渡した`<div ref="playerEl" :style="{visibility:...}">`要素は、YouTube IFrame Player APIの仕様により**DOM上で直接`<iframe>`に置換される**。置換後のiframeはVueの仮想DOM管理から外れるため、置換前のインラインstyleがそのまま焼き付き、以後Vue側で`initializing`を更新しても反映されなくなっていた
4. **修正** (commit `88f3db7a49`、push・デプロイ・**ユーザー実機確認済み**): `playerEl`要素自体へのスタイルバインディングを撤去し、`MkLoading`側のz-indexオーバーレイ (v-ifで消える) のみで隠蔽する方式に変更。あわせて`initializing`解除のタイミングも`new YT.Player()`呼び出し直後 (誤り、生成完了≠準備完了) から`onReady`イベント内に修正した

**教訓**: YouTube IFrame Player API (および恐らく類似の「渡したDOM要素を丸ごと差し替える」系の外部ウィジェットAPI全般) を素のVue `ref` 要素に対して呼ぶ場合、その要素自体にリアクティブなバインディング (`:style`/`:class`等) を持たせてはならない。差し替え後の要素はフレームワーク管理外になるため、以後の更新が届かない。

### 未検証事項 (2026-07-22時点、Drive埋め込み検証は完了・冒頭セクション参照)

旧1〜4番 (Drive埋め込み検証・視聴制限4モード・コメントリプレイ精度・パスワードバリデーション) は
冒頭「未検証事項・残タスク」セクションに統合済み (Drive埋め込みは検証完了、他は引き続き残タスク)。
以下は参考情報として残す:

- **既存アーカイブへの`embeddable`遡及バックフィル**: 今回のテスト動画1件については embeddable 自体は元々有効だった (YouTube Studio確認済み) ため今回は不要だったが、もし将来的に「embeddable=falseの既存動画」に遭遇したら、`GoogleYoutubeService`から呼べる`videos.update`は現行スコープ (`youtube.upload`のみ) では`insufficient authentication scopes`エラーになることを確認済み。読み書きには`youtube`または`youtube.force-ssl`スコープの追加+ユーザー再認可が必要になる (今回はスコープ追加を避けYouTube Studioでの手動確認に倒した経緯がある)

### この機能群固有の環境の罠 (新規発見、2026-07-22)

- **re2ネイティブモジュールのABI不一致**: `pnpm --filter backend check-migrations` や `test:e2e` が `NODE_MODULE_VERSION 137/147 mismatch` (`ERR_DLOPEN_FAILED`) で落ちることがある。原因は `node_modules/.pnpm/re2@*/node_modules/re2/build/Release/re2.node` が実行中のnodeと異なるABIでビルドされている状態になっているため (何らかの操作でnode24向けに再ビルドされることがある模様)。直し方: node26のPATHが通った状態で `cd node_modules/.pnpm/re2@1.25.0/node_modules/re2 && npm run install` (プリビルドバイナリをGitHubから再取得する、ビルド不要で数秒で終わる)
- **`test:e2e` を直接vitestで実行する場合は事前に `compile-config` が必須**: `pnpm --filter backend test:e2e` は内部で `compile-config` を実行してから vitest を呼ぶが、`vitest run --config vitest.config.e2e.ts <file>` のように直接呼ぶと `.config/test.yml` が反映されずRedis接続先がデフォルトの `6379` に固定されてしまい `ECONNREFUSED` で全滅する。`NODE_ENV=test pnpm compile-config` を先に実行してから vitest を呼ぶこと
- ローカルdev DB (`migrations` 履歴テーブル) が空という既存の不整合が本セッション開始時点で存在した (前セッション由来、`pnpm migrate` が `Init` から再実行を試みて失敗する)。今回は各migrationの `up()` SQLを直接psqlで当てて整合性を確保した。根本的な解消は別タスク
- **mi-host上でGoogle API系の一時デバッグスクリプトを動かす場合**: `packages/backend`は`"type":"module"`なので拡張子は`.cjs`にする。`google-auth-library`はbackendの直接依存ではなくrequireできない (pnpm strict node_modules)。`@googleapis/youtube`が`auth.OAuth2()`を再エクスポートしているのでそちらを使う (`GoogleYoutubeService.buildClient`と同じパターン)。トークンrefreshは生fetchで`https://oauth2.googleapis.com/token`に`grant_type=refresh_token`をPOSTするだけで良い (`GoogleOAuthService.refreshToken`と同じ、google-auth-library不要)。DB接続情報は`built/.config.json`の`db`ブロックに`user`/`pass`が無い (Quadlet側で別注入されている模様、深追いせず`podman exec misskey-postgres psql`経由でトークンだけ一時ファイル抽出する方が早い)
- **`built/.config.json`を直接`cat`しない (2026-07-22、実際に事故発生)**: `objectStorage.secretKey`/`twitch.clientSecret`/`ome.apiToken`等の複数シークレットが平文で丸ごと出力される。特定キーの値だけ確認したい場合は必ず`grep -A2 <key>`等で絞り込むこと

### 実装ファイルの要点 (新規)

- `packages/backend/src/core/live/LiveArchiveAccessService.ts` — アーカイブ視聴認可の中核。`canWatchArchive`/`issueArchiveViewToken`/`resolveArchiveViewToken`/`updateArchiveSettings`/`unpublishArchive`
- `packages/backend/src/server/api/endpoints/twitch/streams/{verify-archive-view-password,update-archive-settings,unpublish-archive}.ts`
- `packages/backend/test/e2e/twitch-archive-view-restriction.ts` — 20ケース、canWatchArchiveの6分岐+password検証+設定変更+公開取消+コメント制限の回帰テスト
- `packages/frontend/src/components/{MkArchivePlayer,MkYoutubeArchivePlayer}.vue` — `MkYoutubeArchivePlayer`は上記バグ修正済み (commit `88f3db7a49`)
- `packages/frontend/src/pages/live-stream.{archive-watch,archive-comment-replay,archive-settings}.vue`
- 改修: `twitch/streams/{show,comments,archive-history}.ts`、`TwitchStreamService.ts`(`snapshotArchiveViewRestriction`)、`GoogleYoutubeService.ts`(embeddable)、`channel-home.vue`、`archive-history.vue`
- 承認済み設計計画の全文: `/home/vtf/.claude/plans/scalable-snuggling-sky.md` (詳細な設計判断の根拠はここを参照)

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
