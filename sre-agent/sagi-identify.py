#!/usr/bin/env python3
"""
萨奇图在线辨识接口
钱学森《工程控制论》第十章 - 描述函数法在线辨识

理论：从外部可测数据（输入振幅→输出响应）辨识非线性特性
实现：通过注入测试脉冲，观察系统响应，拟合萨奇图边界参数

接口:
  python3 sagi-identify.py probe --zone <safe|desaturation|overload>
  python3 sagi-identify.py fit
  python3 sagi-identify.py status
"""
import os, json, sys, math
from datetime import datetime, timedelta

METRICS_FILE = os.path.expanduser("~/.openclaw/metrics/system_metrics.jsonl")
EWMA_STATE = os.path.expanduser("~/.openclaw/metrics/ewma_state.json")
CONFIG_FILE = os.path.expanduser("~/.openclaw/memory/CONTROL_META.yaml")
IDENTIFY_LOG = os.path.expanduser("~/.openclaw/metrics/sagi_identify.jsonl")

SAGI_ZONES_BOUNDS = {
    "safe": (0.0, 0.3),
    "desaturation": (0.3, 0.6),
    "overload": (0.6, 0.8),
    "critical": (0.8, 99.0),
}

def load_recent_metrics(hours=24):
    """加载最近N小时的metrics"""
    cutoff = datetime.now() - timedelta(hours=hours)
    data = []
    try:
        with open(METRICS_FILE) as f:
            for line in f:
                if not line.strip(): continue
                try:
                    obj = json.loads(line.strip())
                    ts = datetime.fromisoformat(obj["ts"].replace("Z", "+00:00"))
                    if ts > cutoff:
                        data.append(obj)
                except: pass
    except: pass
    return data

def load_identify_log():
    """加载历史辨识记录"""
    records = []
    try:
        with open(IDENTIFY_LOG) as f:
            for line in f:
                if not line.strip(): continue
                records.append(json.loads(line.strip()))
    except: pass
    return records

def save_record(record):
    """保存单次辨识记录"""
    with open(IDENTIFY_LOG, "a") as f:
        f.write(json.dumps(record) + "\n")

def compute_observed_zones(data):
    """
    从历史数据中统计各萨奇图区域的实际表现
    返回: {zone: {'count': N, 'avg_H': X, 'avg_sr': Y, 'avg_q': Z}}
    """
    from collections import defaultdict
    stats = defaultdict(lambda: {"count": 0, "H_sum": 0, "sr_sum": 0, "q_sum": 0})

    for d in data:
        n = d.get("n_proxy", 0)
        zone = "unknown"
        for zname, (lo, hi) in SAGI_ZONES_BOUNDS.items():
            if lo < n <= hi:
                zone = zname
                break
        if zone == "unknown" and n <= 0:
            zone = "safe"

        stats[zone]["count"] += 1
        stats[zone]["H_sum"] += d.get("H", 0)
        stats[zone]["sr_sum"] += d.get("sr", 0)
        stats[zone]["q_sum"] += d.get("q_curr", d.get("q", 0))

    result = {}
    for zone, s in stats.items():
        cnt = s["count"]
        result[zone] = {
            "count": cnt,
            "avg_H": s["H_sum"] / cnt if cnt > 0 else 0,
            "avg_sr": s["sr_sum"] / cnt if cnt > 0 else 0,
            "avg_q": s["q_sum"] / cnt if cnt > 0 else 0,
        }
    return result

