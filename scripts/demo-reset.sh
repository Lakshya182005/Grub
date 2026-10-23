#!/usr/bin/env bash
set -euo pipefail

# scripts/demo-reset.sh — Reset demo state, backup vault, and print engine status

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

VAULT="${HOME}/Documents/Hey Scribe"
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP="${HOME}/Desktop/heyscribe-demo-backup-${TS}"

echo "=== Hey Scribe MVP: Demo Reset ==="

# 1. Backup and clear vault
if [ -d "${VAULT}" ]; then
    FILE_COUNT="$(find "${VAULT}" -maxdepth 1 -name "*.md" | wc -l | tr -d ' ')"
    if [ "${FILE_COUNT}" -gt 0 ]; then
        echo "[1/3] Backing up vault (${FILE_COUNT} notes) to ${BACKUP}..."
        mkdir -p "${BACKUP}"
        cp -R "${VAULT}/"* "${BACKUP}/" 2>/dev/null || true
        rm -rf "${VAULT}"
        mkdir -p "${VAULT}"
        echo "Vault cleared and reset."
    else
        echo "[1/3] Vault is already empty at ${VAULT}"
    fi
else
    echo "[1/3] Creating empty vault at ${VAULT}"
    mkdir -p "${VAULT}"
fi

# 2. Restart sidecar process if running
echo "[2/3] Checking sidecar process..."
if pgrep -f "python -m app.main" > /dev/null 2>&1; then
    echo "Stopping existing sidecar..."
    pkill -f "python -m app.main" || true
    sleep 1
    echo "Sidecar stopped. Electron or 'pnpm dev' will respawn it cleanly."
else
    echo "No standalone sidecar process running."
fi

# 3. Print engine health status
echo "[3/3] Checking engine status..."
echo "------------------------------------------------------------"

# Whisper
if curl -s "http://127.0.0.1:8787/inference" > /dev/null 2>&1; then
    echo "whisper-server:   ONLINE  (http://127.0.0.1:8787)"
else
    echo "whisper-server:   OFFLINE (run scripts/warm.sh)"
fi

# Ollama
if curl -s "http://127.0.0.1:11434/api/tags" > /dev/null 2>&1; then
    echo "ollama:           ONLINE  (http://127.0.0.1:11434)"
else
    echo "ollama:           OFFLINE (run scripts/warm.sh)"
fi

# Piper
PIPER_BIN="$(which piper || echo "")"
PIPER_MODEL="${HOME}/piper/en_US-lessac-medium.onnx"
if [ -n "${PIPER_BIN}" ] && [ -f "${PIPER_MODEL}" ]; then
    echo "piper:            READY   (${PIPER_BIN})"
else
    echo "piper:            MISSING"
fi

# Wake Model
WAKE_MODEL="${HOME}/models/openwakeword/hey_jarvis_v0.1.onnx"
if [ -f "${WAKE_MODEL}" ]; then
    echo "openWakeWord:     READY   (${WAKE_MODEL})"
else
    echo "openWakeWord:     MISSING"
fi

echo "------------------------------------------------------------"
echo "Demo reset completed successfully."
