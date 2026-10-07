#!/bin/bash
# Double-click to start Tally (Mac), or run ./Tally.command (Linux/WSL). It opens in your browser; close this window to stop it.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
# Node installed with nvm is only on PATH in interactive shells.
if ! command -v node >/dev/null && [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
fi
if ! command -v node >/dev/null; then
  echo "Tally needs Node.js 22.13 or newer: https://nodejs.org (or: brew install node)"
  read -r -p "Press Return to close."
  exit 1
fi
exec node --disable-warning=ExperimentalWarning server.js "$@"
