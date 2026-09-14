#!/usr/bin/env bash
set -euo pipefail

SRC="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="${1:-}"
if [[ -z "$DEST" ]]; then
  printf 'usage: export.sh <dest-dir>\n' >&2
  exit 2
fi
mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"

INCLUDE="$SRC/oss/include.txt"
EXCLUDE="$SRC/oss/exclude.txt"
python3 - "$SRC" "$DEST" "$INCLUDE" "$EXCLUDE" <<'PY'
import fnmatch
import json
import os
import shutil
import subprocess
import sys

src, dest, include_path, exclude_path = sys.argv[1:5]

def load_patterns(path):
    rows = []
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        rows.append(line)
    return rows

include = load_patterns(include_path)
exclude = [p for p in load_patterns(exclude_path) if not p.startswith("!")]
negate = [p[1:] for p in load_patterns(exclude_path) if p.startswith("!")]

tracked = subprocess.check_output(["git", "-C", src, "ls-files"], text=True).splitlines()

def match_any(path, patterns):
    for pat in patterns:
        if fnmatch.fnmatch(path, pat) or fnmatch.fnmatch(os.path.basename(path), pat):
            return True
        if pat.endswith("/**") and (path.startswith(pat[:-3]) or path == pat[:-3].rstrip("/")):
            return True
    return False

copied = 0
for path in tracked:
    if not match_any(path, include):
        continue
    if match_any(path, exclude) and not match_any(path, negate):
        continue
    src_file = os.path.join(src, path)
    dest_file = os.path.join(dest, path)
    os.makedirs(os.path.dirname(dest_file), exist_ok=True)
    shutil.copy2(src_file, dest_file)
    copied += 1

pkg_path = os.path.join(dest, "package.json")
if os.path.isfile(pkg_path):
    pkg = json.loads(open(pkg_path, encoding="utf-8").read())
    pkg["workspaces"] = ["apps/server", "apps/mobile", "packages/*"]
    scripts = pkg.setdefault("scripts", {})
    scripts["dev"] = "npm run dev -w apps/server"
    scripts["build"] = "npm run build -w apps/server"
    scripts["start"] = "npm run start -w apps/server"
    scripts.pop("eval", None)
    scripts.pop("ingest", None)
    scripts.pop("test:watch", None)
    json.dump(pkg, open(pkg_path, "w", encoding="utf-8"), indent=2)
    open(pkg_path, "a", encoding="utf-8").write("\n")

df_path = os.path.join(dest, "apps/server/Dockerfile")
if os.path.isfile(df_path):
    lines = open(df_path, encoding="utf-8").read().splitlines(True)
    kept = [ln for ln in lines if "apps/harness/package.json" not in ln]
    open(df_path, "w", encoding="utf-8").writelines(kept)

print("exported %d files to %s" % (copied, dest))
PY
