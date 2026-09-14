#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.}"
ROOT="$(cd "$ROOT" && pwd)"

if [[ ! -f "$ROOT/package.json" ]]; then
  printf 'FAIL no-package-json %s\n' "$ROOT"
  exit 1
fi

cd "$ROOT"
if [[ ! -d node_modules ]]; then
  printf 'SKIP audit (no node_modules) %s\n' "$ROOT"
  exit 0
fi

set +e
npm audit --omit=dev --json > /tmp/buxo-oss-audit.json 2>/tmp/buxo-oss-audit.err
code=$?
set -e

python3 - <<'PY'
import json
from pathlib import Path
raw = Path("/tmp/buxo-oss-audit.json").read_text()
if not raw.strip():
    print("FAIL audit-empty")
    raise SystemExit(1)
data = json.loads(raw)
meta = (data.get("metadata") or {}).get("vulnerabilities") or {}
print(
    "audit critical=%s high=%s moderate=%s low=%s total=%s"
    % (
        meta.get("critical", 0),
        meta.get("high", 0),
        meta.get("moderate", 0),
        meta.get("low", 0),
        meta.get("total", 0),
    )
)
vulns = data.get("vulnerabilities") or {}
for name, row in sorted(vulns.items()):
    sev = row.get("severity")
    if sev in ("critical", "high"):
        print("finding %s %s" % (sev, name))
PY

exit "$code"
