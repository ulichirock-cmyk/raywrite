#!/usr/bin/env bash
# agentText 一键启动脚本
# 用法: ./start.sh [start|stop|restart|status]（默认 start）
# 环境变量: PORT=7777  NO_BROWSER=1（启动后不打开浏览器）
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

PORT="${PORT:-7777}"
URL="http://localhost:${PORT}"
PID_FILE="data/server.pid"
LOG_FILE="data/server.log"

mkdir -p data

# 非交互 shell（如从 Windows 快捷方式进来）可能没有 nvm 的 PATH
if ! command -v node >/dev/null 2>&1; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
fi
if ! command -v node >/dev/null 2>&1; then
  echo "找不到 node，请先安装 Node.js" >&2
  exit 1
fi

server_pid() {
  if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    cat "$PID_FILE"
    return 0
  fi
  # pid 文件失效时按端口找（覆盖手动 npm start 的情况）；无匹配不算错误
  ss -ltnp "sport = :${PORT}" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1 || true
}

is_running() {
  [[ -n "$(server_pid)" ]]
}

open_browser() {
  [[ "${NO_BROWSER:-0}" == "1" ]] && return 0
  if command -v wslview >/dev/null 2>&1; then
    wslview "$URL" >/dev/null 2>&1 &
  elif command -v explorer.exe >/dev/null 2>&1; then
    explorer.exe "$URL" >/dev/null 2>&1 &
  fi
  return 0
}

ensure_build() {
  if [[ ! -d node_modules ]]; then
    echo "首次运行：安装依赖…"
    npm install
  fi
  if [[ ! -f web/dist/index.html ]] ||
    [[ -n "$(find web/src web/index.html vite.config.js -newer web/dist/index.html -print -quit 2>/dev/null)" ]]; then
    echo "前端有更新：构建中…"
    npm run build
  fi
}

do_start() {
  if is_running; then
    echo "已在运行：$URL"
    open_browser
    return 0
  fi
  ensure_build
  nohup node server/index.mjs >"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  for _ in $(seq 1 50); do
    if curl -sf -o /dev/null "$URL/api/cards"; then
      echo "已启动：$URL"
      open_browser
      return 0
    fi
    sleep 0.1
  done
  echo "启动失败，最近日志（$LOG_FILE）：" >&2
  tail -20 "$LOG_FILE" >&2
  return 1
}

do_stop() {
  local pid
  pid="$(server_pid)"
  if [[ -n "$pid" ]]; then
    kill "$pid"
    echo "已停止（pid $pid）"
  else
    echo "未在运行"
  fi
  rm -f "$PID_FILE"
}

do_status() {
  local pid
  pid="$(server_pid)"
  if [[ -n "$pid" ]]; then
    echo "运行中（pid $pid）：$URL"
  else
    echo "未在运行"
    return 1
  fi
}

case "${1:-start}" in
start) do_start ;;
stop) do_stop ;;
restart)
  do_stop
  do_start
  ;;
status) do_status ;;
*)
  echo "用法: $0 [start|stop|restart|status]" >&2
  exit 2
  ;;
esac
