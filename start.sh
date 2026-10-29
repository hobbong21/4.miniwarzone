#!/bin/sh
# 미니워존 서버 실행 (macOS · Linux) — 서버를 켜고 브라우저로 게임을 엽니다
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null || { echo "Node.js 22.5 이상이 필요합니다: https://nodejs.org"; exit 1; }
PORT="${PORT:-8080}"; export PORT
( sleep 1; command -v open >/dev/null && open "http://localhost:$PORT" || xdg-open "http://localhost:$PORT" ) >/dev/null 2>&1 &
exec node server/server.js
