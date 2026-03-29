#!/bin/bash
# Build facebook-toolkit frontend
# Usage: ./scripts/build.sh [--no-minify]
#
# Source: public/src/js/*.js, public/src/css/*.css, public/index.template.html
# Output: public/js/*.js, public/css/*.css, public/index.html
#
# IMPORTANT: Never edit files in public/js/ or public/css/ directly!
# Always edit in public/src/ — build.sh copies + minifies to public/

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
TEMPLATE="$ROOT_DIR/public/index.template.html"
COMPONENTS_DIR="$ROOT_DIR/public/components"
OUTPUT="$ROOT_DIR/public/index.html"
SRC_JS="$ROOT_DIR/public/src/js"
SRC_CSS="$ROOT_DIR/public/src/css"
DIST_JS="$ROOT_DIR/public/js"
DIST_CSS="$ROOT_DIR/public/css"
NO_MINIFY=false

if [ "$1" = "--no-minify" ]; then
  NO_MINIFY=true
fi

# --- Step 1: Assemble HTML ---
if [ -f "$TEMPLATE" ] && [ -d "$COMPONENTS_DIR" ]; then
  cp "$TEMPLATE" "$OUTPUT"
  for component in "$COMPONENTS_DIR"/*.html; do
    FILENAME=$(basename "$component")
    sed -i '' "/@include ${FILENAME}/r ${component}
/@include ${FILENAME}/d" "$OUTPUT"
  done
  LINES=$(wc -l < "$OUTPUT" | tr -d ' ')
  COMPONENTS=$(ls "$COMPONENTS_DIR"/*.html 2>/dev/null | wc -l | tr -d ' ')
  echo "HTML: assembled $LINES lines from $COMPONENTS components"
else
  echo "HTML: no template found, skipping assembly"
fi

# --- Step 2: Copy src → dist + Minify ---
mkdir -p "$DIST_JS" "$DIST_CSS"

if [ "$NO_MINIFY" = false ] && command -v npx &>/dev/null; then
  JS_TOTAL=0
  JS_MIN=0
  for srcfile in "$SRC_JS"/*.js; do
    [ -f "$srcfile" ] || continue
    FILENAME=$(basename "$srcfile")
    ORIG_SIZE=$(wc -c < "$srcfile" | tr -d ' ')
    JS_TOTAL=$((JS_TOTAL + ORIG_SIZE))
    npx esbuild "$srcfile" --minify --outfile="$DIST_JS/$FILENAME" --allow-overwrite 2>/dev/null
    MIN_SIZE=$(wc -c < "$DIST_JS/$FILENAME" | tr -d ' ')
    JS_MIN=$((JS_MIN + MIN_SIZE))
  done
  if [ $JS_TOTAL -gt 0 ]; then
    SAVED=$(( (JS_TOTAL - JS_MIN) * 100 / JS_TOTAL ))
    echo "JS:   $(echo $JS_TOTAL | awk '{printf "%.1fKB", $1/1024}') → $(echo $JS_MIN | awk '{printf "%.1fKB", $1/1024}') (-${SAVED}%)"
  fi

  CSS_TOTAL=0
  CSS_MIN=0
  for srcfile in "$SRC_CSS"/*.css; do
    [ -f "$srcfile" ] || continue
    FILENAME=$(basename "$srcfile")
    ORIG_SIZE=$(wc -c < "$srcfile" | tr -d ' ')
    CSS_TOTAL=$((CSS_TOTAL + ORIG_SIZE))
    npx esbuild "$srcfile" --minify --outfile="$DIST_CSS/$FILENAME" --allow-overwrite 2>/dev/null
    MIN_SIZE=$(wc -c < "$DIST_CSS/$FILENAME" | tr -d ' ')
    CSS_MIN=$((CSS_MIN + MIN_SIZE))
  done
  if [ $CSS_TOTAL -gt 0 ]; then
    SAVED=$(( (CSS_TOTAL - CSS_MIN) * 100 / CSS_TOTAL ))
    echo "CSS:  $(echo $CSS_TOTAL | awk '{printf "%.1fKB", $1/1024}') → $(echo $CSS_MIN | awk '{printf "%.1fKB", $1/1024}') (-${SAVED}%)"
  fi
else
  # No minify — just copy
  cp "$SRC_JS"/*.js "$DIST_JS/" 2>/dev/null
  cp "$SRC_CSS"/*.css "$DIST_CSS/" 2>/dev/null
  if [ "$NO_MINIFY" = true ]; then
    echo "Minify: skipped (--no-minify) — copied src to dist"
  else
    echo "Minify: skipped (npx not found) — copied src to dist"
  fi
fi

echo "Done!"
