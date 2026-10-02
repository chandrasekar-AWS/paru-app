#!/usr/bin/env bash
# Paru on Arch Linux (and Manjaro/EndeavourOS): installs what it needs, then adds Paru to your app menu.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "==> Installing system packages (nodejs, npm, python, espeak-ng as an offline voice backup)"
sudo pacman -S --needed --noconfirm nodejs npm python espeak-ng
echo "==> Installing Paru's app files"
npm install --no-audit --no-fund
node node_modules/electron/install.js
APP="$(pwd)"
mkdir -p "$HOME/.local/share/applications" "$HOME/.local/share/icons"
cp build/icon.png "$HOME/.local/share/icons/paru.png"
cat > "$HOME/.local/share/applications/paru.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=Paru
Comment=Voice assistant
Exec=$APP/node_modules/.bin/electron $APP
Icon=$HOME/.local/share/icons/paru.png
Terminal=false
Categories=Utility;
DESK
echo "==> Done. Start Paru from your app menu, or run:  npm start"
echo "    The first start sets up Paru's Python engine and downloads the offline wake-word model (about 100 MB)."
echo "    On Wayland the global Ctrl+Shift+Space key may not work: use the tray icon or say 'hello Paru'."
