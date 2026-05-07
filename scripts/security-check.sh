#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
DISABLED_SHARE_SLUG="${DISABLED_SHARE_SLUG:-}"

pass() {
  printf '[PASS] %s\n' "$1"
}

fail() {
  printf '[FAIL] %s\n' "$1" >&2
  exit 1
}

status_code() {
  local path="$1"
  curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}${path}"
}

assert_status() {
  local label="$1"
  local path="$2"
  local expected="$3"
  local actual
  actual="$(status_code "$path")"
  if [[ "$actual" != "$expected" ]]; then
    fail "${label}: expected ${expected}, got ${actual} (${path})"
  fi
  pass "${label}"
}

assert_status "Unauthorized /api/notes" "/api/notes" "401"
assert_status "Blocked /data path" "/data/secret.txt" "404"
assert_status "Blocked sqlite path" "/app.sqlite" "404"
assert_status "Blocked db path" "/backup.db" "404"
assert_status "Blocked traversal path" "/notes/../../app.sqlite" "404"
assert_status "Blocked traversal API path" "/api/notes/..%2F..%2Fsecret.txt" "404"

if [[ -n "$DISABLED_SHARE_SLUG" ]]; then
  assert_status "Disabled public share" "/s/${DISABLED_SHARE_SLUG}" "404"
else
  printf '[SKIP] Disabled public share (set DISABLED_SHARE_SLUG to test)\n'
fi

printf '\nSecurity checks completed successfully for %s\n' "$BASE_URL"
