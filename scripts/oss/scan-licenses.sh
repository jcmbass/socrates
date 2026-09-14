#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.}"
ROOT="$(cd "$ROOT" && pwd)"
FAIL=0

log() { printf '%s\n' "$*"; }
fail() { log "FAIL $*"; FAIL=1; }

while IFS= read -r req; do
  [[ -z "$req" ]] && continue
  if grep -Eiq '^[[:space:]]*pymupdf([[:space:]]|=|$)' "$req"; then
    fail "agpl-python pymupdf $req"
  fi
done < <(find "$ROOT" -name requirements.txt ! -path '*/node_modules/*' ! -path '*/.git/*')

LOCK="$ROOT/package-lock.json"
if [[ -f "$LOCK" ]]; then
  python3 - "$LOCK" <<'PY'
import json, sys
from collections import Counter
lock = json.load(open(sys.argv[1], encoding="utf-8"))
counts = Counter()
agpl = []
for path, meta in (lock.get("packages") or {}).items():
    lic = str(meta.get("license") or "(missing)")
    counts[lic] += 1
    if "AGPL" in lic.upper():
        agpl.append((path or ".", lic))
for lic, n in counts.most_common():
    print("%s: %s" % (lic, n))
if agpl:
    for path, lic in agpl:
        print("FAIL agpl-npm %s %s" % (path, lic))
    raise SystemExit(2)
PY
  if [[ $? -eq 2 ]]; then
    FAIL=1
  fi
fi

if [[ "$FAIL" -ne 0 ]]; then
  exit 1
fi
log "OK licenses $ROOT"
exit 0
