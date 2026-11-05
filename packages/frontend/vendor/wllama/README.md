# 同梱の wllama (bsky-fork 独自)

端末内翻訳 (`packages/frontend/src/utility/plamo-translator.ts`) が使う [wllama](https://github.com/ngxson/wllama) のビルド済みファイルを置いている。wllama は llama.cpp を WebAssembly にしたライブラリで、WebGPU で推論できる。

## 同梱している理由

翻訳モデル PLaMo 3 Translate の GGUF は、tokenizer に `plamo3` を指定している。llama.cpp がこれを扱えるようになったのは 2026-10-06 の [PR #30045](https://github.com/ggml-org/llama.cpp/pull/30045) からで、npm の `@wllama/wllama` の最新版 (3.8.1、2026-10-02) が使う llama.cpp はそれより古い。3.8.1 のままでは `unknown tokenizer: 'plamo3'` で読み込めない。wllama の master は新しい llama.cpp を取り込んでいるが npm には出ていないため、master をビルドしたものをここに置いている。

npm の `file:` 依存にしなかったのは、root の `Dockerfile` が依存のインストール前に `package.json` しかコピーしないためで、upstream 由来の `Dockerfile` を変えずに済むようにした。この場所は eslint と SPDX 検査の対象外で、型検査も `skipLibCheck` により同梱の `.d.ts` を検査しない。

## 中身

| ファイル | 内容 |
|---|---|
| `esm/index.js` | wllama の ESM bundle (worker のコードと emscripten の glue を含む) |
| `esm/**/*.d.ts` | 型定義 |
| `esm/wasm/wllama.wasm` | llama.cpp の wasm (JSPI + Memory64 + WebGPU の main build。互換 build は同梱しない) |
| `LICENCE.wllama`、`LICENSE.llama.cpp`、`LICENSE.emdawnwebgpu-*` | 同梱物に含まれるコードのライセンス (いずれも MIT または BSD 系) |
| `SOURCE.json` | 元にした wllama と llama.cpp の commit、ツールチェーンの版、ビルド日時、各ファイルの sha256 |
| `build.sh` | ビルド手順。`build.sh <wllama の commit> <出力先>` |
| `Dockerfile` | CI が `build.sh` を emscripten/emsdk の image の中で実行するための定義 |

## 更新

`.gitea/workflows/wllama-vendor.yml` が毎日 wllama の master を確認し、CI でビルドして、ここの生成物を差し替える commit を `bsky-integration` に push する。詳細は `.gitea/README.md` の「wllama の同梱」を参照。

- **7 日の規則**: 対象は master への push のうち、GitHub の events API に記録された push 時刻が 7 日以上前の最新のもの (`payload.head`) で、npm の `minimumReleaseAge` と同じ期間を置く。commit に書かれた日付は書き換えられるので使わない。`SOURCE.json` の commit がその祖先で、かつ違うときだけ作り直す。
- **生成物の検査**: ビルド後に、出力の全パスが許可リスト (`esm/index.js`、`esm/wasm/wllama.wasm`、`esm/**/*.d.ts`、`LICENCE.wllama`、`LICENSE.*`、`SOURCE.json`) に合うこと、`SOURCE.json` の `files` と実ファイルの一覧および sha256 が一致すること、`index.js` と wasm の大きさが妥当な範囲にあることを確かめる。差し替えるのは許可リスト内のファイルだけで、`build.sh`、`Dockerfile`、`README.md` は上書きされない。
- **Dawn の固定**: emdawnwebgpu の zip の sha256 を `SOURCE.json` の `toolchain.dawnZipSha256` に記録する。次回以降、upstream の `DAWN_TAG` が同じ間はこの値と一致しなければビルドを失敗させ、tag が変わったときは新しい値を記録し直す。
- **base image の固定**: `Dockerfile` は `emscripten/emsdk` を tag と digest (`EMSDK_DIGEST`) の両方で指定する。

手元でビルドする場合は、wllama が `scripts/build_wasm.sh` で指定する版の emscripten (emsdk) を用意して `build.sh` を実行し、出力先の中身をこのディレクトリにコピーする。

## 外すとき

npm の `@wllama/wllama` が plamo3 に対応した llama.cpp を含む版になったら、CI が Issue で知らせる。そのときは次の作業でこの同梱をやめる。

1. `packages/frontend/package.json` に `@wllama/wllama` を追加し、`plamo-translator.ts` の import を `vendor/wllama` から依存に変える
2. このディレクトリと `.gitea/workflows/wllama-vendor.yml` を削除し、`.gitea/README.md` の該当箇所を消す