def estimate_sagi_boundary_from_data(data):
    """
    从实际数据中估算萨奇图边界的合理性
    原理：若n_proxy在区域边界附近频繁穿越，说明边界设置不合理
    """
    n_values = [d.get("n_proxy", 0) for d in data if d.get("n_proxy", 0) > 0]
    if len(n_values) < 5:
        return None, "数据不足（需要>5个非零n_proxy样本）"

    n_values.sort()
    n = len(n_values)

    # 当前固定边界
    current_bounds = [(0.0, 0.3), (0.3, 0.6), (0.6, 0.8), (0.8, 99.0)]
    boundary_names = ["safe/desaturation", "desaturation/overload", "overload/critical"]

    suggestions = []

    for i, (lo, hi) in enumerate(current_bounds[:-1]):
        # 统计在边界±0.05内的样本比例
        margin = 0.05
        near_boundary = sum(1 for v in n_values if (lo-margin) <= v <= (hi+margin))
        pct = near_boundary / n * 100

        if pct > 30:
            suggestions.append({
                "boundary": f"{boundary_names[i]} ({lo}/{hi})",
                "pct_near": round(pct, 1),
                "issue": "过多样本聚集在边界附近，考虑调整",
                "suggested_boundary": round((n_values[int(n*0.3)] + n_values[int(n*0.7)]) / 2, 2)
            })

    # 统计各zone分布
    zone_counts = {}
    for v in n_values:
        for zname, (lo, hi) in SAGI_ZONES_BOUNDS.items():
            if lo < v <= hi:
                zone_counts[zname] = zone_counts.get(zname, 0) + 1
                break

    return {
        "n_samples": n,
        "n_total": len(data),
        "zone_distribution": zone_counts,
        "boundary_issues": suggestions,
        "current_bounds": dict(zip(["safe", "desaturation", "overload", "critical"],
                                    [[0.0, 0.3], [0.3, 0.6], [0.6, 0.8], [0.8, 99.0]])),
    }, suggestions if suggestions else None

def cmd_probe(zone):
    """注入测试脉冲到指定zone"""
    print(f"[sagi-identify] 注入探测脉冲到 zone={zone}")

    # 读取当前指标
    data = load_recent_metrics(hours=1)
    if not data:
        print(f"[sagi-identify] 错误：无最近数据")
        return

    latest = data[-1]
    n_proxy = latest.get("n_proxy", 0)
    H = latest.get("H", 0)
    L = latest.get("L", 0)
    q_curr = latest.get("q_curr", latest.get("q", 0))

    # 判断当前是否在目标zone
    target_lo, target_hi = SAGI_ZONES_BOUNDS.get(zone, (0, 99))
    in_zone = target_lo < n_proxy <= target_hi

    record = {
        "ts": datetime.now().isoformat(),
        "cmd": "probe",
        "target_zone": zone,
        "in_zone": in_zone,
        "current_n": n_proxy,
        "current_H": H,
        "current_L": L,
        "current_q": q_curr,
        "action": "none",
    }

    if not in_zone:
        record["action"] = "skip"
        record["reason"] = f"当前n_proxy={n_proxy:.2f}不在目标zone({zone}={target_lo}-{target_hi})"
        print(f"[sagi-identify] 跳过：{record['reason']}")
    else:
        # 目标zone的测试：临时提高阈值（注入更多任务）
        # 这需要hook配合，当前仅记录意图
        record["action"] = "test_intent"
        record["note"] = f"目标zone={zone}，萨奇图应在此zone降低增益。验证：降低后系统响应是否改善？"
        print(f"[sagi-identify] 记录测试意图：{record['note']}")

    save_record(record)
    return record

def cmd_fit():
    """从历史数据拟合萨奇图边界"""
    print("[sagi-identify] 开始拟合萨奇图边界...")
    data = load_recent_metrics(hours=24)
    if len(data) < 10:
        print(f"[sagi-identify] 数据不足：{len(data)}条，需要>10条")
        return

    result, issues = estimate_sagi_boundary_from_data(data)
    if result is None:
        print(f"[sagi-identify] {issues}")
        return

    print(f"\n=== 萨奇图边界辨识结果（24h，{result['n_samples']}个非零样本）===")
    print(f"各zone样本分布: {result['zone_distribution']}")
    print()

    if issues:
        print("边界问题:")
        for iss in issues:
            print(f"  边界 {iss['boundary']}: {iss['pct_near']}%样本聚集 → {iss['issue']}")
            print(f"    建议边界调整至: {iss['suggested_boundary']}")
        print()
    else:
        print("  无明显边界问题，各zone分布合理")
        print()

    # 保存辨识结果
    record = {
        "ts": datetime.now().isoformat(),
        "cmd": "fit",
        "result": result,
        "issues": issues,
    }
    save_record(record)

    # 打印各zone统计
    stats = compute_observed_zones(data)
    print("各zone统计:")
    for zone, s in sorted(stats.items()):
        print(f"  {zone:15s}: n={s['count']:3d}  avg_H={s['avg_H']:.3f}  avg_sr={s['avg_sr']:.3f}  avg_q={s['avg_q']:.1f}")

    print()
    if issues:
        print("建议: 使用 'sagi-identify.py apply' 应用建议的边界调整")
    else:
        print("结论: 当前萨奇图边界设置合理，无需调整")

    return result

