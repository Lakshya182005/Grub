#!/usr/bin/env bash
set -euo pipefail

# scripts/create-desktop-shortcut.sh — Creates double-clickable Desktop launchers

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DESKTOP_DIR="${HOME}/Desktop"

# 1. Double-clickable .command file
COMMAND_FILE="${DESKTOP_DIR}/Launch Hey Scribe.command"
cat << EOF > "${COMMAND_FILE}"
#!/bin/zsh
cd "${ROOT_DIR}"
pnpm dev
EOF
chmod +x "${COMMAND_FILE}"

# 2. Native macOS .app bundle on Desktop
APP_PATH="${DESKTOP_DIR}/Hey Scribe.app"
rm -rf "${APP_PATH}"
osacompile -o "${APP_PATH}" -e "do shell script \"/bin/zsh -lc 'cd \\\"${ROOT_DIR}\\\" && pnpm dev' > /dev/null 2>&1 &\""

echo "Desktop launchers created successfully:"
echo "  • ${APP_PATH}"
echo "  • ${COMMAND_FILE}"
