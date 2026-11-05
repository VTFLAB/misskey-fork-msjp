# Gitea CI/CD

このディレクトリは misskey-bsky-fork の CI/CD を Gitea Actions 上で回すための workflow を集めている。

## 役割と起動条件

| Workflow | Trigger | 役割 |
|---|---|---|
| [upstream-sync.yml](workflows/upstream-sync.yml) | 毎日 18:00 UTC (= 03:00 JST) と手動 (`workflow_dispatch`) | `github.com/misskey-dev/misskey` の `master` を fetch し、`bsky-integration` に rebase。conflict なら `rebase --abort` して Gitea Issue を立て、workflow 全体は exit 1 で停止する。成功した場合は `git push --force-with-lease` で `bsky-integration` を更新する。 |
| [build-image.yml](workflows/build-image.yml) | `bsky-integration` への push と手動 | repo root の `Dockerfile` で container image を build、Gitea container registry に push する。tag は immutable な `<base_version>-bsky-<short_sha>` と rolling な `bsky-latest` の両方。 |
| [wllama-vendor.yml](workflows/wllama-vendor.yml) | 毎日 19:30 UTC (upstream-sync の 90 分後)、手動 (`workflow_dispatch`)、この workflow・`Dockerfile`・`build.sh` を変えた push | `packages/frontend/vendor/wllama/` に同梱している wllama を、upstream master から CI で build し直す。 |

## 反映経路

1. `bsky-integration` に commit を push (手動 push でも upstream-sync 経由の自動 rebase でも)
2. `build-image.yml` が trigger され、新 image を `git.msjp.pro/vtf/misskey-bsky-fork:bsky-latest` に上書き push
3. 本番ホストの `podman-auto-update.timer` (5 分間隔) が registry 上の digest 変化を検出し、`podman auto-update` が pull + container restart を実行
4. Misskey container の entrypoint は `pnpm migrate && pnpm start`、起動毎に migration を自動適用

deploy 側 (Quadlet + auto-update timer の override) は非公開の homelab-ops リポジトリで管理している。fork repo は image 生成までで責務終了。

## 必要な secrets / 権限

- **`upstream-sync.yml`**: `secrets.GITEA_TOKEN` のみ。Gitea Actions が自動発行する repo scope
  token で、`contents: write` (push) + `issues: write` (conflict 時 Issue 作成) を満たす。
- **`build-image.yml`**: `secrets.REGISTRY_TOKEN` (user 側で 1 度だけ手動登録)。
  Gitea の `GITEA_TOKEN` は repo scope のみで packages registry の push 権限を含まないため、
  `write:package` scope を持つ personal access token を repo の Actions secrets に登録する。
  登録手順と token の出所は非公開の運用メモ (homelab-ops `misskey/docs/OPS.md`) を参照。

## wllama の同梱 (wllama-vendor.yml)

PLaMo 3 Translate の GGUF は llama.cpp の plamo3 tokenizer を要求する。npm の `@wllama/wllama` はまだ対応した版を出していないため、wllama の master を build した成果物を `packages/frontend/vendor/wllama/` に同梱している。

- **起動**: 毎日 19:30 UTC、手動実行 (`force` と、40 桁の `commit` を指定できる)、この workflow・`Dockerfile`・`build.sh` を変えた push。同梱物そのものの変更では起動しないので、自分の push で再起動する循環は起きない。
- **判定**: 対象は upstream master への push のうち、GitHub の events API (直近 100 件) に記録された push 時刻が 7 日以上前の最新のもの (`payload.head`。npm の `minimumReleaseAge` と同じ 7 日)。commit の日付は書き換えられるので使わない。`SOURCE.json` の `wllama.commit` がその祖先で、かつ違うときだけ作り直す。同じ、より新しい、別の履歴のいずれかなら何もしない。手動の `force` は上の条件を無視し、push 起動は同梱中の commit を作り直す。`commit` 入力で指定した commit には 7 日の規則と祖先の検査を適用しない。
- **build**: `Dockerfile` が `emscripten/emsdk` image の中で `build.sh` を実行する。image は `EMSDK_TAG` と `EMSDK_DIGEST` (digest) で固定する。upstream の `EMSDK_IMAGE_TAG` と `EMSDK_TAG` が違えば build の前に止まる。emdawnwebgpu の zip は、upstream の `DAWN_TAG` が同梱中と同じ間は `SOURCE.json` の `toolchain.dawnZipSha256` に固定し、tag が変わったときだけ新しい sha256 を記録する。build の出力は `/tmp/build.log` にだけ書き、step 全体を `::stop-commands::` で囲んで、upstream 由来の文字列で workflow command が実行されないようにしている。
- **検査と commit**: 出力の全パスが許可リストに合い、`SOURCE.json` の `files` と実ファイルが sha256 まで一致し、`index.js` と wasm の大きさが範囲内であることを確かめてから、許可リスト内のファイル (`esm/`、`LICENCE.wllama`、`LICENSE.*`、`SOURCE.json`) だけを差し替える。`builtAt` 以外に差が無ければ commit しない。`bsky-integration` へ通常の push で載せ、non-fast-forward で断られたら最新の先頭を取り直して 1 回だけやり直す。
- **本番への反映**: この Gitea は Actions の token による push では workflow を起動しない。そのため push したら、この workflow が `build-image.yml` を必ず `workflow_dispatch` で起動する。起動に失敗したら `wllama の同梱を本番に反映できませんでした` で始まる Issue を 1 件立てるか更新し、job も失敗させる。
- **判定・build の失敗**: commit せず、`wllama の同梱ビルドに失敗しました` で始まる Issue を 1 件立てるか更新する。失敗した段階 (`decide` を含む) とログ末尾 80 行が入る。
- **npm 版の見張り**: `@wllama/wllama` の最新版のタグが指す llama.cpp に `"plamo3"` があれば、`wllama の npm 版 ... が PLaMo 3 に対応しました` で始まる Issue を 1 件立てるか更新する。依存への切り替えは手動で行う。

## Trouble shooting

- **upstream-sync が conflict した**: 立った Issue を見て、`CLAUDE.md` の「上流追従」の手順に従い手動 rebase + `git push --force-with-lease origin bsky-integration` する。これで build-image.yml が trigger されて流れが復旧する。
- **build-image.yml で push 失敗**: registry login の token 権限不足の可能性。`REGISTRY_TOKEN` の user が repo + packages 権限を持つか確認する。
- **本番で image が更新されない**: 本番ホストの `podman-auto-update` timer の状態を確認する。確認コマンドは非公開の運用メモを参照。
- **wllama-vendor が失敗した**: 立った Issue の段階を見る。`toolchain-check` なら upstream が emsdk の版を変えたので、`Dockerfile` の `EMSDK_TAG` と `EMSDK_DIGEST` を直し、`build.sh` が upstream の `scripts/docker-compose.yml` と合っているか確かめる。
