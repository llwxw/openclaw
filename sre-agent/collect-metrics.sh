#!/bin/bash
METRICS_FILE="$HOME/.openclaw/metrics/system_metrics.jsonl"
EPHEMERAL_DIR="$HOME/.openclaw/workspace/memory/ephemeral"
CONFIG_FILE="$HOME/.openclaw/memory/CONTROL_META.yaml"
CLEANUP_SCRIPT="$HOME/.openclaw/sre-agent/cleanup-metrics.py"
METRICS_DIR="$HOME/.openclaw/metrics"

mkdir -p "$METRICS_DIR"

today=$(date +%Y-%m-%d)
yesterday=$(date -d yesterday +%Y-%m-%d)
queue_length=$(cat "$EPHEMERAL_DIR"/{2026-$yesterday*,2026-$today*}.jsonl 2>/dev/null | wc -l | tr -d ' ')
current_concurrent=$(cat "$EPHEMERAL_DIR"/2026-$today*.jsonl 2>/dev/null | grep -c '_spawned.:true' 2>/dev/null | tr -d ' ' || echo 0)

recent_hour=$(date +%Y-%m-%d-%H)
recent_file="$EPHEMERAL_DIR/$recent_hour.jsonl"
success_rate="null"
avg_latency="null"

if [ -f "$recent_file" ]; then
    total_entries=$(wc -l < "$recent_file" 2>/dev/null | tr -d ' ' || echo 0)
    if [ "$total_entries" -gt 0 ]; then
        scored_entries=$(grep -c '"score":[1-9]' "$recent_file" 2>/dev/null | tr -d ' ' || echo 0)
        success_rate=$(echo "scale=4; $scored_entries * 10 / $total_entries / 10" | bc 2>/dev/null || echo "null")
    fi
fi

if [ -f "$CONFIG_FILE" ]; then
    max_concurrent=$(grep "MAX_CONCURRENT" "$CONFIG_FILE" | grep "current:" | awk '{print $2}' || echo 5)
    current_mode=$(grep "current_mode:" "$CONFIG_FILE" | awk '{print $2}' || echo "normal")
    spawn_on=$(grep "SPAWN_ON" "$CONFIG_FILE" | grep "current:" | awk '{print $2}' || echo 45)
    spawn_off=$(grep "SPAWN_OFF" "$CONFIG_FILE" | grep "current:" | awk '{print $2}' || echo 38)
else
    max_concurrent=5; current_mode="unknown"; spawn_on=45; spawn_off=38
fi

if [ -n "$max_concurrent" ] && [ "$max_concurrent" -gt 0 ] && [ -n "$queue_length" ] && [ "$queue_length" -gt 0 ]; then
    n=$(echo "scale=4; $queue_length / $max_concurrent" | bc 2>/dev/null || echo "null")
else
    n="null"
fi

if [ "$success_rate" = "null" ] || [ -z "$success_rate" ]; then
    region="unknown"
else
    H=$(echo "scale=4; 0.6 * $success_rate + 0.4" | bc 2>/dev/null || echo "0.5")
    L=$(echo "scale=4; $queue_length / 50" | bc 2>/dev/null || echo "0")
    cond_H_high=$(echo "$H > 0.7" | bc 2>/dev/null)
    cond_L_low=$(echo "$L < 0.5" | bc 2>/dev/null)
    cond_H_low=$(echo "$H < 0.5" | bc 2>/dev/null)
    cond_L_high=$(echo "$L > 0.7" | bc 2>/dev/null)
    cond_H_ok=$(echo "$H > 0.6" | bc 2>/dev/null)
    cond_H_very_low=$(echo "$H < 0.4" | bc 2>/dev/null)
    cond_L_very_high=$(echo "$L > 0.8" | bc 2>/dev/null)
    if [ "$cond_H_high" = "1" ] && [ "$cond_L_low" = "1" ]; then
        region="stable"
    elif [ "$cond_H_low" = "1" ]; then
        region="warning"
    elif [ "$cond_L_high" = "1" ] && [ "$cond_H_ok" = "1" ]; then
        region="overload"
    elif [ "$cond_H_very_low" = "1" ] && [ "$cond_L_very_high" = "1" ]; then
        region="diverging"
    else
        region="drifting"
    fi
fi

ts=$(date -Iseconds)
python3 - "$METRICS_FILE" "$ts" "$queue_length" "$current_concurrent" "$success_rate" "$avg_latency" "$n"     "$max_concurrent" "$current_mode" "$region" "$spawn_on" "$spawn_off" << 'PYEOF2'
import sys, json
jsonl_path = sys.argv[1]
ts = sys.argv[2]
q = sys.argv[3].strip()
c = sys.argv[4].strip()
sr = sys.argv[5].strip()
lt = sys.argv[6].strip()
n = sys.argv[7].strip()
max_c = sys.argv[8].strip()
mode = sys.argv[9].strip()
region = sys.argv[10].strip()
spawn_on = sys.argv[11].strip()
spawn_off = sys.argv[12].strip()

def to_float(s):
    try: return float(s)
    except: return None
def to_int(s):
    try: return int(s)
    except: return None

obj = {
    "ts": ts,
    "q": to_int(q) if q != "null" else None,
    "c": to_int(c) if c != "null" else None,
    "sr": to_float(sr) if sr != "null" else None,
    "lt": to_float(lt) if lt != "null" else None,
    "n": to_float(n) if n != "null" else None,
    "max_c": max_c,
    "mode": mode,
    "region": region,
    "spawn_on": spawn_on,
    "spawn_off": spawn_off,
}

with open(jsonl_path, "a") as f:
    f.write(json.dumps(obj) + "\n")
PYEOF2

python3 "$CLEANUP_SCRIPT" "$METRICS_FILE"
echo "[collect] ts=$ts q=$queue_length sr=$success_rate n=$n region=$region"
