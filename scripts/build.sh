#!/bin/bash
# Build facebook-toolkit frontend
# Usage: ./scripts/build.sh [--no-minify]
#
# Steps:
# 1. Assemble index.html from template + components
# 2. Minify JS modules with esbuild
# 3. Minify CSS with esbuild
#
# Use --no-minify to skip minification (dev builds)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
TEMPLATE="$ROOT_DIR/public/index.template.html"
COMPONENTS_DIR="$ROOT_DIR/public/components"
OUTPUT="$ROOT_DIR/public/index.html"
JS_DIR="$ROOT_DIR/public/js"
CSS_DIR="$ROOT_DIR/public/css"
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

# --- Step 2: Minify JS ---
if [ "$NO_MINIFY" = false ] && command -v npx &>/dev/null; then
  JS_TOTAL=0
  JS_MIN=0
  for jsfile in "$JS_DIR"/*.js; do
    [ -f "$jsfile" ] || continue
    ORIG_SIZE=$(wc -c < "$jsfile" | tr -d ' ')
    JS_TOTAL=$((JS_TOTAL + ORIG_SIZE))
    npx esbuild "$jsfile" --minify --outfile="$jsfile" --allow-overwrite 2>/dev/null
    MIN_SIZE=$(wc -c < "$jsfile" | tr -d ' ')
    JS_MIN=$((JS_MIN + MIN_SIZE))
  done
  if [ $JS_TOTAL -gt 0 ]; then
    SAVED=$(( (JS_TOTAL - JS_MIN) * 100 / JS_TOTAL ))
    echo "JS:   $(echo $JS_TOTAL | awk '{printf "%.1fKB", $1/1024}') → $(echo $JS_MIN | awk '{printf "%.1fKB", $1/1024}') (-${SAVED}%)"
  fi

  # --- Step 3: Minify CSS ---
  CSS_TOTAL=0
  CSS_MIN=0
  for cssfile in "$CSS_DIR"/*.css; do
    [ -f "$cssfile" ] || continue
    ORIG_SIZE=$(wc -c < "$cssfile" | tr -d ' ')
    CSS_TOTAL=$((CSS_TOTAL + ORIG_SIZE))
    npx esbuild "$cssfile" --minify --outfile="$cssfile" --allow-overwrite 2>/dev/null
    MIN_SIZE=$(wc -c < "$cssfile" | tr -d ' ')
    CSS_MIN=$((CSS_MIN + MIN_SIZE))
  done
  if [ $CSS_TOTAL -gt 0 ]; then
    SAVED=$(( (CSS_TOTAL - CSS_MIN) * 100 / CSS_TOTAL ))
    echo "CSS:  $(echo $CSS_TOTAL | awk '{printf "%.1fKB", $1/1024}') → $(echo $CSS_MIN | awk '{printf "%.1fKB", $1/1024}') (-${SAVED}%)"
  fi
else
  if [ "$NO_MINIFY" = true ]; then
    echo "Minify: skipped (--no-minify)"
  else
    echo "Minify: skipped (npx not found)"
  fi
fi

echo "Done!"
