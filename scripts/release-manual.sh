#!/bin/bash

# MANUAL FALLBACK — Normally releases are automated via semantic-release.
# Only use this if CI is broken and you need an emergency release.
# See CONTRIBUTING.md for the standard release process.

# Check if a version argument is provided
if [ -z "$1" ]; then
  echo "Usage: ./scripts/release-manual.sh <version>"
  echo "Example: ./scripts/release-manual.sh 0.3.0"
  exit 1
fi

NEW_VERSION=$1

# Update package.json and package-lock.json
npm version "$NEW_VERSION" --no-git-tag-version

# Update src-tauri/Cargo.toml, src-tauri/tauri.conf.json, and src-tauri/Cargo.lock
bash scripts/update-versions.sh "$NEW_VERSION"

echo "Updated version to $NEW_VERSION across package.json, package-lock.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, and src-tauri/Cargo.lock"

# Git operations
git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(release): v$NEW_VERSION"
git tag "v$NEW_VERSION"

echo "------------------------------------------------*******"
echo "Release v$NEW_VERSION staged and tagged."
echo "To trigger the GitHub Action build and release, run:"
echo ""
echo "    git push origin main --tags"
echo ""
echo "------------------------------------------------*******"
