#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.}"
ROOT="$(cd "$ROOT" && pwd)"
FAIL=0

log() { printf '%s\n' "$*"; }
fail() { log "FAIL $*"; FAIL=1; }

is_example_env() {
  case "$1" in
    *.env.example|*.env.local.example|.env.example|.env.local.example) return 0 ;;
    *) return 1 ;;
  esac
}

list_files() {
  if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$ROOT" ls-files
  else
    find "$ROOT" -type f ! -path '*/node_modules/*' ! -path '*/.git/*' | sed "s|^$ROOT/||"
  fi
}

collect_hits() {
  local pattern="$1"
  if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$ROOT" grep -I -l -E "$pattern" -- . 2>/dev/null || true
  else
    grep -I -l -R -E "$pattern" "$ROOT" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null \
      | sed "s|^$ROOT/||" || true
  fi
}

while IFS= read -r path; do
  [[ -z "$path" ]] && continue
  base="${path##*/}"
  case "$base" in
    .env|.env.*|*.env)
      if ! is_example_env "$base"; then
        fail "tracked-env $path"
      fi
      ;;
  esac
  case "$path" in
    docs/render.log)
      fail "render-log $path"
      ;;
  esac
done < <(list_files)

while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  base="${file##*/}"
  if is_example_env "$base"; then
    continue
  fi
  case "$base" in
    *.test.sh|*.test.ts|*.test.js) continue ;;
  esac
  fail "session-jwt $file"
done < <(collect_hits 'Authorization:[[:space:]]*Bearer[[:space:]]+eyJ')

while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  base="${file##*/}"
  if is_example_env "$base"; then
    continue
  fi
  case "$base" in
    *.test.sh|*.test.ts|*.test.js) continue ;;
  esac
  if git -C "$ROOT" grep -I -E 'sk-ant-\.\.\.' -- "$file" >/dev/null 2>&1; then
    continue
  fi
  fail "anthropic-key-pattern $file"
done < <(collect_hits '(^|[=[:space:]])sk-ant-[A-Za-z0-9_-]{16,}')

if [[ "$FAIL" -ne 0 ]]; then
  exit 1
fi
log "OK secrets $ROOT"
exit 0
