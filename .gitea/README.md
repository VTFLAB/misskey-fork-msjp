# Gitea CI/CD

このディレクトリは misskey-bsky-fork の CI/CD を Gitea Actions 上で回すための workflow を集めている。

## 役割と起動条件

| Workflow | Trigger | 役割 |
|---|---|---|
| [upstream-sync.yml](workflows/upstream-sync.yml) | 毎日 18:00 UTC (= 03:00 JST) と手動 (`workflow_dispatch`) | `github.com/misskey-dev/misskey` の `master` を fetch し、`bsky-integration` に rebase。conflict なら `rebase --abort` して Gitea Issue を立て、workflow 全体は exit 1 で停止する。成功した場合は `git push --force-with-lease` で `bsky-integration` を更新する。 |
| [build-image.yml](workflows/build-image.yml) | `bsky-integration` への push と手動 | repo root の `Dockerfile` で container image を build、Gitea container registry に push する。tag は immutable な `<base_version>-bsky-<short_sha>` と rolling な `bsky-latest` の両方。 |

## 反映経路 (mi-host CT 200)

1. `bsky-integration` に commit を push (手動 push でも upstream-sync 経由の自動 rebase でも)
2. `build-image.yml` が trigger され、新 image を `git.msjp.pro/vtf/misskey-bsky-fork:bsky-latest` に上書き push
3. mi-host (CT 200) の `misskey` user 上で動く `podman-auto-update.timer` (5 分間隔) が registry 上の digest 変化を検出し、`podman auto-update` が pull + container restart を実行
4. Misskey container の entrypoint は `pnpm migrate && pnpm start`、起動毎に migration を自動適用

deploy 側 (Quadlet + auto-update timer の override) は `homelab-ops/misskey/` 側で管理している。fork repo は image 生成までで責務終了。

## 必要な secrets / 権限

- **`upstream-sync.yml`**: `secrets.GITEA_TOKEN` のみ。Gitea Actions が自動発行する repo scope
  token で、`contents: write` (push) + `issues: write` (conflict 時 Issue 作成) を満たす。
- **`build-image.yml`**: `secrets.REGISTRY_TOKEN` (user 側で 1 度だけ手動登録)。
  Gitea の `GITEA_TOKEN` は repo scope のみで packages registry の push 権限を含まないため、
  別途 VTF user の personal access token (`write:package` scope 必須) を登録する。
  登録先は `https://git.msjp.pro/VTF/misskey-bsky-fork/settings/actions/secrets` の `[Add Secret]`、
  Name = `REGISTRY_TOKEN`、Value = `~/.config/opencode/secrets/gitea.env` の `GITEA_ACCESS_TOKEN`
  (admin user の場合は all-scope なので writes:package を含む)。

## Trouble shooting

- **upstream-sync が conflict した**: 立った Issue を見て、`HANDOFF.md` の upstream rebase 手順に従い手動 rebase + `git push --force-with-lease origin bsky-integration` する。これで build-image.yml が trigger されて流れが復旧する。
- **build-image.yml で push 失敗**: registry login が `GITEA_TOKEN` 不足の可能性。`https://git.msjp.pro/-/admin/users/VTF` で repo + packages 権限を確認。
- **mi-host で image が更新されない**: `ssh root@mi-host.msjp-local.org 'sudo -iu misskey systemctl --user list-timers podman-auto-update'` で timer 状態を確認。手動 trigger は `sudo -iu misskey podman auto-update`。
