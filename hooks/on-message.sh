#!/bin/bash
# OpenClaw Context Hook - HTTP 版本
# 将消息发送到保护层的 HTTP 服务

MESSAGE="${OPENCLAW_MESSAGE:-}"
USER="${OPENCLAW_SENDER:-unknown}"
CHANNEL="${OPENCLAW_CHANNEL:-unknown}"
SERVER_URL="http://127.0.0.1:3101"

if [ -n "$MESSAGE" ]; then
  # 发送到 Context API（openclaw-router）
  curl -s -X POST "${SERVER_URL}/api/context" \
    -H "Content-Type: application/json" \
    -d "{\"role\":\"user\",\"content\":\"$(echo "$MESSAGE" | jq -Rs .)\",\"user\":\"$USER\",\"channel\":\"$CHANNEL\"}" \
    > /dev/null 2>&1 || true
fi
