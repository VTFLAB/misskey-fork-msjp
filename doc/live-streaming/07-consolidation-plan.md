# 07. ライブ配信の「配信チャンネル」統合計画

作成日: 2026-07-15
ブランチ: bsky-integration
承認済み方針: 「配信チャンネルに一本化」「全項目一括実装」。

## 0. 決定事項の要約

- native `MiChannel` はコア(NoteCreateService/検索/featured/全TL/realtime、計57ファイル依存)の都合で **破棄しない**。ノート集約エンジンとして裏に存置し、discovery導線のみ配信チャンネルへ寄せる。
- 混在解消は **`MiChannel.isLiveChannel: boolean` フラグ追加方式**を採用(JOIN方式より低リスク・将来拡張性高・事故検知容易)。
- `/live` を配信チャンネル一覧ページに転用。Twitch中継一覧は同ページ内タブとして統合(別ページ化しない)。デフォルトタブは「配信チャンネル」。
- **navbar の native `channels` エントリは撤去**し、`liveStreams` を「配信チャンネル」へ改称・昇格(ユーザー裁定: 小規模ゆえ native チャンネル運用は見込まない、到達不便な導線を配信チャンネルへ一本化)。`/channels` **ルート自体は残置**(既存ブックマーク/深リンク保全、live-stream.channel-home が内部で channels/timeline を使うため)。
- デッキ `channel` カラムは配信チャンネル選択UIへ転用(columnType名 `'channel'` は影響範囲が広いため維持、ラベル・選択導線・配信中表示のみ変更)。既存保存済み native channelId を指すカラムはフォールバック表示継続。
- 自動配信開始ノート(ON/OFF + テンプレート)と offline検知短縮(≤10s)を追加。

## 1. 実行順序(逐次3フェーズ、subagent委譲)

`LiveChannelService.ts` / `OmeStreamMonitorService.ts` / `TwitchStreamService.ts` を複数WIが触るため、**並行worktreeではなく逐次実行**で衝突を根絶する。

- **Phase BE-1(backend データ/API層)**: WI-1(isLiveChannelフラグ+バックフィル+channels除外) + WI-2(一覧API)。misskey-js再生成。
- **Phase BE-2(backend monitor/投稿層)**: WI-6(自動ノート) + WI-7(offline短縮)。BE-1完了後の作業ツリーに対して実施。misskey-js再生成。
- **Phase FE(frontend)**: WI-3(/live再構築) + WI-4(navbar統合) + WI-5(deck転用) + WI-6のUI(settings/streaming)。再生成済み型を使用。
- **中央検証**: shipping-misskey-change チェックリスト + e2e regression → diff提示 → 承認後 push。

---

## WI-1: `isLiveChannel` フラグによる native channels 系除外

- `models/Channel.ts`: `@Column('boolean', { default: false }) isLiveChannel` 追加。
- migration `AddIsLiveChannelToChannel`: `ALTER TABLE "channel" ADD "isLiveChannel" boolean NOT NULL DEFAULT false`。**check-migrations で制約/カラム差分を確認してから確定**。
- migration `BackfillIsLiveChannelFlag`(別コミット): `UPDATE "channel" SET "isLiveChannel" = TRUE WHERE id IN (SELECT "channelId" FROM live_channel WHERE "channelId" IS NOT NULL)`。既存本番データ対応。
- `LiveChannelService.ts` create() と show()のlazy-init 2箇所の `channelsRepository.insertOne` に `isLiveChannel: true` を追加(追従漏れ厳禁)。
- 除外を入れる endpoint: `channels/{search,featured,owned}.ts` に `.andWhere('channel.isLiveChannel = FALSE')`。
- 除外**しない**: `channels/{show,timeline}.ts`(配信チャンネルホームが引き続き使用)。
- misskey-js再生成(Channel型変更)。

コミット: (1)entity+migration (2)service set (3)backfill migration (4)endpoints除外 (5)autogen再生成。

## WI-2: 配信チャンネル一覧API

- 新規 `endpoints/live-channels/list.ts`。`requireCredential: false`、`sinceId/untilId/limit` ページネーション(`channels/search`同型)。
- res各要素: `id,userId,name,description,bannerUrl,offlineImageUrl,channelId,isLive,startedAt,user`。
- `LiveChannelService` に一覧用 `packForList` 新設(既存 pack は streamKey分岐を持つため一覧用に分離)。`enabled=TRUE` 起点 + `twitch_stream(source='ome',isLive=true)` を別クエリ取得→Map突合(`twitch/live-streams.ts`同パターン、少数想定でDBサブクエリ不要)。
- endpoint-list.ts 登録。misskey-js再生成。

コミット: (1)list endpoint。

## WI-6: 自動配信開始ノート(BE-2)

