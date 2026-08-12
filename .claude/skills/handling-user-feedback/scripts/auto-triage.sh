#!/usr/bin/env bash
#
# SPDX-FileCopyrightText: syuilo and misskey-project
# SPDX-License-Identifier: AGPL-3.0-only
#
# auto-triage.sh — cron から定期実行され、open のフィードバックがあるときだけ
# claude -p (ヘッドレス) を起動して handling-user-feedback スキルの規律下で自立対応する。
#
# 設計:
#   - 事前チェックは curl 1 発。open が 0 件なら LLM を起動しない (トークン消費ゼロ)
#   - flock で多重起動を防止
#   - 対話セッションが作業中 (working tree dirty) の場合は衝突を避けて見送る
#   - セッションの全出力はログへ (~/.claude/logs/feedback-autotriage/YYYYMMDD.log)
#
# 導入: crontab に以下を登録 (03:00 JST の upstream-sync rebase 窓を避けた配置)
#   17 1,4,7,10,13,16,19,22 * * * /home/coder/projects/misskey/misskey-repo/.claude/skills/handling-user-feedback/scripts/auto-triage.sh

set -u

REPO="/home/coder/projects/misskey/misskey-repo"
API_BASE="${FEEDBACK_API_BASE:-http://mi-host.msjp-local.org:3000/api}"
LOG_DIR="$HOME/.claude/logs/feedback-autotriage"
LOCK_FILE="/tmp/feedback-autotriage.lock"
PROMPT_FILE="$REPO/.claude/skills/handling-user-feedback/references/auto-triage-prompt.md"
MAX_TURNS=200
export PATH="$HOME/.local/bin:$HOME/.volta/bin:/usr/local/bin:/usr/bin:/bin"

mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$(date +%Y%m%d).log"
log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
	log "skip: another run in progress"
	exit 0
fi

COUNT=$(curl -sS --max-time 20 -X POST "$API_BASE/feedback/list-local" \
	-H 'Content-Type: application/json' \
	-d '{"status":"open","limit":100}' | jq 'length' 2>/dev/null || echo err)
if [ "$COUNT" = "err" ] || [ -z "$COUNT" ]; then
	log "skip: feedback API unreachable"
	exit 0
fi
if [ "$COUNT" -eq 0 ]; then
	log "no open feedback"
	exit 0
fi

if [ -n "$(git -C "$REPO" status --porcelain)" ]; then
	log "skip: working tree dirty ($COUNT open feedback pending; interactive session in progress?)"
	exit 0
fi

log "=== starting autonomous triage for $COUNT open feedback ==="
cd "$REPO"
if claude -p --permission-mode bypassPermissions --max-turns "$MAX_TURNS" "$(cat "$PROMPT_FILE")" >> "$LOG" 2>&1; then
	log "=== triage session finished (ok) ==="
else
	log "=== triage session finished (exit=$?) ==="
fi
