#!/usr/bin/env python3
"""Resolve the rebase conflicts that upstream-sync.yml can settle without judgment.

Run from the repository root while `git rebase` (or `git cherry-pick`) is stopped on a conflict.
"ours" is the side being rebased onto (upstream plus the fork commits already replayed), "theirs" is
the fork commit being replayed.

- pnpm-lock.yaml: take ours. The workflow regenerates the lockfile after the whole rebase.
- CHANGELOG.md: take ours. Fork entries live in CHANGELOG.fork.md and the fork never edits
  CHANGELOG.md, so a fork-side hunk there is dropped (and listed in the output).
- package.json (any directory): three-way merge of the parsed JSON, key by key. A key that both sides
  changed to different values is a real conflict and stops the script.

Every conflicted path must be one of those, otherwise nothing is touched. On success each resolved
path is staged and one line per path is printed: "<kind>\t<path>\t<commit>".

Exit status: 0 = all resolved and staged, 1 = a conflict needs a person, 2 = usage or git error.
Only the Python standard library is used (the workflow runs it in a plain Debian container).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

MISSING = object()


class Conflict(Exception):
    pass


def git(*args: str) -> str:
    return subprocess.run(['git', *args], check=True, capture_output=True, encoding='utf-8').stdout


def stage(path: str, n: int) -> str | None:
    r = subprocess.run(['git', 'show', f':{n}:{path}'], capture_output=True, encoding='utf-8')
    return r.stdout if r.returncode == 0 else None


def current_commit() -> str:
    for ref in ('REBASE_HEAD', 'CHERRY_PICK_HEAD'):
        r = subprocess.run(['git', 'log', '-1', '--format=%h %s', ref], capture_output=True, encoding='utf-8')
        if r.returncode == 0:
            return r.stdout.strip()
    return '?'


def kind_of(path: str) -> str | None:
    if path == 'pnpm-lock.yaml':
        return 'lock'
    if path == 'CHANGELOG.md':
        return 'changelog'
    if os.path.basename(path) == 'package.json':
        return 'package-json'
    return None


def merge_value(base, ours, theirs, where: list[str]):
    if ours == theirs or theirs == base:
        return ours
    if ours == base:
        return theirs
    if isinstance(ours, dict) and isinstance(theirs, dict) and (base is MISSING or isinstance(base, dict)):
        return merge_dict({} if base is MISSING else base, ours, theirs, where)
    raise Conflict('/'.join(where) or '(root)')


def merge_dict(base: dict, ours: dict, theirs: dict, where: list[str]) -> dict:
    out: list[tuple[str, object]] = []
    for k, ov in ours.items():
        v = merge_value(base.get(k, MISSING), ov, theirs.get(k, MISSING), where + [k])
        if v is not MISSING:
            out.append((k, v))
    theirs_keys = list(theirs.keys())
    for i, k in enumerate(theirs_keys):
        if k in ours:
            continue
        v = merge_value(base.get(k, MISSING), MISSING, theirs[k], where + [k])
        if v is MISSING:
            continue
        # keep the fork's placement: right after the nearest key that precedes it on the fork side
        placed = [kk for kk, _ in out]
        pos = 0
        for prev in reversed(theirs_keys[:i]):
            if prev in placed:
                pos = placed.index(prev) + 1
                break
        out.insert(pos, (k, v))
    return dict(out)


def dump(obj) -> str:
    return json.dumps(obj, indent='\t', ensure_ascii=False) + '\n'


def merge_package_json(path: str) -> str:
    base_text, ours_text, theirs_text = (stage(path, n) for n in (1, 2, 3))
    if base_text is None or ours_text is None or theirs_text is None:
        raise Conflict('added or deleted on one side')
    base, ours, theirs = json.loads(base_text), json.loads(ours_text), json.loads(theirs_text)
    if dump(ours) != ours_text:
        # the output would reformat the file; leave it to a person instead
        raise Conflict('unexpected formatting')
    if not all(isinstance(x, dict) for x in (base, ours, theirs)):
        raise Conflict('top level is not an object')
    return dump(merge_dict(base, ours, theirs, []))


def main() -> int:
    try:
        conflicted = [p for p in git('diff', '--name-only', '--diff-filter=U', '-z').split('\0') if p]
    except subprocess.CalledProcessError as e:
        print(f'git diff failed: {e.stderr.strip()}', file=sys.stderr)
        return 2
    if not conflicted:
        print('no conflicted paths', file=sys.stderr)
        return 1
    unsupported = [p for p in conflicted if kind_of(p) is None]
    if unsupported:
        print('needs a person: ' + ' '.join(unsupported), file=sys.stderr)
        return 1

    # decide everything first, so that a failure leaves the index and the work tree untouched
    plan: list[tuple[str, str, str | None]] = []
    for p in conflicted:
        k = kind_of(p)
        assert k is not None
        if k == 'package-json':
            try:
                plan.append((k, p, merge_package_json(p)))
            except (Conflict, json.JSONDecodeError) as e:
                print(f'needs a person: {p}: {e}', file=sys.stderr)
                return 1
        else:
            if stage(p, 2) is None:
                print(f'needs a person: {p}: deleted on the upstream side', file=sys.stderr)
                return 1
            plan.append((k, p, None))

    commit = current_commit()
    try:
        for k, p, text in plan:
            if text is None:
                git('checkout', '--ours', '--', p)
            else:
                with open(p, 'w', encoding='utf-8') as f:
                    f.write(text)
            git('add', '--', p)
            print(f'{k}\t{p}\t{commit}')
    except (subprocess.CalledProcessError, OSError) as e:
        print(f'resolving failed: {e}', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
