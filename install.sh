#!/data/data/com.termux/files/usr/bin/bash

set -e

# Immer in den Ordner wechseln, in dem install.sh liegt
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Alte WhatsApp-Session automatisch löschen
if [ -d "session" ]; then
    echo
    echo "[X-COM] Alte WhatsApp-Session wird gelöscht..."
    rm -rf session
    echo "[X-COM] Session gelöscht."
fi

echo
echo "======================================"
echo "       X-COM BOT INSTALLER"
echo "======================================"
echo
echo "[X-COM] Ordner:"
echo "$SCRIPT_DIR"
echo

if [ ! -f bot.js ]; then
    echo "FEHLER: bot.js fehlt."
    exit 1
fi

echo "[1/4] Termux aktualisieren..."
pkg update -y

echo
echo "[2/4] Node.js installieren..."
pkg install nodejs-lts -y

echo
echo "[3/4] Node-Projekt vorbereiten..."

if [ ! -f package.json ]; then
    npm init -y
    npm pkg set type=module
fi

echo
echo "[4/4] Abhängigkeiten installieren..."

if [ -f package-lock.json ]; then
    npm ci
else
    npm install \
        @whiskeysockets/baileys@latest \
        pino \
        @hapi/boom
fi

echo
echo "======================================"
echo "       INSTALLATION FERTIG"
echo "======================================"
echo
echo "Node:"
node --version
echo
echo "NPM:"
npm --version
echo
echo "Bot starten mit:"
echo "./start.sh"
echo