- `models/LiveChannel.ts`: `autoPostNoteEnabled boolean default false` / `autoPostNoteTemplate varchar(512) nullable`。
- migration `AddAutoPostToLiveChannel`(check-migrations確認)。
- `live-channels/{update,show,my,create}.ts`: paramDef/res追加。show は他人閲覧用途のため template は本人のみ返す(pack owner-only分岐)。create初期値 false/null。
- `LiveChannelService.update()`/`pack()` に2フィールド反映。
- `TwitchStreamService.markOmeStreamLive` の notifyFollowers 直後に投稿処理:
  - `NoteCreateService` + `UsersRepository` を DI 追加(**循環依存チェック必須** — NoteCreateService が Twitch系を参照していないか CoreModule 依存グラフ確認)。
  - `liveChannelsRepository.findOneBy({userId})` で enabled/template/channelId 取得、無効ならスキップ。
  - テンプレ既定: `「{title}」の配信を開始しました 📡 {url}`(title無しは「配信を開始しました 📡 {url}」)。
  - プレースホルダ: `{title}`,`{url}`=`config.url + '/live/' + username`,`{channelName}`。`replaceAll`、未知プレースホルダは残置(フェイルセーフ)。
  - `NoteCreateService.create(user, { text, channel: nativeChannelEntity, ... })`(data.channel渡しで public/localOnly=true 化)。
  - 失敗時ログのみ(fire-and-forget、配信開始検知をブロックしない)。
- `settings/streaming.vue`: MSJP配信セクション内に ON/OFF トグル + テンプレート入力。i18n `_liveChannel` へ追加。

コミット: (1)entity+migration+endpoints (2)TwitchStreamService投稿ロジック (3)frontend設定UI。

## WI-7: offline反映短縮(BE-2)

- `OmeStreamMonitorService`: `reconcileWithOme()` の offline判定を `private detectEndedStreams(streamKeySet)` に切り出し。10秒 `pollTimer` で `detectStartedStreams()` 取得済みの `listStreams()` 結果を使い回して `detectEndedStreams()` を呼ぶ(**OME API呼び出し回数を増やさない**)。`reconcileWithOme`(2分)は自己修復として存置。

コミット: (1)offline短縮。

## WI-3/4/5: frontend(FE)

- WI-3 `/live`: `pages/live-streams.vue` を配信チャンネル一覧へ。新規 `pages/live-channels.card.vue`(配信中バッジ付き)。既存 `live-streams.card.vue` は Twitch中継カードとして残す。`MkTab` で「配信チャンネル」(default)/「Twitch中継」。
- WI-4 navbar: `navbar.ts` の `liveStreams` を title=`i18n.ts._liveChannel.liveChannels`(既存 `_liveChannel` namespace再利用)へ改称、発見性改善。**native `channels` エントリを削除**。`router.definition.ts` の `/channels` 系ルートは残置。
- WI-5 deck: `ui/deck/channel-column.vue` の選択UIを `live-channels/list` からの選択に変更、ヘッダに配信中インジケータ。タイムライン取得は引き続き `channels/timeline`(native)。**既存保存済み channelId のフォールバック表示を維持**(配信チャンネルでなくても表示継続、配信中バッジのみ非表示)。`deck.vue` のカラム追加ラベルを「配信チャンネル」に。i18n `_deck` の該当キー確認。

コミット: WI-3(card / page再構築)、WI-4(navbar)、WI-5(deck)を各1。

---

## 検証チェックリスト(既知の罠)

- [ ] Node 26必須(PATH先頭 `/nix/store/i2jf2l5lqhy3d7zy3lzx5wjydyzw2hwm-nodejs-26.4.0/bin`)。
- [ ] 新規3 migration(isLiveChannelカラム/バックフィル/autoPostカラム)それぞれ `pnpm --filter backend check-migrations` で制約ハッシュ名を実出力から確認。手書き推測名禁止。
- [ ] WI-6の `NoteCreateService`/`UsersRepository` 新規DIが CoreModule provider/exports に含まれるか確認。循環依存チェック。
- [ ] `locales/ja-JP.yml` のみ編集(他ロケールはCrowdin管理)。`git diff --stat locales/` で確認。
- [ ] misskey-js再生成(`pnpm build-misskey-js-with-types`)を BE-1/BE-2 の後に実行、FE着手前に型反映確認。
- [ ] WI-5デッキ後方互換: 既存デッキプロファイル(native channelId保持)が壊れないこと実機確認。
- [ ] WI-7 OME API負荷: 10秒 poll で `listStreams` 呼び出し回数を増やさない実装であること。
- [ ] shipping-misskey-change skill を各フェーズ最終コミット前に実行(lint/regen/check-migrations/SPDX/locale/CHANGELOG)。
