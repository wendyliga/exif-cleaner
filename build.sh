#!/bin/bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$DIR/dist"

echo "Creating dist directory..."
mkdir -p "$DIST_DIR"

echo "Copying files to dist..."
cp "$DIR/index.html" "$DIST_DIR/"
cp "$DIR/favicon.svg" "$DIST_DIR/"

echo "Build complete: $DIST_DIR"
