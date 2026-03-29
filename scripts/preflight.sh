#!/bin/bash
# Pre-deploy safety check — ต้องผ่านทุกข้อก่อน deploy
# ใช้: ./scripts/preflight.sh (เรียกอัตโนมัติจาก npm run deploy)
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS=0
ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)

echo ""
echo "========================================="
echo "  🛫 Pre-deploy Safety Check"
echo "========================================="
echo ""

# 1. Check branch = main
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
  echo -e "${RED}❌ Branch ต้องเป็น main (ตอนนี้: $BRANCH)${NC}"
  exit 1
fi
echo -e "${GREEN}✅ Branch: main${NC}"

# 2. Build HTML from components
echo -e "${YELLOW}🔨 Building HTML...${NC}"
"$ROOT_DIR/scripts/build.sh" --no-minify
echo -e "${GREEN}✅ HTML build OK${NC}"

# 3. Syntax check ALL JS files
echo -e "${YELLOW}🔍 Checking JS syntax...${NC}"
for jsfile in "$ROOT_DIR/public/js"/*.js; do
  [ -f "$jsfile" ] || continue
  if ! node --check "$jsfile" 2>/dev/null; then
    echo -e "${RED}❌ Syntax error: $(basename $jsfile)${NC}"
    ERRORS=$((ERRORS + 1))
  fi
done
if [ $ERRORS -eq 0 ]; then
  echo -e "${GREEN}✅ All JS syntax OK${NC}"
fi

# 4. Check Worker builds
echo -e "${YELLOW}🔍 Checking Worker build...${NC}"
if ! npx wrangler deploy --dry-run 2>&1 | grep -q "dry-run: exiting"; then
  echo -e "${RED}❌ Worker build failed${NC}"
  ERRORS=$((ERRORS + 1))
else
  echo -e "${GREEN}✅ Worker build OK${NC}"
fi

# 5. Check HTML includes match components
echo -e "${YELLOW}🔍 Checking HTML includes...${NC}"
for comp in "$ROOT_DIR/public/components"/*.html; do
  [ -f "$comp" ] || continue
  BASENAME=$(basename "$comp")
  if ! grep -q "@include $BASENAME" "$ROOT_DIR/public/index.template.html"; then
    echo -e "${RED}❌ Component ไม่ถูก include: $BASENAME${NC}"
    ERRORS=$((ERRORS + 1))
  fi
done
if [ $ERRORS -eq 0 ]; then
  echo -e "${GREEN}✅ All components included${NC}"
fi

# 6. Check for dead element references
echo -e "${YELLOW}🔍 Checking dead element references...${NC}"
# Get all tab IDs from JS hide list
TAB_IDS=$(grep -o 'getElementById("[a-zA-Z]*")' "$ROOT_DIR/public/js"/*.js 2>/dev/null | grep -o '"[^"]*"' | tr -d '"' | grep '^tab' | sort -u)
for TAB_ID in $TAB_IDS; do
  if ! grep -q "id=\"$TAB_ID\"" "$ROOT_DIR/public/index.html" 2>/dev/null; then
    echo -e "${YELLOW}⚠️  Element #$TAB_ID ไม่พบใน index.html (อาจเป็น dead reference)${NC}"
  fi
done

# 7. Check no secrets in code
echo -e "${YELLOW}🔍 Checking for secrets...${NC}"
if grep -rn "sk-[a-zA-Z0-9]\{20,\}\|AKIA[A-Z0-9]\{16\}" "$ROOT_DIR/public/" "$ROOT_DIR/src/" 2>/dev/null | grep -v node_modules; then
  echo -e "${RED}❌ Possible secret found in code!${NC}"
  ERRORS=$((ERRORS + 1))
else
  echo -e "${GREEN}✅ No secrets found${NC}"
fi

echo ""
if [ $ERRORS -gt 0 ]; then
  echo -e "${RED}=========================================${NC}"
  echo -e "${RED}  ❌ FAILED — $ERRORS errors found${NC}"
  echo -e "${RED}  ห้าม deploy! แก้ error ก่อน${NC}"
  echo -e "${RED}=========================================${NC}"
  exit 1
else
  echo -e "${GREEN}=========================================${NC}"
  echo -e "${GREEN}  ✅ ALL CHECKS PASSED — safe to deploy${NC}"
  echo -e "${GREEN}=========================================${NC}"
fi
echo ""
