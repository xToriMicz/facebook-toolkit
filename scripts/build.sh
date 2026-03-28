#!/bin/bash
# Build index.html from template + components
# Usage: ./scripts/build.sh
#
# Replaces <!-- @include filename.html --> with contents of public/components/filename.html
# Output: public/index.html

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
TEMPLATE="$ROOT_DIR/public/index.template.html"
COMPONENTS_DIR="$ROOT_DIR/public/components"
OUTPUT="$ROOT_DIR/public/index.html"

if [ ! -f "$TEMPLATE" ]; then
  echo "Error: Template not found at $TEMPLATE"
  exit 1
fi

# Build using sed to replace each @include with file content
cp "$TEMPLATE" "$OUTPUT"

for component in "$COMPONENTS_DIR"/*.html; do
  FILENAME=$(basename "$component")
  # Use sed with r command to insert file content after match, then delete the marker line
  sed -i '' "/@include ${FILENAME}/r ${component}
/@include ${FILENAME}/d" "$OUTPUT"
done

LINES=$(wc -l < "$OUTPUT" | tr -d ' ')
COMPONENTS=$(ls "$COMPONENTS_DIR"/*.html 2>/dev/null | wc -l | tr -d ' ')
echo "Built index.html ($LINES lines) from $COMPONENTS components"
