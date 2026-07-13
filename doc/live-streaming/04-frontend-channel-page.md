<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

# 04. フロントエンド: チャンネルページ設計書

## 0. 位置づけ・前提・完了条件

- 本書は「ライブチャンネル (Live Channel)」機能拡張の設計書群の 1 本。**00 (アーキテクチャ概要/用語定義) と 02 (バックエンド: `live_channel` テーブル・`live-channels/*` API・OME 連携) を先に読むこと。** 本書はそれらが確定させた API 形状・DB スキーマを前提とし、フロントエンド (`packages/frontend/`) の実装方針のみを扱う。00 / 02 のファイル名は本書執筆時点で `doc/live-streaming/` にまだ存在しない (並行執筆中)。参照時は `doc/live-streaming/00-*.md` / `doc/live-streaming/02-*.md` を探すこと。
- 本書は **設計書であり実装ではない**。コード変更・migration・endpoint 追加は行わない。
- 決定の正本は `/tmp/claude-1000/-home-vtf-projects-misskey/03326e3d-ca9c-411d-a0d8-f1802e8985a1/scratchpad/architecture-decisions.md` (以下「決定書」)。本書はこの決定書 §1 (チャンネルページ) と §4 (プレイヤー) に反する設計をしない。決定書にない事項で本書が判断を要した箇所は、各節に「本書独自判断」として明記する。
- リポジトリ実体は `/home/vtf/projects/misskey/misskey-repo` (branch: `bsky-integration`)。以下のパスは全てこのルートからの相対パス。
- 引用する `file:line` は本書執筆時点 (2026-07-14) の `bsky-integration` HEAD を実際に Read して検証済み。行番号は今後の変更で前後し得る。
- **完了条件**: 本書を読んだ実装者 (低レベル LLM 含む) が、(1) `/live/:acct` の 3 状態それぞれの画面と、(2) `live-stream.vue` への差分の当て方と、(3) 新規子コンポーネント `live-stream.channel-home.vue` の責務と、(4) `/settings/live-channel` の完全な UI 仕様を、追加調査なしに実装できる状態。実装は 02 のバックエンド API が先行して存在することを前提とする (決定書 §5 の Phase 3 相当)。

---

## 1. `/live/:acct` の 3 状態

`/live/:acct` は既存の視聴ページ (`packages/frontend/src/pages/live-stream.vue`, 現行 479 行) を拡張し、「チャンネルページ」として次の 3 状態を持つ。状態の優先順位は決定書 §1 の記述順:

1. **ライブ中** (Twitch または OME のいずれかが `isLive`): 現行のシアターモード視聴 UI を維持し、チャンネル情報バーを追加する。
2. **オフライン + チャンネルあり** (`live_channel` が存在し `enabled=true`、かつ現在ライブでない): 新設「チャンネルホーム」表示に置き換える。
3. **チャンネル未開設** (`live_channel` が無い、または `enabled=false`)、かつ Twitch 連携もなし: 現行と同様の「配信なし」表示 (`MkResult type="notFound"` 相当) を維持する。

状態判定は state 1 → 2 → 3 の順で評価する (ライブなら 1 を最優先、そうでなければ 2、チャンネル自体が無ければ 3)。

### 1.1 状態 1: ライブ中

現行 `live-stream.vue:24-67` の `.watch` ブロック (プレイヤー + 情報パネル + チャット) をそのまま踏襲し、情報パネル (`.info`, `live-stream.vue:36-62`) の直下に「チャンネル情報バー」を追加する。チャンネル情報バーは折りたたみ可能な行で、展開するとバナー・説明・チャンネルタイムラインへのリンクが出る (完全な「チャンネルホーム」は表示しない — シアターモードの没入感を壊さないため)。

#### PC 横長 (ワイヤーフレーム)

```
+--------------------------------------------------------------+---------------------+
| [プレイヤー: 残り高さいっぱい, aspect比なし]                    | [チャット]           |
|                                                                |  live-stream.chat   |
|                                                                |  .vue (既存, 変更なし)|
|                                                                |                     |
|                                                                |                     |
+----------------------------------------------------------------                     |
| [アイコン] タイトル                          [設定/フォロー btn]|                     |
|            @user · ゲーム名 · 3分前                            |                     |
+----------------------------------------------------------------                     |
| ▼ チャンネル情報 (折りたたみ、初期は閉)                         |                     |
|   [バナー画像 (小)] チャンネル名 / 説明 (2-3行, 省略)             |                     |
|   [チャンネルページへ] (タイムラインは新規コンポーネントで別途表示)|                     |
+--------------------------------------------------------------+---------------------+
```

