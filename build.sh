#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

github_repo_url() {
  if [ -n "${GITHUB_REPOSITORY:-}" ]; then
    printf 'https://github.com/%s\n' "$GITHUB_REPOSITORY"
    return
  fi

  local remote_url=""
  remote_url="$(git -C "$PWD" remote get-url origin 2>/dev/null || true)"

  if [[ "$remote_url" =~ ^git@github\.com:(.+)\.git$ ]]; then
    printf 'https://github.com/%s\n' "${BASH_REMATCH[1]}"
  elif [[ "$remote_url" =~ ^https://github\.com/(.+)\.git$ ]]; then
    printf 'https://github.com/%s\n' "${BASH_REMATCH[1]}"
  elif [[ "$remote_url" =~ ^https://github\.com/.+ ]]; then
    printf '%s\n' "$remote_url"
  else
    printf 'https://github.com/wendyliga/exif-cleaner\n'
  fi
}

if [ ! -d node_modules ]; then
  echo "node_modules not found - installing dependencies..."
  npm install
fi

build_commit="$(git -C "$PWD" rev-parse HEAD 2>/dev/null || true)"
build_commit_short="$(git -C "$PWD" rev-parse --short=12 HEAD 2>/dev/null || true)"
build_repo_url="$(github_repo_url)"

echo "Building static site into ./dist ..."
VITE_GITHUB_REPO_URL="$build_repo_url" \
VITE_BUILD_COMMIT="$build_commit" \
VITE_BUILD_COMMIT_SHORT="$build_commit_short" \
  npm run build:site -- "$@"

echo ""
echo "Done. Static output in ./dist:"
ls -1 dist