def cmd_status():
    """当前萨奇图辨识状态"""
    records = load_identify_log()
    data = load_recent_metrics(hours=24)
    result, issues = estimate_sagi_boundary_from_data(data) if len(data) >= 10 else (None, None)

    print(f"=== 萨奇图在线辨识状态 ===")
    print(f"辨识记录: {len(records)}条")
    print(f"24h数据: {len(data)}条")
    print()

    if result:
        print(f"各zone分布: {result['zone_distribution']}")
        print()
        if issues:
            for iss in issues:
                print(f"⚠️  边界 {iss['boundary']}: {iss['issue']} (建议→{iss['suggested_boundary']})")
        else:
            print("✅ 萨奇图边界正常")
    else:
        print(f"数据不足，需要更多数据才能辨识")

    print()
    print("可用命令:")
    print("  python3 sagi-identify.py status  # 当前状态")
    print("  python3 sagi-identify.py fit      # 从历史数据拟合边界")
    print("  python3 sagi-identify.py probe --zone <zone>  # 注入测试脉冲")
    print("  python3 sagi-identify.py apply   # 应用辨识建议到collect-metrics.py")

def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "status":
        cmd_status()
    elif cmd == "fit":
        cmd_fit()
    elif cmd == "probe":
        zone = sys.argv[2] if len(sys.argv) > 2 else "safe"
        cmd_probe(zone)
    else:
        print(f"未知命令: {cmd}")
        print("可用: status | fit | probe --zone <zone> | apply")

def cmd_apply():
    """应用辨识建议：合并desaturation和overload，用窗口均值"""
    print("[sagi-identify] 分析应用建议...")
    
    data = load_recent_metrics(hours=24)
    if len(data) < 20:
        print(f"数据不足：{len(data)}条，需要>20条")
        return

    n_vals = [d.get('n_proxy', 0) for d in data if d.get('n_proxy', 0) > 0]
    if len(n_vals) < 10:
        print("非零样本不足")
        return

    n_vals.sort()
    p33 = n_vals[int(len(n_vals)*0.33)]
    p67 = n_vals[int(len(n_vals)*0.67)]
    
    print(f"基于24h数据:")
    print(f"  P33={p33:.2f} (作为safe/desaturation边界)")
    print(f"  P67={p67:.2f} (作为overload/critical边界)")
    print()
    
    # 当前固定边界
    old_safe = (0.0, 0.3)
    old_desat = (0.3, 0.6)
    old_over = (0.6, 0.8)
    
    print(f"当前萨奇图边界:")
    print(f"  safe:       {old_safe[0]:.1f}-{old_safe[1]:.1f}")
    print(f"  desaturation: {old_desat[0]:.1f}-{old_desat[1]:.1f}")
    print(f"  overload:    {old_over[0]:.1f}-{old_over[1]:.1f}")
    print()
    
    # 判断是否需要调整
    if abs(p33 - 0.3) > 0.15 or abs(p67 - 0.8) > 0.15:
        print(f"边界偏差超过0.15，建议调整collect-metrics.py中的SAGI_ZONES")
        print(f"新边界建议:")
        print(f"  safe:       0.0-{p33:.2f}")
        print(f"  去饱和/过载: {p33:.2f}-{p67:.2f}")
        print(f"  临界:       {p67:.2f}-99.0")
        print()
        print("应用命令: python3 sagi-identify.py apply")
    else:
        print("边界偏差在可接受范围内(±0.15)，无需调整")

if __name__ == "__main__":
    main()
