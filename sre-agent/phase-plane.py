#!/usr/bin/env python3
"""
相平面可视化脚本
读取 system_metrics.jsonl，输出CSV供gnuplot绘图
"""
import json, os, math, sys
from datetime import datetime, timedelta

METRICS_FILE = os.path.expanduser("~/.openclaw/metrics/system_metrics.jsonl")
OUTPUT_CSV = "/tmp/phase_plane.csv"

def fmt(v, fmt_str, default=0):
    return (fmt_str % v) if v is not None else str(default)

def main():
    hours = int(sys.argv[1]) if len(sys.argv) > 1 else 24
    cutoff = datetime.now() - timedelta(hours=hours)

    data = []
    try:
        with open(METRICS_FILE) as f:
            for line in f:
                if not line.strip(): continue
                try:
                    obj = json.loads(line.strip())
                    ts_str = obj.get("ts", "")
                    if not ts_str: continue
                    ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    if ts > cutoff:
                        data.append(obj)
                except: continue
    except FileNotFoundError:
        print(f"文件不存在: {METRICS_FILE}")
        return

    if len(data) < 2:
        print(f"数据点不足（需要>1个，可用{len(data)}个）")
        return

    # 输出CSV
    with open(OUTPUT_CSV, "w") as f:
        f.write("timestamp,q,scored,spawned_proxy,sr,n_proxy,H,L,region,threshold\n")
        for d in data:
            f.write("%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n" % (
                d.get("ts",""),
                d.get("q",0) or 0,
                d.get("scored",0) or 0,
                d.get("spawned_proxy",0) or 0,
                fmt(d.get("sr"), "%.4f"),
                fmt(d.get("n_proxy"), "%.2f"),
                fmt(d.get("H"), "%.4f"),
                fmt(d.get("L"), "%.4f"),
                d.get("region","unknown"),
                d.get("threshold",40)
            ))

    print(f"相平面数据: {OUTPUT_CSV} ({len(data)} 个数据点, 最近{hours}小时)")

    # 最新状态
    latest = data[-1]
    print(f"\n=== 当前状态 ({latest.get('ts','?')}) ===")
    print(f"  区域: {latest.get('region', 'unknown')}")
    print(f"  H={fmt(latest.get('H'), '%.3f')}  L={fmt(latest.get('L'), '%.3f')}")
    print(f"  q={latest.get('q', 0) or 0}  sr={fmt(latest.get('sr'), '%.3f')}")
    print(f"  n_proxy={fmt(latest.get('n_proxy'), '%.2f')}  阈值={latest.get('threshold', 40)}")

    # 轨迹方向
    if len(data) >= 3:
        d0, d1, d2 = data[-3], data[-2], data[-1]
        H0, H2 = d0.get('H') or 0, d2.get('H') or 0
        L0, L2 = d0.get('L') or 0, d2.get('L') or 0
        dH = H2 - H0
        dL = L2 - L0
        angle = math.atan2(dL, dH) * 180 / math.pi if (dH or dL) else 0
        speed = math.sqrt(dH**2 + dL**2) / 2
        print(f"\n=== 轨迹 ===")
        print(f"  ΔH={dH:+.4f}  ΔL={dL:+.4f}  角度={angle:.1f}°  速度={speed:.4f}/周期")

        if d2.get('region') == 'stable' and 45 <= (angle % 360) < 180:
            print(f"  ⚠️  预警: 稳定区但轨迹在远离原点")
        elif d2.get('region') == 'overload' and -45 < angle % 360 < 45:
            print(f"  ✅ 自愈趋势: 过载区但轨迹正在回归原点")

    # 统计
    regions = [d.get('region','unknown') for d in data]
    from collections import Counter
    rc = Counter(regions)
    avg_sr = sum(d.get('sr',0) or 0 for d in data) / len(data)
    max_q = max(d.get('q',0) or 0 for d in data)
    print(f"\n=== 统计（{hours}h）===")
    print(f"  区域分布: {dict(rc)}")
    print(f"  平均sr: {avg_sr:.3f}  最大q: {max_q}")

if __name__ == "__main__":
    main()
