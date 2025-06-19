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

# Check if gh is installed for GitHub releases
if ! command_exists gh; then
  echo "Warning: GitHub CLI (gh) is not installed. We'll skip the automatic release creation."
  echo "Install it using:"
  echo "  brew install gh (macOS)"
  echo "  https://github.com/cli/cli#installation (other platforms)"
  HAS_GH=false
else
  # Check if gh is authenticated
  if ! gh auth status >/dev/null 2>&1; then
    echo "Warning: GitHub CLI (gh) is not authenticated. We'll skip the automatic release creation."
    echo "Authenticate using:"
    echo "  gh auth login"
    HAS_GH=false
  else
    HAS_GH=true
  fi
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

# Create GitHub release if gh is available
if [ "$HAS_GH" = true ]; then
  echo "🎉 Creating GitHub release $VERSION"
  gh release create "$VERSION" \
    --title "Similar Notes $VERSION" \
    --notes "Release of version $VERSION. See the changelog for details."
  
  echo "✅ Release created successfully: https://github.com/joybro/obsidian-similar-notes/releases/tag/$VERSION"
else
  echo "ℹ️  Skipping GitHub release creation."
  echo "✅ Tag created and pushed. Please create the release manually on GitHub:"
  echo "    https://github.com/joybro/obsidian-similar-notes/releases/new?tag=$VERSION"
fi

echo "Done! 🎊"
