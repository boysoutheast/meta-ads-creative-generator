#!/usr/bin/env bash
# Phase 1 production smoke test.
# Usage: BACKEND=<url> FRONTEND=<url> ./scripts/smoke.sh
set -uo pipefail

BACKEND="${BACKEND:-https://meta-ads-creative-generator-production.up.railway.app}"
FRONTEND="${FRONTEND:-https://meta-ads-creative-generator.vercel.app}"

PASS=0
FAIL=0
RESULTS=()

now() { date +"%H:%M:%S"; }
green() { printf "\033[32m%s\033[0m" "$1"; }
red()   { printf "\033[31m%s\033[0m" "$1"; }
ok()    { PASS=$((PASS+1)); echo "  $(green PASS)  $1"; RESULTS+=("PASS  $1"); }
fail()  { FAIL=$((FAIL+1)); echo "  $(red FAIL)  $1 — $2"; RESULTS+=("FAIL  $1 — $2"); }

section() { echo ""; echo "=== $1 ==="; }

# 1. Backend health
section "Backend health"
HEALTH=$(curl -s -m 10 "$BACKEND/health")
echo "$HEALTH" | grep -q '"status":"ok"' && ok "/health 200 ok" || fail "/health" "got: $HEALTH"

DB=$(curl -s -m 10 "$BACKEND/health/db")
echo "$DB" | grep -q '"status":"ok"' && ok "/health/db 200 ok" || fail "/health/db" "got: $DB"

EXT=$(curl -s -m 10 "$BACKEND/health/external")
echo "$EXT" | grep -q '"status":"ok"' && ok "/health/external 200 ok" || fail "/health/external" "got: $EXT"

# 2. Frontend pages
section "Frontend pages"
for p in "/" "/login" "/register" "/dashboard"; do
  CODE=$(curl -s -m 10 -o /dev/null -w "%{http_code}" "$FRONTEND$p")
  [ "$CODE" = "200" ] && ok "$p HTTP $CODE" || fail "$p" "HTTP $CODE"
done

# 3. Auth flow
section "Auth flow"
EMAIL="smoke-$(date +%s)-$$@example.com"
NAME="Smoke Tester"
PASSWORD="smoke-test-pw-$$"

REG=$(curl -s -m 15 -X POST -H "Content-Type: application/json" \
  -d "{\"name\":\"$NAME\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  "$BACKEND/api/auth/register")
TOKEN=$(echo "$REG" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null)
if [ -n "$TOKEN" ]; then ok "POST /api/auth/register"; else fail "register" "$REG"; fi

LOG=$(curl -s -m 10 -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  "$BACKEND/api/auth/login")
LOGIN_TOKEN=$(echo "$LOG" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null)
if [ -n "$LOGIN_TOKEN" ]; then ok "POST /api/auth/login"; else fail "login" "$LOG"; fi
TOKEN="${LOGIN_TOKEN:-$TOKEN}"

ME=$(curl -s -m 10 -H "Authorization: Bearer $TOKEN" "$BACKEND/api/auth/me")
echo "$ME" | grep -q "$EMAIL" && ok "GET /api/auth/me" || fail "me" "$ME"

# 4. Generation flow
section "Generation flow"
JOB=$(curl -s -m 15 -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"angle":"fomo","productName":"Smoke Test Product","copy":"Limited offer ends today","cta":"Beli Sekarang","format":"1:1"}' \
  "$BACKEND/api/scale/single-image")
JOB_ID=$(echo "$JOB" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('jobId',''))" 2>/dev/null)
if [ -n "$JOB_ID" ]; then ok "POST /api/scale/single-image (jobId=$JOB_ID)"; else fail "create job" "$JOB"; fi

# Poll until terminal or timeout (180s)
RESULT_URL=""
STATUS=""
for i in $(seq 1 30); do
  J=$(curl -s -m 10 -H "Authorization: Bearer $TOKEN" "$BACKEND/api/scale/single-image/jobs/$JOB_ID")
  STATUS=$(echo "$J" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null)
  RESULT_URL=$(echo "$J" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('resultUrl') or '')" 2>/dev/null)
  ERR=$(echo "$J" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('errorMessage') or '')" 2>/dev/null)
  echo "  [$(now)] poll $i status=$STATUS"
  case "$STATUS" in
    completed) break ;;
    failed) fail "generation_failed" "$ERR"; break ;;
  esac
  sleep 6
done

if [ "$STATUS" = "completed" ] && [ -n "$RESULT_URL" ]; then
  ok "Job completed (resultUrl present)"
elif [ "$STATUS" != "failed" ]; then
  fail "Job did not complete in 180s" "last status=$STATUS"
fi

# 5. Library save + list
section "Library"
if [ -n "$JOB_ID" ] && [ -n "$RESULT_URL" ]; then
  SAVE=$(curl -s -m 10 -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"jobId\":\"$JOB_ID\",\"type\":\"single_image\",\"angle\":\"fomo\",\"title\":\"Smoke Item\",\"imageUrl\":\"$RESULT_URL\"}" \
    "$BACKEND/api/library")
  ITEM_ID=$(echo "$SAVE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('item',{}).get('id',''))" 2>/dev/null)
  [ -n "$ITEM_ID" ] && ok "POST /api/library (id=$ITEM_ID)" || fail "library save" "$SAVE"

  LIST=$(curl -s -m 10 -H "Authorization: Bearer $TOKEN" "$BACKEND/api/library")
  echo "$LIST" | grep -q "$ITEM_ID" && ok "GET /api/library contains saved" || fail "library list" "missing $ITEM_ID"

  DEL=$(curl -s -m 10 -X DELETE -H "Authorization: Bearer $TOKEN" "$BACKEND/api/library/$ITEM_ID")
  echo "$DEL" | grep -q '"ok":true' && ok "DELETE /api/library/$ITEM_ID" || fail "library delete" "$DEL"
fi

STATS=$(curl -s -m 10 -H "Authorization: Bearer $TOKEN" "$BACKEND/api/library/stats/summary")
echo "$STATS" | grep -q 'totalJobs' && ok "GET /api/library/stats/summary" || fail "stats" "$STATS"

# 6. Final
section "Summary"
echo "  Pass: $PASS"
echo "  Fail: $FAIL"
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
