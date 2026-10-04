#!/usr/bin/env bash
cd "$(dirname "$0")/electron" && [ -d node_modules ] || npm install
PARU_PYTHON="${PARU_PYTHON:-$HOME/.paru/venv/bin/python}" exec npm start
