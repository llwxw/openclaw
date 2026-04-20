#!/bin/bash
# 告警脚本
# 用法: alert.sh "告警消息"

MSG="$1"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
LOG_FILE="/home/ai/.openclaw/metrics/alerts.log"

echo "[$TIMESTAMP] ALERT: $MSG" >> "$LOG_FILE"

# TODO: 实现实际告警（webhook/signal/email）
# 目前只记录日志

echo "[$TIMESTAMP] ALERT: $MSG"
