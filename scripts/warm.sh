#!/usr/bin/env bash
set -euo pipefail

# scripts/warm.sh — Start servers if needed, preload models into memory, and play ready chime.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

WHISPER_PORT="8787"
WHISPER_MODEL="${HOME}/models/ggml-base.en.bin"
OLLAMA_MODEL="${1:-qwen2.5:3b-instruct}"

# Fall back to llama3.2:3b if requested model is not in ollama list
if ! ollama list 2>/dev/null | grep -q "${OLLAMA_MODEL}"; then
    if ollama list 2>/dev/null | grep -q "llama3.2:3b"; then
        echo "Model ${OLLAMA_MODEL} not found, falling back to llama3.2:3b"
        OLLAMA_MODEL="llama3.2:3b"
    fi
fi

echo "=== Hey Scribe MVP: Warmup ==="

# 1. Check / start whisper-server
echo "[1/4] Checking whisper-server on port ${WHISPER_PORT}..."
if ! curl -s "http://127.0.0.1:${WHISPER_PORT}/inference" > /dev/null 2>&1; then
    echo "Starting whisper-server..."
    whisper-server -m "${WHISPER_MODEL}" --host 127.0.0.1 --port "${WHISPER_PORT}" -t 4 > /tmp/whisper-server.log 2>&1 &
    
    echo -n "Waiting for whisper-server..."
    for i in {1..20}; do
        if curl -s "http://127.0.0.1:${WHISPER_PORT}/inference" > /dev/null 2>&1; then
            echo " ready!"
            break
        fi
        echo -n "."
        sleep 1
    done
else
    echo "whisper-server is already running."
fi

# 2. Check / start ollama serve
echo "[2/4] Checking Ollama on port 11434..."
if ! curl -s "http://127.0.0.1:11434/api/tags" > /dev/null 2>&1; then
    echo "Starting ollama serve..."
    ollama serve > /tmp/ollama.log 2>&1 &
    
    echo -n "Waiting for ollama serve..."
    for i in {1..20}; do
        if curl -s "http://127.0.0.1:11434/api/tags" > /dev/null 2>&1; then
            echo " ready!"
            break
        fi
        echo -n "."
        sleep 1
    done
else
    echo "ollama serve is already running."
fi

# 3. Warm whisper model
echo "[3/4] Pre-loading whisper model on Metal GPU..."
if [ -f "${ROOT_DIR}/tests/fixtures/hello.wav" ]; then
    python3 "${ROOT_DIR}/scripts/spike_stt.py" --audio "${ROOT_DIR}/tests/fixtures/hello.wav" > /dev/null
    echo "whisper model warm."
fi

# 4. Warm LLM model
echo "[4/4] Pre-loading LLM (${OLLAMA_MODEL}) into RAM..."
curl -s http://127.0.0.1:11434/api/chat -d "{
    \"model\": \"${OLLAMA_MODEL}\",
    \"keep_alive\": \"10m\",
    \"stream\": false,
    \"options\": {\"temperature\": 0, \"num_ctx\": 2048, \"num_predict\": 10},
    \"messages\": [{\"role\": \"user\", \"content\": \"warm\"}]
}" > /dev/null
echo "LLM (${OLLAMA_MODEL}) warm."

# Play ready chime
if [ -f "${ROOT_DIR}/assets/Tink.aiff" ]; then
    afplay "${ROOT_DIR}/assets/Tink.aiff" 2>/dev/null || true
fi

echo "=== All engines warm and ready ==="