- プレイヤー領域・チャット領域の縦横比・レイアウトルールは `live-stream.vue:308-327` (`.watch { height: 100cqh; }`) をそのまま流用する。**100vh/100dvh は使わない** (§6 参照)。
- チャンネル情報バーの折りたたみは新規に追加する `.channelInfoToggle` 相当の要素で、`.info` (`live-stream.vue` CSS module) の下に積む。プレイヤー・チャットの高さ計算 (`flex: 1; min-height: 0;`) には影響させない — `.main` (`live-stream.vue:329-336`) 内で `.info` と並ぶ独立ブロックとして追加し、`.playerContainer` の `flex: 1` は変更しない。

#### モバイル縦 (ワイヤーフレーム)

```
+----------------------------------+
| [プレイヤー: aspect-ratio 16/9]    |
+----------------------------------+
| [アイコン] タイトル    [設定/F btn]|
|            @user · 3分前          |
+----------------------------------+
| ▼ チャンネル情報 (折りたたみ)      |
+----------------------------------+
| [チャット: 残り高さいっぱい]        |
|                                  |
+----------------------------------+
```

- 縦積み分岐は既存の `@container (max-width: 700px) or (aspect-ratio < 1/1)` (`live-stream.vue:450-477`) をそのまま使う。チャンネル情報バーは `.main` 側 (プレイヤー・情報パネルと同じ縦積みグループ) に入れ、`.chat` (幅 100%, `flex: 1`) より上に配置する。

### 1.2 状態 2: オフライン + チャンネルあり (チャンネルホーム)

現行のオフライン表示 (`live-stream.vue:11-23`, `MkAvatar` + `MkUserName` + 「配信なし」文言のみ) を置き換え、新規子コンポーネント `live-stream.channel-home.vue` (§2 参照) に委譲する。

構成要素 (決定書 §1): バナー / アイコン (=ユーザーアイコン) / チャンネル名 / 説明 / フォローボタン / タイムライン埋め込み。

#### PC 横長

```
+----------------------------------------------------------------+
| [バナー画像 (live_channel.banner、無ければ user.banner)]         |
|                                                     幅いっぱい・  |
|                                                     固定高さ帯    |
+----------------------------------------------------------------+
| (アイコン, user.avatarUrl)  チャンネル名          [フォローボタン]|
|  丸アイコン、バナー左下に  @username                 [設定btn]※1  |
|  半分かぶせる (home.vueの.avatar踏襲)                             |
+----------------------------------------------------------------+
| 説明文 (live_channel.description、null なら非表示)                |
+----------------------------------------------------------------+
| [プレビュー配信ボタン]※1  [OBS URL コピー等 既存メニュー]※1         |
+----------------------------------------------------------------+
| チャンネルタイムライン (MkNotesTimeline + users/notes)            |
|  ノート1                                                         |
|  ノート2                                                         |
|  ...                                                             |
+----------------------------------------------------------------+
```
※1 は `isOwner` (`$i.id === user.id`) の場合のみ表示。既存の `openStreamerSettings` (`live-stream.vue:151-201`) メニューとプレビュー配信ボタン (`live-stream.vue:22`) はそのままこの状態にも残す。

#### モバイル縦

```
+----------------------------------+
| [バナー (低め高さ)]                |
+----------------------------------+
|  (アイコン, 中央)                  |
|  チャンネル名 (中央)               |
|  @username (中央)                 |
|  [フォローボタン] (中央)            |
+----------------------------------+
| 説明文 (中央寄せ)                  |
+----------------------------------+
| [プレビュー配信]※1 [設定]※1        |
+----------------------------------+
| チャンネルタイムライン              |
|  ノート1                          |
|  ノート2                          |
+----------------------------------+
```

- バナー帯・アイコンの重ね配置は `packages/frontend/src/pages/user/home.vue` の `.banner-container` / `.avatar` パターン (`home.vue:369-500`, scoped CSS) を参考にする。ただし `home.vue` はプロフィールページ用の複雑な構成 (fields/roles/memo 等) を持つため、**そのまま流用せず、バナー+アイコン+名前+説明+フォロー+タイムラインの必要最小構成に絞って `live-stream.channel-home.vue` 用に書き直す**。`--bannerHeight` カスタムプロパティによる高さ制御と `@container (max-width: 500px)` でのモバイル分岐 (`home.vue:671-737`) は流用してよい設計パターン。

### 1.3 状態 3: チャンネル未開設

現行の `MkResult type="notFound"` 表示 (`live-stream.vue:10`) をそのまま維持する。`user` が見つからない場合と、`user` はいるが `live_channel` も Twitch 連携も無い場合を同じ表示に統合する (現行の `twitchInfo == null` 判定を、後述 §3 の統合フェッチ結果が両方 null の場合に読み替える)。

---

## 2. `live-stream.vue` 改修方針

