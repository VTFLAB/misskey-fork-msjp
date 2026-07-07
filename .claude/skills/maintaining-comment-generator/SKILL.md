---
name: maintaining-comment-generator
description: Use whenever editing OBS comment generator files — `packages/backend/assets/misc/comment-generator.{js,css}`, `packages/backend/src/server/web/views/comment-generator.tsx`, `packages/frontend/src/pages/live-stream.comment-generator-settings.vue`, or the `/live/:acct/comment-generator` route in ClientServerService. Covers the URL-parameter contract that MUST stay in sync between the vanilla-JS page and the Vue settings dialog, known traps (Number(null)===0, MkSelect/defineModel, X-Frame-Options, i18n build), the verification checklist, and the production deploy pipeline. Must be consulted before any change to these files — a silent contract mismatch ships broken defaults to production.
---

# maintaining-comment-generator

OBS ブラウザソース用「コメントジェネレーター」(`/live/:acct/comment-generator`) の保守ガイド。
**このスキルは対象ファイルに 1 行でも触れる前に必ず全文を読むこと。**

## 構成ファイル (全リスト)

| ファイル | 役割 |
|---|---|
| `packages/backend/assets/misc/comment-generator.js` | ページ本体。**素の ES2020・依存ゼロ・ビルドなし**。URL クエリ→設定→描画、生 WebSocket 購読、demo モード |
| `packages/backend/assets/misc/comment-generator.css` | `--cg-*` CSS 変数駆動のスタイル + keyframes |
| `packages/backend/src/server/web/views/comment-generator.tsx` | 最小 HTML シェル (bios.tsx と同型) |
| `packages/backend/src/server/web/ClientServerService.ts` | ルート `/live/:acct/comment-generator` (SPA catch-all より先に登録、`reply.removeHeader('X-Frame-Options')` 必須) |
| `packages/frontend/src/pages/live-stream.comment-generator-settings.vue` | 設定ビルダーダイアログ (配信ページ歯車メニューから) |

## 絶対規則 1: URL パラメータ契約の三点同期

設定ダイアログは「**デフォルト値と同じパラメータを URL から省略する**」。つまりデフォルト値そのものが契約であり、次の 3 箇所が完全一致していないと**省略されたパラメータだけが本番で壊れる** (ダイアログのプレビューでは気づきにくい):

1. `comment-generator.js` の `config` 構築部 (`clampNumber`/`pickEnum`/`pickBool` の def・min・max・enum)
2. `live-stream.comment-generator-settings.vue` の `DEFAULT_SETTINGS` と `sanitizeSettings()` のクランプ/enum
3. 同 .vue のフォーム入力 (`MkInput` の `:min`/`:max`、`MkSelect` の items)

パラメータを追加・変更するときは 3 箇所すべてを同時に更新し、下の検証チェックリストを必ず実行する。
現行パラメータは 27 個: mode, limit, duration, order, align, animIn, animOut, animTime, font, fontUrl, fontSize, fontWeight, textColor, nameColor, transColor, bgColor, outline, outlineColor, radius, padding, gap, icon, iconSize, name, translation, media, emojiScale, history, demo (demo は設定契約外の動作フラグ)。

## 絶対規則 2: comment-generator.js は素の JS のまま

- import / require / TypeScript 構文 / ビルドステップを持ち込まない。`node --check` が通る単一ファイルを維持。
- ユーザー由来文字列を innerHTML に入れない。DOM API (`createElement` / `textContent`) のみで組み立てる。
- クエリ値は必ずサニタイズしてから CSS 変数化 (色は `CSS.supports`、数値は `clampNumber`、URL は http/https のみ)。
- `clampNumber` は `raw == null || raw === ''` を **Number() より先に** 弾く。`Number(null) === 0` のため、このガードを外すと省略パラメータが全部 0 になる事故が再発する (2026-07-08 に実際に起きた)。

## 既知の罠 (すべて実際に踏んだもの)

