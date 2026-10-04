#!/usr/bin/env bash
pkill -f "agent.server" 2>/dev/null; sleep 1
cd "$(dirname "$0")/electron"
PARU_PYTHON="$HOME/.paru/venv/bin/python" exec electron .