### 2.1 温存する部分 (行範囲は現行 479 行時点)

| 範囲 | 内容 | 温存理由 |
|---|---|---|
| `live-stream.vue:64-66` | `<XChat>` 呼び出し (`live-stream.chat.vue`) | チャット UI は決定書 §3 により streamId 依存のみでソース非依存。無改修 |
| `live-stream.vue:104-106` | `isOwner` computed | ロジック変更不要 |
| `live-stream.vue:151-201` | `openStreamerSettings` メニュー (OBS URL / TTS / コメジェネ / ブロック / 翻訳設定) | ソース非依存の配信者機能。そのまま残す |
| `live-stream.vue:203-253` | リモートゲストログイン関連 (`openRemoteGuestMenu`, `handleRemoteGuestLoginResult`) | 変更不要 |
| `live-stream.vue:262-268` | `playerActive` (KeepAlive 対応) | プレイヤーコンポーネント切替後も同じ `onActivated`/`onDeactivated` パターンで踏襲 (決定書 §4 の `MkOmePlayer` も同パターンを内部で使う) |
| `live-stream.vue:308-336`, `450-477` (CSS) | `.watch`/`.main`/`.playerContainer` レイアウト・100cqh 技法・`@container` 縦積み分岐 | §1.1 で述べた通りレイアウト骨格は変えない |

### 2.2 分岐を足す箇所

1. **データ取得層**: `reload()` (`live-stream.vue:125-140`) を、Twitch 専用の `twitch/streams/show` 呼び出しから、チャンネル情報 (`live-channels/show`) と Twitch 情報を両方取得し「アクティブセッション配列 + 優先セッション」を組み立てる処理に置き換える。詳細は §3。
2. **状態分岐**: 現行 `v-else-if="streamInfo == null"` (`live-stream.vue:11`) の 2 分岐 (オフライン/視聴中) を、§1 の 3 状態分岐に拡張する:
   ```html
   <MkLoading v-if="fetching"/>
   <MkResult v-else-if="user == null || channelState === 'none'" type="notFound"/>
   <XChannelHome v-else-if="channelState === 'offline'" :user="user" :channel="channelInfo"/>
   <div v-else class="_gaps" :class="$style.watch"> <!-- 状態1: ライブ中、既存構造を流用 -->
   ```
   `channelState` は `'live' | 'offline' | 'none'` の computed で、§3 のフェッチ結果から導出する。
3. **プレイヤー切替**: `playerUrl` computed (`live-stream.vue:116-123`, Twitch iframe URL 組み立てをハードコード) を撤去し、決定書 §4 の `MkStreamPlayer` コンポーネント (`source: 'twitch'|'ome'` props) に置き換える。両ソース同時ライブ時のセグメントトグルは `live-stream.vue` の `.info` 内、既存 `MkFollowButton`/設定ボタン行 (`live-stream.vue:36-61`) に並べて追加する。**このプレイヤー切替自体の実装詳細 (`MkOmePlayer`/`MkStreamPlayer`/OvenPlayer 統合) は 05 (プレイヤー実装設計書) の管轄とし、本書はチャンネルページとしての置き場所のみ規定する。**
4. **チャンネル情報バー (状態1用)**: `.info` ブロック (`live-stream.vue:36-62`) の直後に折りたたみ式のチャンネル情報表示を追加する。中身は `live-stream.channel-home.vue` のバナー/説明部分を薄く再利用してよいが、フル版ではなく要約表示にとどめる (§1.1)。

### 2.3 新規子コンポーネント `live-stream.channel-home.vue`

既存の同階層命名規則 (`live-stream.chat.vue`, `live-stream.overlay.vue`, `live-stream.blocks.vue` 等、いずれも `packages/frontend/src/pages/` 直下にドット区切りで配置) に合わせ、**`packages/frontend/src/pages/live-stream.channel-home.vue`** として新設する。

Props (本書独自判断 — 02 の API 形状確定後に型を合わせること):
```ts
const props = defineProps<{
	user: Misskey.entities.UserDetailed;
	channel: /* live-channels/show の res 型、02 で確定 */;
}>();
```

責務: バナー/アイコン/名前/説明/フォローボタン/タイムラインの描画のみ。データ取得 (`live-channels/show` の呼び出し) は親 (`live-stream.vue`) が行い、props で渡す (`live-stream.vue` の `reload()` が唯一のフェッチ経路であることを崩さない — 現行方針の踏襲)。

---

## 3. データ取得

### 3.1 呼び分け

決定書 §1 API 節・§3 (セッション統合) に基づき、`live-stream.vue` の `reload()` は次の順で呼ぶ:

