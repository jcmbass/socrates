#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCAN="$ROOT/scripts/oss/scan-secrets.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

assert_fail() {
  local dir="$1"
  local needle="$2"
  local out
  set +e
  out="$("$SCAN" "$dir" 2>&1)"
  local code=$?
  set -e
  if [[ "$code" -eq 0 ]]; then
    printf 'expected fail in %s\n%s\n' "$dir" "$out"
    exit 1
  fi
  if ! printf '%s\n' "$out" | grep -q "$needle"; then
    printf 'expected %s in output of %s\n%s\n' "$needle" "$dir" "$out"
    exit 1
  fi
}

assert_ok() {
  local dir="$1"
  set +e
  local out
  out="$("$SCAN" "$dir" 2>&1)"
  local code=$?
  set -e
  if [[ "$code" -ne 0 ]]; then
    printf 'expected ok in %s\n%s\n' "$dir" "$out"
    exit 1
  fi
}

mkdir -p "$TMP/bad-env"
printf 'ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnopqrstuvwxyz1234\n' > "$TMP/bad-env/.env"
assert_fail "$TMP/bad-env" "tracked-env"

mkdir -p "$TMP/ok-example"
printf 'ANTHROPIC_API_KEY=sk-ant-...\n' > "$TMP/ok-example/.env.example"
assert_ok "$TMP/ok-example"

mkdir -p "$TMP/with-log/docs"
printf 'token=not-a-secret-in-this-fixture\n' > "$TMP/with-log/docs/render.log"
assert_fail "$TMP/with-log" "render-log"

mkdir -p "$TMP/with-jwt"
printf 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb\n' > "$TMP/with-jwt/note.md"
assert_fail "$TMP/with-jwt" "session-jwt"

printf 'scan-secrets.test.sh ok\n'
