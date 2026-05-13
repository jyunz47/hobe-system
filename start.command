#!/bin/bash
cd "$(dirname "$0")"
lsof -ti :8080 | xargs kill -9 2>/dev/null
echo "伺服器啟動中..."
python3 -m http.server 8080 &
sleep 2
/usr/bin/open "http://localhost:8080/%E8%A3%9C%E7%BF%92%E7%8F%AD%E6%8E%92%E7%A8%8B%E7%B3%BB%E7%B5%B1.html"
echo "已開啟瀏覽器 — 按 Ctrl+C 可關閉伺服器"
wait
