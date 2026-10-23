#!/usr/bin/env bash
set -euo pipefail

# scripts/gen-sounds.sh — Copy system sound effects into assets/

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ASSETS_DIR="${ROOT_DIR}/assets"

mkdir -p "${ASSETS_DIR}"

echo "Copying system sounds to ${ASSETS_DIR}..."
cp /System/Library/Sounds/Tink.aiff "${ASSETS_DIR}/Tink.aiff"
cp /System/Library/Sounds/Pop.aiff "${ASSETS_DIR}/Pop.aiff"

echo "Done:"
ls -la "${ASSETS_DIR}"
