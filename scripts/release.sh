#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

# Function to check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Check if jq is installed
if ! command_exists jq; then
  echo "Error: jq is required but not installed."
  echo "Install it using:"
  echo "  brew install jq (macOS)"
  echo "  apt-get install jq (Ubuntu/Debian)"
  exit 1
fi

# Get version from manifest.json
VERSION=$(jq -r '.version' manifest.json)

if [ -z "$VERSION" ]; then
  echo "Error: Failed to extract version from manifest.json"
  exit 1
fi

echo "📦 Preparing release for version $VERSION"

# Check if the version already exists as a tag
if git rev-parse "refs/tags/$VERSION" >/dev/null 2>&1; then
  echo "Error: Tag $VERSION already exists. Please update the version in manifest.json."
  exit 1
fi

# Create the git tag
echo "📌 Creating git tag $VERSION"
git tag -a "$VERSION" -m "$VERSION"

# Push the tag to GitHub
echo "🚀 Pushing tag $VERSION to GitHub"
git push origin "$VERSION"

echo "Done! 🎊"
