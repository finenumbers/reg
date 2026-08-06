#!/usr/bin/env bash
# Lightweight production/local smoke checks against a running app.
# Usage:
#   ./scripts/smoke-check.sh
#   BASE_URL=https://regs.example.com ./scripts/smoke-check.sh
#   BASE_URL=http://localhost:3000 COOKIE_JAR=/tmp/reg-cookies ./scripts/smoke-check.sh --auth
#
# With --auth (optional): also hits session-gated APIs using COOKIE_JAR from a prior login.
# Default checks are unauthenticated health/readiness only + scheduler env reminder.

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
COOKIE_JAR="${COOKIE_JAR:-}"
AUTH=0
FAILS=0

if [[ "${1:-}" == "--auth" ]]; then
  AUTH=1
fi

say() { printf '%s\n' "$*"; }
pass() { say "PASS  $*"; }
fail() { say "FAIL  $*"; FAILS=$((FAILS + 1)); }

check_http() {
  local path="$1"
  local expect="$2"
  local label="$3"
  local code
  code=$(curl -sS -o /tmp/reg-smoke-body.json -w "%{http_code}" "${BASE_URL}${path}" || true)
  if [[ "$code" == "$expect" ]]; then
    pass "$label (HTTP $code)"
  else
    fail "$label (expected HTTP $expect, got ${code:-none})"
    if [[ -f /tmp/reg-smoke-body.json ]]; then
      say "      body: $(head -c 200 /tmp/reg-smoke-body.json)"
    fi
  fi
}

say "=== Reg platform smoke checks ==="
say "BASE_URL=$BASE_URL"
say ""

check_http "/api/healthz" "200" "liveness /api/healthz"
check_http "/api/readyz" "200" "readiness /api/readyz"

# Unauthenticated protected APIs must reject
check_http "/api/settings" "401" "settings requires auth"
check_http "/api/regs" "401" "regs requires auth"
check_http "/api/jobs" "401" "jobs requires auth"
check_http "/api/audit" "401" "audit requires auth"

if [[ "$AUTH" -eq 1 ]]; then
  if [[ -z "$COOKIE_JAR" || ! -f "$COOKIE_JAR" ]]; then
    fail "--auth requires COOKIE_JAR pointing to a Netscape cookie file from a browser login"
  else
    auth_get() {
      local path="$1"
      local label="$2"
      local code
      code=$(curl -sS -b "$COOKIE_JAR" -o /tmp/reg-smoke-body.json -w "%{http_code}" "${BASE_URL}${path}" || true)
      if [[ "$code" == "200" ]]; then
        pass "$label (HTTP 200)"
      else
        fail "$label (expected 200, got ${code:-none})"
      fi
    }
    auth_get "/api/auth/me" "session /api/auth/me"
    auth_get "/api/settings" "settings page API"
    auth_get "/api/regs" "registrations list API"
    auth_get "/api/regs/status" "registrations status widget"
    auth_get "/api/jobs" "jobs list API"
    # audit may be 403 for operators — accept 200 or 403
    code=$(curl -sS -b "$COOKIE_JAR" -o /tmp/reg-smoke-body.json -w "%{http_code}" "${BASE_URL}/api/audit" || true)
    if [[ "$code" == "200" || "$code" == "403" ]]; then
      pass "audit API reachable (HTTP $code)"
    else
      fail "audit API (expected 200 or 403, got ${code:-none})"
    fi
  fi
fi

say ""
say "Manual UI checks (operator):"
say "  [ ] /login works with bootstrap admin"
say "  [ ] /settings loads; SSH key replace + Test connection"
say "  [ ] /regs loads; manual Run poll"
say "  [ ] /jobs and /audit (admin) load"
say "  [ ] Auto-poll off unless Settings regsPollEnabled on a single replica"
say ""

if [[ "$FAILS" -gt 0 ]]; then
  say "RESULT: $FAILS check(s) failed"
  exit 1
fi
say "RESULT: automated checks passed"
exit 0
