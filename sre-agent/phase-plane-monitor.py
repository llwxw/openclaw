#!/usr/bin/env python3
"""
SRE Agent 相平面状态监控脚本
每小时运行：分析最近状态+趋势，输出诊断报告
"""
import os, json, yaml, math
from datetime import datetime, timedelta

METRICS_FILE = os.path.expanduser("~/.openclaw/metrics/system_metrics.jsonl")
CONFIG_FILE = os.path.expanduser("~/.openclaw/memory/CONTROL_META.yaml")
AUDIT_FILE = os.path.expanduser("~/.openclaw/metrics/decision_audit.jsonl")
REPORT_FILE = os.path.expanduser("~/.openclaw/metrics/sre-report.jsonl")

def load_config():
    try:
        with open(CONFIG_FILE) as f:
            return yaml.safe_load(f)
    except:
        return {}

def classify_from_data(H, L):
    if H > 0.7 and L < 0.5: return "stable"
    if H < 0.5: return "warning"
    if L > 0.7 and H > 0.6: return "overload"
    if H < 0.4 and L > 0.8: return "diverging"
    return "drifting"

def trajectory_direction(data_points):
    """计算相平面轨迹方向"""
    if len(data_points) < 3:
        return None, None, None
    d0, d1, d2 = data_points[-3], data_points[-2], data_points[-1]
    H0, H2 = d0.get('H', 0) or 0, d2.get('H', 0) or 0
    L0, L2 = d0.get('L', 0) or 0, d2.get('L', 0) or 0
    dH = H2 - H0
    dL = L2 - L0
    angle = math.atan2(dL, dH) * 180 / math.pi if (dH or dL) else 0
    speed = math.sqrt(dH**2 + dL**2) / 2
    return angle, speed, (dH, dL)

def drift_detect(data, window=12):
    """漂移态检测：在最近window个点中各指标变化率的符号"""
    if len(data) < window:
        return False
    recent = data[-window:]
    H_vals = [d.get('H', 0.5) or 0.5 for d in recent]
    L_vals = [d.get('L', 0) or 0 for d in recent]
    
    # 线性趋势检验（简化版：比较首尾均值差异）
    H_trend = sum(H_vals[-3:])/3 - sum(H_vals[:3])/3
    L_trend = sum(L_vals[-3:])/3 - sum(L_vals[:3])/3
    
    # 漂移条件：趋势存在但缓慢（不触发其他告警）
    drift_speed = 0.005  # 每周期0.5%的缓慢变化
    is_drifting = abs(H_trend) > drift_speed or abs(L_trend) > drift_speed
    is_explicit = any([
        recent[-1].get('region') in ('warning', 'overload', 'diverging')
    ])
    return is_drifting and not is_explicit

def main():
    config = load_config()
    
    # 读取最近24小时数据
    cutoff = datetime.now() - timedelta(hours=24)
    data = []
    try:
        with open(METRICS_FILE) as f:
            for line in f:
                if not line.strip(): continue
                try:
                    obj = json.loads(line.strip())
                    ts = datetime.fromisoformat(obj['ts'].replace('Z', '+00:00'))
                    if ts > cutoff:
                        data.append(obj)
                except:
                    continue
    except:
        pass

    if len(data) < 2:
        print("[sre-monitor] 数据不足")
        return

    latest = data[-1]
    region = latest.get('region', 'unknown')
    H = latest.get('H', 0.5) or 0.5
    L = latest.get('L', 0) or 0
    n_proxy = latest.get('n_proxy', 0) or 0
    q = latest.get('q', 0)
    sr = latest.get('sr', 0)

    angle, speed, vec = trajectory_direction(data)
    is_drifting = drift_detect(data)
    current_mode = config.get("current_mode", "normal")

    # 生成报告
    report = {
        "ts": datetime.now().isoformat(),
        "region": region,
        "H": round(H, 4),
        "L": round(L, 4),
        "n_proxy": round(n_proxy, 2),
        "q": q,
        "sr": round(sr, 4),
        "mode": current_mode,
        "is_drifting": is_drifting,
        "trajectory_angle": round(angle, 1) if angle else None,
        "trajectory_speed": round(speed, 4) if speed else None,
        "data_points": len(data),
    }

    # 状态机决策
    recommendations = []
    if region == "overload" and n_proxy > 0.7:
        recommendations.append("萨奇图降增益已触发（如ewma-detector未处理）")
    if region == "warning":
        recommendations.append("深度巡检：分析sr和q的根因")
    if is_drifting:
        recommendations.append("漂移态：提高采样频率，跟踪变化率")
    if region == "stable" and angle and (45 <= abs(angle) < 180):
        recommendations.append("稳定区轨迹偏移预警：检查H下降原因")
    if current_mode == "launch":
        recommendations.append("发射段模式运行中：等待系统稳定退出")
    if not recommendations:
        recommendations.append("系统正常：保持监控")

    report["recommendations"] = recommendations

    # 写入报告
    with open(REPORT_FILE, "a") as f:
        f.write(json.dumps(report) + "\n")

    # 打印摘要
    print(f"[SRE Monitor] {report['ts']}")
    print(f"  区域: {region} | H={H:.3f} L={L:.3f} | n_proxy={n_proxy:.2f} | q={q} sr={sr:.3f}")
    if angle is not None:
        print(f"  轨迹: 角度{angle:.1f}° 速度={speed:.4f}/周期")
    print(f"  控制模式: {current_mode}")
    print(f"  漂移态: {'是' if is_drifting else '否'}")
    print(f"  建议: {'; '.join(recommendations)}")

    # 审计日志
    with open(AUDIT_FILE, "a") as f:
        f.write(json.dumps({
            "ts": datetime.now().isoformat(),
            "action": "sre_monitor",
            "region": region,
            "H": round(H, 3),
            "L": round(L, 3),
            "n_proxy": round(n_proxy, 2),
            "is_drifting": is_drifting,
            "recommendations": recommendations,
        }) + "\n")

if __name__ == '__main__':
    main()
