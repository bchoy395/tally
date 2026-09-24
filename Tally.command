#!/bin/bash
# Double-click to start Tally. It opens in your browser; close this window to stop it.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null; then
  echo "Tally needs Node.js 22.13 or newer: https://nodejs.org (or: brew install node)"
  read -r -p "Press Return to close."
  exit 1
fi
exec node --disable-warning=ExperimentalWarning server.js "$@"
