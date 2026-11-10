#!/bin/sh
# ARCNAVE v0.38 on Mac / Linux: sh start.sh   (needs Node.js 20 or newer from https://nodejs.org)
cd "$(dirname "$0")"
PORT=${PORT:-8083}
echo "Starting ARCNAVE on http://localhost:$PORT  (Ctrl+C to stop)"
( sleep 3; (command -v open >/dev/null && open "http://localhost:$PORT/") || (command -v xdg-open >/dev/null && xdg-open "http://localhost:$PORT/") ) >/dev/null 2>&1 &
PORT=$PORT node server.js
