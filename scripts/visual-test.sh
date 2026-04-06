#!/bin/bash
# Visual smoke test — screenshot หลัง deploy แล้วเทียบกับ baseline
# ใช้: ./scripts/visual-test.sh [update]
#   ไม่มี arg: เทียบ screenshot กับ baseline → ถ้าต่างเตือน
#   update: อัพเดต baseline ใหม่

set -e

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
BASELINE_DIR="$ROOT_DIR/scripts/visual-baselines"
CURRENT_DIR="/tmp/visual-test-current"
SESSION_ID=""

mkdir -p "$BASELINE_DIR" "$CURRENT_DIR"

# หา session cookie จาก KV (ต้องมี wrangler)
get_session() {
  SESSION_ID=$(cd "$ROOT_DIR" && npx wrangler kv key list --namespace-id=6447fb51f8d0414e8c6d2bd93eac236a --remote --prefix="session:" 2>/dev/null | grep -o '"session:[^"]*"' | head -1 | sed 's/"session://;s/"//')
  if [ -z "$SESSION_ID" ]; then
    echo "⚠️  ไม่พบ session — ข้าม visual test"
    exit 0
  fi
}

# Screenshot ทุก tab หลัก
screenshot_tabs() {
  local OUT_DIR="$1"
  NODE_PATH=/opt/homebrew/lib/node_modules node << SCRIPT
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{
    name: 'session', value: '${SESSION_ID}',
    domain: 'fb.makeloops.xyz', path: '/', httpOnly: true, secure: true, sameSite: 'Lax'
  }]);
  const page = await ctx.newPage();
  const tabs = ['compose', 'schedule', 'calendar', 'activityLog', 'insights'];
  for (const tab of tabs) {
    await page.goto('https://fb.makeloops.xyz/?tab=' + tab, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '${OUT_DIR}/' + tab + '.png' });
    console.log('  📸 ' + tab);
  }
  await browser.close();
})();
SCRIPT
}

echo ""
echo "========================================="
echo "  👁️  Visual Smoke Test"
echo "========================================="
echo ""

get_session

if [ "$1" = "update" ]; then
  echo "📸 อัพเดต baselines..."
  screenshot_tabs "$BASELINE_DIR"
  echo ""
  echo "✅ Baselines อัพเดตแล้ว ($BASELINE_DIR)"
  exit 0
fi

# เทียบ: ถ้าไม่มี baseline → สร้างใหม่
if [ ! -f "$BASELINE_DIR/compose.png" ]; then
  echo "📸 ไม่มี baseline — สร้างใหม่..."
  screenshot_tabs "$BASELINE_DIR"
  echo "✅ Baselines สร้างแล้ว — รอบหน้าจะเทียบได้"
  exit 0
fi

# Screenshot ปัจจุบัน
echo "📸 Screenshot ปัจจุบัน..."
screenshot_tabs "$CURRENT_DIR"

# เทียบ pixel diff
echo ""
echo "🔍 เทียบกับ baseline..."
DIFF_COUNT=0
for tab in compose schedule calendar activityLog insights; do
  BASELINE="$BASELINE_DIR/$tab.png"
  CURRENT="$CURRENT_DIR/$tab.png"
  if [ ! -f "$BASELINE" ] || [ ! -f "$CURRENT" ]; then
    echo "  ⚠️  $tab — ข้าม (ไม่มีไฟล์)"
    continue
  fi
  # ใช้ ImageMagick compare ถ้ามี, ไม่งั้นเทียบ file size
  if command -v compare &>/dev/null; then
    DIFF=$(compare -metric AE "$BASELINE" "$CURRENT" /dev/null 2>&1 || true)
    if [ "$DIFF" -gt 5000 ] 2>/dev/null; then
      echo "  ⚠️  $tab — เปลี่ยนแปลง ($DIFF pixels)"
      DIFF_COUNT=$((DIFF_COUNT + 1))
    else
      echo "  ✅ $tab — ไม่เปลี่ยน"
    fi
  else
    SIZE_BASE=$(wc -c < "$BASELINE")
    SIZE_CURR=$(wc -c < "$CURRENT")
    DIFF_PCT=$(( (SIZE_CURR - SIZE_BASE) * 100 / (SIZE_BASE + 1) ))
    if [ "${DIFF_PCT#-}" -gt 10 ]; then
      echo "  ⚠️  $tab — ขนาดต่าง ${DIFF_PCT}%"
      DIFF_COUNT=$((DIFF_COUNT + 1))
    else
      echo "  ✅ $tab — ไม่เปลี่ยน"
    fi
  fi
done

echo ""
if [ $DIFF_COUNT -gt 0 ]; then
  echo "========================================="
  echo "  ⚠️  $DIFF_COUNT tab เปลี่ยนแปลง — ตรวจสอบด้วยตา"
  echo "  Baselines: $BASELINE_DIR/"
  echo "  Current:   $CURRENT_DIR/"
  echo "========================================="
  echo ""
  echo "ถ้าเปลี่ยนถูกต้อง: ./scripts/visual-test.sh update"
else
  echo "========================================="
  echo "  ✅ Visual test PASSED — ไม่มี tab เปลี่ยน"
  echo "========================================="
fi
echo ""
