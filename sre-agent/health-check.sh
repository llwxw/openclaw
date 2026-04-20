#!/bin/bash
# SRE 健康检查脚本
# 检查 collect-metrics.py 是否正常运行
# 如发现异常，尝试重启或告警

METRICS_DIR="/home/ai/.openclaw/metrics"
EWMA_STATE="$METRICS_DIR/ewma_state.json"
LOG_FILE="$METRICS_DIR/health-check.log"
ALERT_SCRIPT="/home/ai/.openclaw/sre-agent/alert.sh"

check_ewma_state() {
    if [[ ! -f "$EWMA_STATE" ]]; then
        echo "[$(date)] ERROR: ewma_state.json not found" >> "$LOG_FILE"
        return 1
    fi
    
    # 检查最后修改时间（10分钟内）
    LAST_MOD=$(stat -c %Y "$EWMA_STATE" 2>/dev/null || stat -f %m "$EWMA_STATE" 2>/dev/null)
    NOW=$(date +%s)
    DIFF=$((NOW - LAST_MOD))
    
    if [[ $DIFF -gt 600 ]]; then
        echo "[$(date)] ERROR: ewma_state.json not updated for ${DIFF}s" >> "$LOG_FILE"
        return 1
    fi
    
    return 0
}

check_fuse_state() {
    FUSE_STATE="$METRICS_DIR/fuse_state.json"
    if [[ ! -f "$FUSE_STATE" ]]; then
        echo "[$(date)] WARNING: fuse_state.json not found" >> "$LOG_FILE"
        return 1
    fi
    return 0
}

check_recent_health() {
    # 读取最新指标
    METRIC=$(tail -1 "$METRICS_DIR/system_metrics.jsonl" 2>/dev/null)
    if [[ -z "$METRIC" ]]; then
        echo "[$(date)] ERROR: system_metrics.jsonl empty or not found" >> "$LOG_FILE"
        return 1
    fi
    
    # 检查 H 值（需要 > 0.3 才算勉强健康）
    H=$(echo "$METRIC" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('H', 0))" 2>/dev/null)
    if [[ -z "$H" ]] || (( $(echo "$H < 0.3" | bc -l 2>/dev/null || echo "0") )); then
        echo "[$(date)] CRITICAL: H=$H is too low" >> "$LOG_FILE"
        return 2
    fi
    
    return 0
}

main() {
    echo "[$(date)] Health check started" >> "$LOG_FILE"
    
    ERRORS=0
    
    check_ewma_state || ((ERRORS++))
    check_fuse_state || ((ERRORS++))
    check_recent_health || ((ERRORS++))
    
    if [[ $ERRORS -eq 0 ]]; then
        echo "[$(date)] Health check OK" >> "$LOG_FILE"
    elif [[ $ERRORS -eq 1 ]]; then
        echo "[$(date)] Health check WARNING: $ERRORS issue(s)" >> "$LOG_FILE"
    else
        echo "[$(date)] Health check CRITICAL: $ERRORS issue(s)" >> "$LOG_FILE"
        # 触发告警
        if [[ -x "$ALERT_SCRIPT" ]]; then
            bash "$ALERT_SCRIPT" "SRE健康检查失败: $ERRORS 个问题"
        fi
    fi
    
    return $ERRORS
}

main
