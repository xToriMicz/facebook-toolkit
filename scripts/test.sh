#!/bin/bash
# Smoke test for facebook-toolkit frontend
# Usage: ./scripts/test.sh
# Exit code 0 = pass, 1 = fail

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
SRC_JS="$ROOT_DIR/public/src/js"
PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1"; }

echo "🧪 Running smoke tests..."
echo ""

# --- Test 1: Syntax check ---
echo "1. Syntax check (node --check)"
for f in "$SRC_JS"/*.js; do
  [ -f "$f" ] || continue
  NAME=$(basename "$f")
  if node --check "$f" 2>/dev/null; then
    pass "$NAME"
  else
    fail "$NAME — syntax error"
  fi
done

echo ""

# --- Test 2: No bare state variables outside state.js ---
echo "2. No bare state variables (should use state.xxx)"
BARE_VARS="selectedPage|uploadedImageUrl|uploadedImageData|uploadedImages|currentUser|userPages|allLogs|currentLogFilter|calYear|calMonth|calPosts|calScheduled|editingScheduleId|currentCommentPostId|replyTargetId|_bulkResults|insData|tipIdx"

for f in "$SRC_JS"/*.js; do
  [ -f "$f" ] || continue
  NAME=$(basename "$f")
  [ "$NAME" = "state.js" ] && continue
  # Look for bare variable usage (not state.xxx, not in string, not in comment)
  FOUND=$(grep -nE "([^.]|^)($BARE_VARS)[^a-zA-Z_]" "$f" | grep -v "state\." | grep -v "^.*\/\/" | grep -v "import " | grep -v "BARE_VARS" | head -5)
  if [ -n "$FOUND" ]; then
    fail "$NAME — bare state vars found:"
    echo "$FOUND" | head -3 | sed 's/^/    /'
  else
    pass "$NAME"
  fi
done

echo ""

# --- Test 3: onclick functions exist in main.js ---
echo "3. onclick functions exposed in main.js"
MAIN="$SRC_JS/main.js"
if [ -f "$MAIN" ]; then
  # Extract function names from onclick/onchange in HTML components
  ONCLICK_FNS=$(grep -rohE 'onclick="[a-zA-Z_]+' "$ROOT_DIR/public/components/"*.html "$ROOT_DIR/public/index.template.html" 2>/dev/null | sed 's/onclick="//' | sort -u)
  for fn in $ONCLICK_FNS; do
    if grep -q "$fn" "$MAIN"; then
      pass "$fn"
    else
      fail "$fn — not found in main.js"
    fi
  done
else
  fail "main.js not found"
fi

echo ""

# --- Test 4: All imports resolve ---
echo "4. Import resolution"
for f in "$SRC_JS"/*.js; do
  [ -f "$f" ] || continue
  NAME=$(basename "$f")
  IMPORTS=$(grep -oE "from ['\"]\.\/[^'\"]+['\"]" "$f" | sed "s/from ['\"]\.\/\(.*\)['\"]$/\1/" 2>/dev/null)
  for imp in $IMPORTS; do
    if [ -f "$SRC_JS/$imp" ]; then
      pass "$NAME → $imp"
    else
      fail "$NAME → $imp (not found)"
    fi
  done
done

echo ""

# --- Summary ---
TOTAL=$((PASS + FAIL))
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Results: $PASS passed, $FAIL failed (total $TOTAL)"

if [ $FAIL -gt 0 ]; then
  echo "❌ TESTS FAILED"
  exit 1
else
  echo "✅ ALL TESTS PASSED"
  exit 0
fi