1. `users/show` (既存、`live-stream.vue:132` と同じ) — `user` を確定。
2. `live-channels/show` (`{ userId: user.id }`, requireCredential:false — 02 で確定) — チャンネルメタ (`live_channel` の有無・`enabled`・バナー/名前/説明) のみを取得。**このレスポンスはライブ状態を持たない** (02 §1 の `live_channel` にライブ状態カラムは無い。`enabled` は「配信機能を利用する」トグルであり「今ライブ中か」ではない)。
3. 拡張 `twitch/streams/show` (`{ userId: user.id }`, `live-stream.vue:134` と同じ呼び出し) — Twitch 連携状況と、Twitch/OME 両ソースのライブ状態 (`sessions` 配列、03 §8) を取得。

2 と 3 は独立した API であり、役割分担は次のとおり確定する (06 §11 整合性課題#3 の裁定): **2 はチャンネルメタのみ、ページの `channelState` (`'live'|'offline'|'none'`) は 3 の `sessions` 配列 (isLive な要素の有無) から導出する。** 両呼び出しは並行 (`Promise.all`) し、例外を握りつぶさない形で実装する:

```ts
async function reload() {
	fetching.value = true;
	user.value = null;
	channelInfo.value = null;
	twitchInfo.value = null;
	try {
		const { username, host } = Misskey.acct.parse(props.acct);
		const fetchedUser = await misskeyApi('users/show', { username, host: host ?? undefined });
		user.value = fetchedUser;
		const [channel, twitch] = await Promise.all([
			misskeyApi('live-channels/show', { userId: fetchedUser.id }).catch(() => null),
			misskeyApi('twitch/streams/show', { userId: fetchedUser.id }).catch(() => null),
		]);
		channelInfo.value = channel;
		twitchInfo.value = twitch;
		// channelState 導出 (整合性課題#3 裁定):
		//   channelInfo == null (未開設 or enabled:false で show がエラー) → 'none'
		//   twitchInfo.sessions に isLive な要素あり → 'live'
		//   それ以外 → 'offline'
		// ※ computed として実装する。live-channels/show はライブ状態を持たないため判定に使わない
	} catch {
		// user 不明 → not found 表示 (既存 live-stream.vue:135-136 と同じ方針)
	} finally {
		fetching.value = false;
	}
}
```

`live-channels/show` と `twitch/streams/show` は互いに独立した機能 (一方が未設定でも他方は動く、決定書の config 縮退方式と同じ思想) なので、**個別に `.catch(() => null)` して片方の失敗が全体を落とさないようにする**。既存コードのように丸ごと `try/catch` で握ると「OME は動くが Twitch API がエラー」のケースで正常な OME ライブ表示まで失われるため、これは既存パターンからの意図的な変更点として明記する。

### 3.2 ローディング/エラー

- ローディング中: 既存 `fetching` フラグと `MkLoading` (`live-stream.vue:9`) をそのまま流用。
- `user` 取得失敗: 既存 `MkResult type="notFound"` (`live-stream.vue:10`) をそのまま流用。
- `live-channels/show` / `twitch/streams/show` の片方のみ失敗: §3.1 の通り握りつぶし、成功した方の情報で状態判定する。両方失敗 (かつ user は存在): チャンネル未開設と同じ「配信なし」表示 (状態3) に落とす。

### 3.3 タイムライン (状態2: チャンネルホーム内)

決定書 §1「新規タイムラインは作らない、既存 `users/notes` の `MkNotes` を埋め込む」に従う。**「MkNotes」という単体コンポーネントは現行コードベースに存在しない** (`packages/frontend/src/components/` 配下を確認したが `MkNotes.vue` は無い)。実際の埋め込みパターンは `packages/frontend/src/pages/user/index.timeline.vue:47-56` の以下の形:

```ts
import MkNotesTimeline from '@/components/MkNotesTimeline.vue';
import { Paginator } from '@/utility/paginator.js';

const notesPaginator = markRaw(new Paginator('users/notes', {
	limit: 10,
	computedParams: computed(() => ({
		userId: props.user.id,
	})),
}));
```
```html
<MkNotesTimeline :noGap="true" :paginator="notesPaginator" :pullToRefresh="false"/>
```

`live-stream.channel-home.vue` はこのパターンをそのまま使う。`withRenotes`/`withReplies`/`withChannelNotes`/`withFiles` 等のタブ切替 (`index.timeline.vue` の `tab` state) は不要 — チャンネルホームは単一のタイムライン表示でよい (決定書に複数タブの要求なし、本書独自判断: 過剰実装を避ける)。`computedParams` に渡す `userId` は `props.user.id`。

---

## 4. フォローボタン

決定書 §1「フォローボタンは既存 `MkFollowButton`」に従う。`packages/frontend/src/components/MkFollowButton.vue` の props (`MkFollowButton.vue:51-58`):

```ts
const props = withDefaults(defineProps<{
	user: Misskey.entities.UserDetailed,
	full?: boolean,
	large?: boolean,
}>(), {
	full: false,
	large: false,
});
```

`v-model:user` (`update:user` イベント、`MkFollowButton.vue:60-62`) でフォロー状態変化後の `user` オブジェクトを親に返す。

**使用例** (既存 `live-stream.vue:55` そのまま、状態1のヘッダーで使用中):
```html
<MkFollowButton v-else-if="$i != null && $i.id !== user.id" v-model:user="user" :inline="true" :transparent="false" :full="true"/>
```

ただし `MkFollowButton.vue` の実際の props 定義には `inline` / `transparent` という prop は存在しない (`full` と `large` のみ)。`live-stream.vue:55` の記述はこの 2 つを渡しているが、Vue の attrs fallthrough で DOM 属性として渡るだけで意味を持たない可能性が高い。**新規実装 (`live-stream.channel-home.vue`) では実在する props (`user`, `full`, `large`) のみを指定する:**

```html
<MkFollowButton v-if="$i != null && $i.id !== user.id" v-model:user="user" :full="true"/>
```

`user` オブジェクトの取得元は §3 の `reload()` で取得した `user` (`Misskey.entities.UserDetailed`、`live-stream.vue:95` と同じ型) をそのまま渡す。`user.isFollowing`/`user.hasPendingFollowRequestFromYou` が `null` の場合は `MkFollowButton` 内部で自動的に `users/show` を再取得する (`MkFollowButton.vue:69-74`) ため、呼び出し側で特別な対応は不要。

---

## 5. 設定ページ `/settings/live-channel`

`packages/frontend/src/pages/settings/twitch.vue` (144行) を雛形にする。決定書 §1「設定ページは新設 `/settings/live-channel` (既存 `/settings/twitch` と並列、`settings/twitch.vue` のパターン踏襲)」に従う。

### 5.1 ファイル・router 登録

新設ファイル: `packages/frontend/src/pages/settings/live-channel.vue`。

router 登録は `packages/frontend/src/router.definition.ts` の settings ブロック内、既存の `/twitch` エントリ (`router.definition.ts:163-166`) の直後に追記する:

```ts
}, {
	path: '/twitch',
	name: 'twitch',
	component: page(() => import('@/pages/settings/twitch.vue')),
}, {
	path: '/live-channel',
	name: 'live-channel',
	component: page(() => import('@/pages/settings/live-channel.vue')),
}, {
```

このブロックは `path: '/settings'` の子ルート配列内 (`router.definition.ts:76` 以降) にあり、`/apps`・`/webhook/edit/:webhookId` 等と並ぶ (`router.definition.ts:167-179` 参照)。

### 5.2 画面構成

`SearchMarker` でグローバル設定検索に登録する (`twitch.vue:7` と同じパターン):

```html
<SearchMarker path="/settings/live-channel" :label="i18n.ts._liveChannel.settingsTitle" :keywords="['live', 'stream', 'channel', 'ome', 'obs']" icon="ti ti-broadcast">
```

`FormSection` 単位の構成 (`twitch.vue:13-43` のセクション分割パターンを踏襲):

1. **セクション「配信機能」** (`FormSection first`):
   - トグル「配信機能を利用する」(`live_channel` 行の作成/`enabled` フラグ、決定書 §1)。`MkSwitch` を使用 (Misskey 標準のトグルコンポーネント)。ON にした瞬間に streamKey が自動生成される (決定書 §1) ため、ON 化はサーバー側で `live-channels/create` を叩く非同期操作になる — トグルの `change` イベントで `os.apiWithDialog('live-channels/create', {})` (無効化時は `live-channels/update` で `enabled:false`) を呼ぶ。
2. **セクション「チャンネル情報」** (`enabled === true` のときのみ表示):
   - チャンネル名入力: `MkInput` (`v-model="name"`, `manualSave`)。プレースホルダは `user.name ?? user.username` (決定書 §1 のフォールバック仕様をプレースホルダで示す)。
   - チャンネル説明入力: `MkTextarea` (`v-model="description"`, `manualSave`)。
   - バナー選択: §5.3 参照。
3. **セクション「配信サーバー情報」** (`enabled === true` のときのみ表示): §5.4 参照。

`MkInput`/`MkTextarea` の `manualSave` 属性は既存 `settings/twitch.vue` には現れないが、`settings/profile.vue` や `settings/email.vue:16-20` で使われている標準パターン (フォーカスアウト/Enter で保存、リアルタイム保存ではない) を踏襲する。

### 5.3 バナー選択

`packages/frontend/src/pages/settings/profile.vue:319-343` の `changeBanner` 関数と同一パターンを使う。実装は以下の通り (現物 API を確認済み):

```ts
import { chooseDriveFile } from '@/utility/drive.js';

function changeBanner(ev: PointerEvent) {
	async function done(driveFile: Misskey.entities.DriveFile) {
		const res = await os.apiWithDialog('live-channels/update', {
			bannerId: driveFile.id,
		});
		channel.value = res;
	}

	os.popupMenu([{
		text: i18n.ts.banner,
		type: 'label',
	}, {
		text: i18n.ts.upload,
		icon: 'ti ti-upload',
		action: async () => {
			const files = await os.chooseFileFromPc({ multiple: false });
			const file = files[0];
			let originalOrCropped = file;
			const { canceled } = await os.confirm({
				type: 'question',
				text: i18n.ts.cropImageAsk,
				okText: i18n.ts.cropYes,
				cancelText: i18n.ts.cropNo,
			});
			if (!canceled) {
				originalOrCropped = await os.cropImageFile(file, { aspectRatio: 3 / 1 });
			}
			const driveFile = (await os.launchUploader([originalOrCropped], { multiple: false }))[0];
			done(driveFile);
		},
	}, {
		text: i18n.ts.fromDrive,
		icon: 'ti ti-cloud',
		action: () => {
			chooseDriveFile({ multiple: false }).then(files => {
				done(files[0]);
			});
		},
	}], ev.currentTarget ?? ev.target);
}
```

要点 (`profile.vue` から検証済みの正確な API):
- ドライブファイル選択は `@/utility/drive.js` の `chooseDriveFile({ multiple: false })` (戻り値は `Misskey.entities.DriveFile[]`)。「`os.selectDriveFile`」という API は存在しない。
- PC からの新規アップロードは `os.chooseFileFromPc()` → 任意でクロップ (`os.cropImageFile(file, { aspectRatio })`) → `os.launchUploader([file], { multiple: false })` の 3 段階。`aspectRatio` はユーザーアバター (`profile.vue` 側は 1/1) と異なり、バナーなので横長比率 (例 `3/1`) を指定する — **決定書に具体的比率の指定は無いため、本書独自判断として `3/1` を暫定値とし、実装時に UI デザイン確定次第で調整してよい**。

### 5.4 ストリームキー表示

決定書 §1・§2「配信者向け UI: `/settings/live-channel` に配信サーバー URL / ストリームキー (コピー) / 再生成 を RTMP・SRT・WHIP の 3 方式分表示」に従う。

データ取得は `live-channels/my` (`secure:true`、決定書 §1 API 節) で取得する `{ channel, streamKey, rtmpUrl, srtUrl, whipUrl }` 形状を使う。**この前提は 02 §5-5 (res スキーマ) と 03 §6 (`generateIngestUrls()` をハンドラから呼ぶ) で確定済み** (06 §11 整合性課題#1 の裁定)。`config.ome` 未設定時は URL 3 種が null で返る (streamKey は返る) 点に留意すること。

画面レイアウト:

```
配信サーバー URL / ストリームキー
┌─────────────────────────────────────────┐
│ RTMP:  rtmp://stream.msjp.pro:1935/live   [コピー]│
│ Key:   ●●●●●●●●●●●●●●●●  [表示切替👁] [コピー]  │
├─────────────────────────────────────────┤
│ SRT:   srt://stream.msjp.pro:9999/live    [コピー]│
│ Key:   ●●●●●●●●●●●●●●●●  [表示切替👁] [コピー]  │
├─────────────────────────────────────────┤
│ WHIP:  https://stream.msjp.pro/whip/live  [コピー]│
│ Token: ●●●●●●●●●●●●●●●●  [表示切替👁] [コピー]  │
└─────────────────────────────────────────┘
[ストリームキーを再生成]  (danger button)
```

- マスク表示 + 表示切替: `ref<boolean>` の `keyVisible` を持ち、`v-if`/`v-else` で `●●●` (`'•'.repeat(streamKey.length)` 等) とプレーンテキストを切り替える。切替ボタンは `<button class="_button" @click="keyVisible = !keyVisible"><i class="ti" :class="keyVisible ? 'ti-eye-off' : 'ti-eye'"></i></button>` のような形。
- コピーは `copyToClipboard` (`@/utility/copy-to-clipboard.js`、`live-stream.vue:86,158` と同じ import/使用パターン) を URL・キーそれぞれのボタンに割り当てる。
- 再生成ボタン: `os.confirm` で確認してから API を叩く (`settings/twitch.vue:96-103` の `unlink` と同一パターン):
  ```ts
  async function regenerateKey() {
  	const { canceled } = await os.confirm({
  		type: 'warning',
  		text: i18n.ts._liveChannel.regenerateKeyConfirm,
  	});
  	if (canceled) return;
  	const res = await os.apiWithDialog('live-channels/regenerate-key', {});
  	streamKey.value = res.streamKey;
  	// 決定書§2: 再生成時に旧キーの既存接続はサーバー側 (OME REST DELETE) で切断される。
  	// フロント側で追加の切断処理は不要
  }
  ```

---

## 6. 既知の罠の継承

実装時に踏み外しやすい過去の既知バグパターンを、関連箇所に対応付けて記す。

1. **100cqh 技法 (dvh 禁止)**: `live-stream.vue:308-327` の `.watch { height: 100cqh; }` コメントに詳細理由が書かれている — `100dvh` はブラウザビューポート基準で、`MkPageWindow` (デッキ上のポップアップウィンドウ) のようにビューポートより小さい枠内に表示される場合に高さが崩れる。`live-stream.channel-home.vue` は縦スクロール前提のページなので `100cqh` 固定は不要だが、**もし将来チャンネルホームにも「残り高さいっぱい」系のレイアウトを足す場合は `dvh`/`vh` を使わず `cqh` (親要素の `container-type: size`) を使うこと**。
2. **CSS Modules `@container` のソース順序**: `live-stream.vue:448-450` のコメント「同名クラスの上書きなので、CSS Modules 上も同じ詳細度になり、ソース順序が後にあるこのブロックを末尾に置かないと上の基本定義に負けて narrow レイアウトが効かない」。`live-stream.channel-home.vue` で PC/モバイルの `@container` 分岐を書く際、**基本定義 (PC) を先に、`@container (max-width: ...)` によるモバイル上書きを必ずファイル末尾側に置く**こと。CSS Modules は詳細度で競合を解決しないため、順序を誤ると狭い画面でも PC レイアウトが優先されてしまう。
3. **`PageMetadata.hideDeckNav`**: `live-stream.vue:274-282` の `definePage` は `hideDeckNav: streamInfo.value != null` (ライブ再生中のみデッキの「デッキへ戻る」バナーを隠す)。チャンネルページ全体を `hideDeckNav: true` に固定すると、状態2 (チャンネルホーム) や状態3 (配信なし) で「詰み画面」になる既知バグを再発させる。**新しい `channelState` 変数を使う場合も `hideDeckNav` の条件式は「実際にライブ再生している (状態1) ときだけ true」を維持すること**: `hideDeckNav: channelState.value === 'live'`。
4. **`MkSelect` の `items` prop**: プレイヤーソース切替のセグメントトグル (§2.2) や、将来 `/settings/live-channel` で配信方式選択 UI を `MkSelect` で作る場合、`MkSelect` はデフォルトスロットではなく `items` prop (`{value,label}[]` の配列) を使う (`MkSelect.vue:58-71` の型定義、および `twitch-broadcaster-features` 実装時の既知の罠)。`<option>` スロットで書くと機能しない。
5. **`$style` はスクリプト内で直接使えない**: `live-stream.channel-home.vue` のスクリプト側でクラス名を動的に組み立てる必要がある場合 (例: 状態に応じたクラス切替を `:class="$style.xxx"` ではなく JS 側で計算したい場合)、`<script setup>` 内で `$style` は自動では見えない。`useCssModule()` (Vue composition API) を使うこと。

---

## 7. i18n キー

決定書 §0「i18n キー接頭辞は `_liveChannel`」に従う。**backend 側 (02) が定義する `_liveChannel` 配下の共通キー (機能名・エラーメッセージ等) との重複を避け、frontend 固有 (このページ・このコンポーネントでしか使わない文言) のみをここに追記する**。追記先は `locales/ja-JP.yml` のみ (他言語は Crowdin 自動配信のため手動編集禁止、`working-on-frontend` スキル必読)。

frontend 専用キー候補 (02 の `_liveChannel` 定義後、重複が無いことを確認してから追記すること — 本書では確定リストではなく候補のみ提示する):

- `_liveChannel.settingsTitle` — 設定ページタイトル/検索ラベル
- `_liveChannel.channelHome` — チャンネルホームの見出し等
- `_liveChannel.streamServerInfo` — 「配信サーバー情報」セクション見出し
- `_liveChannel.regenerateKey` / `_liveChannel.regenerateKeyConfirm` — 再生成ボタン/確認ダイアログ文言
- `_liveChannel.showKey` / `_liveChannel.hideKey` — マスク表示切替のツールチップ
- `_liveChannel.copyRtmpUrl` / `_liveChannel.copySrtUrl` / `_liveChannel.copyWhipUrl` — 各コピー操作のラベル

既存 `_twitch` セクション (`locales/ja-JP.yml` 3667行目〜) と対になる位置に新設する。

---

## 8. 検証チェックリスト

### 8.1 コマンド

- `pnpm --filter frontend typecheck` (`working-on-frontend` スキル記載の個別実行。全体は `pnpm lint` でも可)
- `pnpm --filter frontend eslint` (frontend パッケージ個別。全体 lint は `pnpm lint`)
- backend API (`live-channels/*`) が確定している場合: `pnpm build-misskey-js-with-types` を再実行し、`packages/misskey-js/src/autogen/` の差分をコミットに含める (AGENTS.md 最低チェック#2)
- `locales/ja-JP.yml` を編集した場合: `git diff --name-only develop -- 'locales/*.yml' | grep -v '^locales/ja-JP\.yml$'` が空であることを確認 (AGENTS.md 最低チェック#6)
- 新規ファイル (`live-stream.channel-home.vue`, `settings/live-channel.vue`) の SPDX ヘッダー (HTML コメント形式) 付与を確認

### 8.2 目視項目 (3状態 × PC/モバイル/デッキ)

| # | 状態 | PC | モバイル | デッキ (MkPageWindow) |
|---|---|---|---|---|
| 1 | 状態1 (ライブ中) | プレイヤーが残り高さいっぱいに表示、チャットが右に固定幅で並ぶ | プレイヤー 16:9、チャットがその下に残り高さいっぱいで並ぶ | ウィンドウが正方形〜縦長にリサイズされても `100cqh` によりプレイヤー/チャットが正しい高さで収まる (`hideDeckNav` は影響しないが、レイアウト崩れがないか確認) |
| 2 | 状態1 | チャンネル情報バーの折りたたみが開閉できる | 同左、折りたたみが縦積みレイアウトを崩さない | 同左 |
| 3 | 状態1 | デッキ「デッキへ戻る」バナーが**隠れている** (`hideDeckNav: true`) | — | デッキ表示でウィンドウを開いた場合の挙動を確認 |
| 4 | 状態2 (チャンネルホーム) | バナー全幅表示、アイコンがバナー下端に重なる、フォローボタンが名前の右 (または近傍) にある | バナー低め高さ、アイコン中央、名前・フォローボタン中央寄せ | ウィンドウ幅が狭い場合にモバイルレイアウトへ切り替わる (`@container` 基準であることを確認) |
| 5 | 状態2 | 説明文が `live_channel.description` null 時に非表示になる (エリア自体が潰れる、空白が残らない) | 同左 | — |
| 6 | 状態2 | タイムラインが `MkNotesTimeline` でスクロール・ページネーションが機能する | 同左 | — |
| 7 | 状態2 | `isOwner` の場合のみプレビュー配信ボタン・設定メニューが出る、他ユーザーには出ない | 同左 | — |
| 8 | 状態3 (チャンネルなし) | `MkResult type="notFound"` が表示される (状態2/1 に誤って遷移しない) | 同左 | — |
| 9 | 全状態共通 | デッキで「デッキへ戻る」バナーが状態2/3 で表示される (詰み画面にならない、既知バグ再発なし) | 同左 | 同左 |
| 10 | 設定ページ | `/settings/live-channel` がグローバル設定検索 (`SearchMarker`) にヒットする | 同左 | — |
| 11 | 設定ページ | トグル OFF→ON でストリームキー欄が出現、マスク表示のデフォルトが「隠す」であること | 同左 | — |
| 12 | 設定ページ | 表示切替ボタンでキーの平文/マスクが切り替わる、コピーボタンで実際にクリップボードにコピーされる (URL とキーそれぞれ独立して) | 同左 | — |
| 13 | 設定ページ | 再生成ボタンで確認ダイアログが出て、キャンセル時は何も起きない、OK 時にキー表示が新しい値に更新される | 同左 | — |
| 14 | 設定ページ | バナー選択メニューがアップロード/ドライブから選択の 2 択で開き、選択後にプレビューが更新される | 同左 | — |

---

## 未確定事項 (本書の範囲でのみ、決定書 §6 とは別枠)

1. `live-channels/show` と拡張後 `twitch/streams/show` のどちらが「アクティブセッション配列 + 優先セッション」を返す最終形になるかは 02 で確定する事項 (§3.1 参照)。本書のコード例はどちらの形にも対応できるよう独立フェッチ + 個別 catch の方針のみを固定した。
2. バナーのクロップ `aspectRatio` (§5.3 で暫定 `3/1` とした) はデザイン確定時に見直しが必要。
3. `MkFollowButton` に渡されていた `inline`/`transparent` props (`live-stream.vue:55`) が実際には存在しないコンポーネント props である点 (§4) は、既存コードの潜在的な軽微な不整合であり、本書の新規実装では実在する props のみを使う方針にしたが、既存 `live-stream.vue:55` 側の是正は本書のスコープ外 (実装フェーズで別途要検討)。
