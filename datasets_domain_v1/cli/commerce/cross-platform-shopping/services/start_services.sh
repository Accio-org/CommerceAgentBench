#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

python3 "$SCRIPT_DIR/mock_server.py" &
SERVER_PID=$!

for i in $(seq 1 30); do
    if curl -s http://127.0.0.1:3000/health > /dev/null 2>&1; then
        echo "Mock shopping server started (PID=$SERVER_PID)"
        exit 0
    fi
    sleep 0.2
done

echo "ERROR: Server failed to start within 6 seconds" >&2
kill $SERVER_PID 2>/dev/null || true
exit 1
