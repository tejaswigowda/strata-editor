#!/usr/bin/env bash
# sync.sh <tag> — copy one release of the renders repository to storage and prove the copy is right (gate G5).
#
#   <tag>            <slug>/v<N>, checked out in the current directory (the folder <slug>/ holds the render)
#   R2_BUCKET        bucket name                       R2_ENDPOINT   https://<account>.r2.cloudflarestorage.com
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY          an R2 API token scoped to that bucket
#   PUBLIC_BASE      where the Worker serves it (default https://strataeditor.dev/video)
#   SKIP_UPLOAD=1    verify only (used by the tests, and to re-check a finished sync)
#
# Steps, each of which fails the run:
#   1  the committed folder is exactly what files.sha256 lists (no missing, changed or unlisted file)
#   2  upload to video/<tag>/ — never deleting anything: a published tag is immutable
#   3  every file as served from PUBLIC_BASE/<tag>/ matches files.sha256, and so does the manifest itself
# Idempotent: running it again uploads nothing new and verifies the same.
set -euo pipefail

tag="${1:?usage: sync.sh <slug>/v<N>}"
slug="${tag%/v*}"
public="${PUBLIC_BASE:-https://strataeditor.dev/video}"
[[ "$tag" =~ ^.+/v[1-9][0-9]*$ ]] || { echo "not a release tag: $tag" >&2; exit 2; }
[ -f "$slug/files.sha256" ] || { echo "$slug/files.sha256 is missing: this render predates the manifest and cannot be synced verifiably" >&2; exit 1; }

hash_of() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

echo "1/3 the committed folder against files.sha256"
listed="$(mktemp)"; actual="$(mktemp)"
cut -c67- "$slug/files.sha256" | sort > "$listed"
(cd "$slug" && find . -type f ! -name files.sha256 | sed 's|^\./||' | sort) > "$actual"
if ! diff -q "$listed" "$actual" >/dev/null; then echo "files differ from the manifest:" >&2; diff "$listed" "$actual" >&2 || true; exit 1; fi
while read -r want path; do
  got="$(hash_of "$slug/$path")"
  [ "$got" = "$want" ] || { echo "changed since the manifest was made: $path" >&2; exit 1; }
done < "$slug/files.sha256"
echo "    $(wc -l < "$listed" | tr -d ' ') files match"

if [ -z "${SKIP_UPLOAD:-}" ]; then
  echo "2/3 upload to video/$tag/"
  aws s3 sync "$slug/" "s3://${R2_BUCKET:?}/video/$tag/" --endpoint-url "${R2_ENDPOINT:?}" --only-show-errors
else
  echo "2/3 upload skipped"
fi

echo "3/3 what $public/$tag/ serves, against files.sha256"
tmp="$(mktemp)"
curl -fsS --retry 5 --retry-delay 2 --retry-all-errors "$public/$tag/files.sha256" -o "$tmp"
cmp -s "$tmp" "$slug/files.sha256" || { echo "the served files.sha256 is not the committed one" >&2; exit 1; }
bad=0
while read -r want path; do
  curl -fsS --retry 5 --retry-delay 2 --retry-all-errors "$public/$tag/$path" -o "$tmp" || { echo "not served: $path" >&2; bad=1; continue; }
  [ "$(hash_of "$tmp")" = "$want" ] || { echo "served with other bytes: $path" >&2; bad=1; }
done < "$slug/files.sha256"
[ "$bad" = 0 ] || exit 1
echo "verified: $tag is served exactly as committed"
