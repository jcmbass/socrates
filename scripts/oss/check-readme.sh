#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
README="${1:-$ROOT/README.md}"

need() {
  local needle="$1"
  if ! grep -q -F "$needle" "$README"; then
    printf 'FAIL README missing %s\n' "$needle" >&2
    exit 1
  fi
}

need "apps/server"
need "apps/mobile"
need "LICENSE"
need "NOTICE"

if grep -n "ANTHROPIC_API_KEY" "$README"; then
  printf 'FAIL README must not list ANTHROPIC_API_KEY as a student-path step\n' >&2
  exit 1
fi

if grep -nE 'onrender\.com' "$README"; then
  printf 'FAIL README must not paste a production host\n' >&2
  exit 1
fi

if ! grep -q "plan-beta-real" "$README"; then
  printf 'FAIL README must say tester notes in docs/plan-beta-real/ are out of scope\n' >&2
  exit 1
fi

printf 'ok %s\n' "$README"
