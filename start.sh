#!/data/data/com.termux/files/usr/bin/bash

set -e

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR"

exec node bot.js