- **MkSelect / defineModel**: 同じ値を再選択しても update イベントは発火しない (Vue の同値ガード)。「選択=アクション」の UI は MkSelect ではなく `os.popupMenu()` を使う。MkSelect を使う場合は `items` prop (`{value,label}[]`) 必須。
- **ClientServerService に iframe で使うルートを足すとき**は `reply.removeHeader('X-Frame-Options')` を必ず入れる (グローバル hook が DENY を付ける)。
- **i18n**: `locales/ja-JP.yml` のみ編集可 (他ロケール yml は Crowdin 管理)。キー追加後は `pnpm --filter i18n generate` **に加えて** `pnpm --filter i18n build` まで実行しないと frontend typecheck が通らない。
- **SPDX**: この機能の新規ファイルは fork 慣行 `SPDX-FileCopyrightText: misskey-bsky-integration fork` を使う (既存ファイルに合わせる)。
- **設定ダイアログの 3 段階フロー**: draft (フォーム) → [プレビューに適用] → preview (iframe のみ) → [設定を反映] → committed (生成 URL / コピー / miLocalStorage `twitchCommentGen`)。この分離を壊さない。「設定を反映」はプレビュー済み状態のみを昇格させる。
- **demo モード** (`demo=1`) は WS/API 購読なしでダミーコメントを**本番と同じ描画経路** (`mountComment` 等) に流す。描画ロジックに demo 専用分岐を作らない。
- ヘッドレス検証が「正常」を返しても鵜呑みにしない。過去に 2 回、subagent のヘッドレス検証が偽陰性/誤診を出した。疑わしいときは下の実ブラウザ計測で `getComputedStyle` / `getAnimations` / boundingBox を直接見る。

## 検証チェックリスト (変更後に必ず全部)

```bash
node --check packages/backend/assets/misc/comment-generator.js
pnpm --filter backend typecheck        # .tsx / ClientServerService を触った場合
pnpm --filter frontend typecheck       # .vue / i18n を触った場合
pnpm --filter frontend lint
```

契約を触った場合は実ブラウザ計測も行う。**この開発機 (NixOS) では playwright 同梱 Chromium は動かない。** 次の手順で:

```bash
nix build --no-link nixpkgs#chromium && nix path-info nixpkgs#chromium  # パスを得る
# playwright スクリプト内:
#   chromium.launch({ executablePath: '<上のパス>/bin/chromium', args: ['--no-sandbox'] })
```

ローカル HTTP サーバーで js/css を配信し、`?demo=1` + 検証したいパラメータ (と**パラメータ省略ケース**) で開き、`getComputedStyle(document.documentElement).getPropertyValue('--cg-...')` と要素の `getAnimations()` / boundingBox を assert する。過去のハーネス例: `~/cgtest-tmp/test_clamp_fix.js` / `test_align.js`。

## 本番デプロイ (mi.msjp.pro)

手動デプロイはしない。`bsky-integration` ブランチへ push すると Gitea Actions がイメージをビルドし、本番 (mi-host) の podman auto-update (5 分間隔) が反映する。**push から反映まで約 70 分。**

```bash
# 反映の監視 (StartedAt が変わったら新イメージ)
ssh root@mi-host.msjp-local.org -- 'sudo -iu misskey bash -c "export XDG_RUNTIME_DIR=/run/user/\$(id -u); podman inspect misskey-web --format \"{{.State.StartedAt}}\""'
# 反映後の疎通確認
curl -s -o /dev/null -w '%{http_code}\n' https://mi.msjp.pro/live/@VTF/comment-generator
curl -s https://mi.msjp.pro/static-assets/misc/comment-generator.js | grep -c '<変更した識別子>'
```

コミットは通常の Git 規約 (subject は日本語 ≤50 全角、`feat(twitch):` / `fix(twitch):` プレフィックス) に従い、CHANGELOG.md の Unreleased に一言追記する。
