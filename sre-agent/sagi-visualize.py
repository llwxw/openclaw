#!/usr/bin/env python3
"""
萨奇图HTML可视化 - 无外部依赖，纯Python生成SVG
"""
import os, json, math, sys
from datetime import datetime, timedelta

METRICS_FILE = os.path.expanduser("~/.openclaw/metrics/system_metrics.jsonl")
EWMA_STATE = os.path.expanduser("~/.openclaw/metrics/ewma_state.json")
HTML_OUT = os.path.expanduser("~/.openclaw/metrics/sagi_chart.html")

# 颜色主题
COLORS = {
    "safe": "#4CAF50",         # 绿色
    "elevated": "#FF9800",     # 橙色
    "critical": "#9C27B0",     # 紫色
    "unknown": "#9E9E9E",
    "grid": "#E0E0E0",
    "bg": "#FAFAFA",
    "text": "#212121",
    "subtle": "#757575",
}

def generate_boundary_path():
    """生成萨奇图边界曲线路径 (1/A 双曲线, A in [0.05, 1.0])"""
    points = []
    for i in range(5, 101):
        A = round(i * 0.01, 4)
        gain = round(1.0 / A, 4) if A > 0 else 9999
        points.append((A, gain))
    return points

def get_zone(n_proxy):
    # 阈值与 collect-metrics.py 同步（n_proxy = q_curr/5）
    if n_proxy <= 0.5:   return "safe"
    elif n_proxy <= 0.8: return "elevated"
    else:                  return "critical"

def zone_color(zone):
    return COLORS.get(zone, COLORS["unknown"])

def load_metrics(hours=6):
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
                        data.append({
                            "ts": ts,
                            "n_proxy": obj.get("n_proxy", 0) or 0,
                            "H": obj.get("H", 0) or 0,
                            "L": obj.get("L", 0) or 0,
                            "q_curr": obj.get("q_curr", obj.get("q", 0)) or 0,
                            "q_total": obj.get("q_total", obj.get("q", 0)) or 0,
                            "sr": obj.get("sr", 0) or 0,
                            "region": obj.get("region", "unknown"),
                            "spawn_on": obj.get("spawn_on", 45),
                            "spawn_off": obj.get("spawn_off", 38),
                            "sagi_zone": obj.get("sagi_zone", "safe"),
                            "fuse_triggered": obj.get("fuse_triggered", False),
                        })
                except: continue
    except FileNotFoundError:
        pass
    return data

def get_ewma_zone():
    try:
        return json.load(open(EWMA_STATE)).get("sagi_zone", "normal")
    except:
        return "normal"

def svg_bounds_chart(bounds, data, zone):
    """生成萨奇图SVG - 边界 + 工作点"""
    W, H = 560, 380
    pad_l, pad_r, pad_t, pad_b = 60, 30, 50, 50
    plot_w = W - pad_l - pad_r
    plot_h = H - pad_t - pad_b

    # 坐标映射: A ∈ [0,1] → x, gain ∈ [0,5] → y
    A_max, gain_max = 1.0, 5.0
    def map_x(A): return pad_l + (A / A_max) * plot_w
    def map_y(gain): return pad_t + (1 - gain / gain_max) * plot_h

    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="system-ui,-apple-system,sans-serif">']
    svg.append(f'<rect width="{W}" height="{H}" fill="{COLORS["bg"]}"/>')

    # 背景区域
    zones = [
        (0.0, 0.5, "safe", "rgba(76,175,80,0.12)"),
        (0.5, 0.8, "elevated", "rgba(255,152,0,0.12)"),
        (0.8, 99.0, "critical", "rgba(244,67,54,0.12)"),
        (0.95, 1.0, "critical", "rgba(156,39,176,0.15)"),
    ]
    for lo, hi, zname, fc in zones:
        x1, x2 = map_x(lo), map_x(hi)
        svg.append(f'<rect x="{x1}" y="{pad_t}" width="{x2-x1}" height="{plot_h}" fill="{fc}"/>')

    # 网格线
    for A in [0.25, 0.5, 0.75, 1.0]:
        x = map_x(A)
        svg.append(f'<line x1="{x}" y1="{pad_t}" x2="{x}" y2="{pad_t+plot_h}" stroke="{COLORS["grid"]}" stroke-width="1"/>')
    for gain in [1, 2, 3, 4, 5]:
        y = map_y(gain)
        svg.append(f'<line x1="{pad_l}" y1="{y}" x2="{pad_l+plot_w}" y2="{y}" stroke="{COLORS["grid"]}" stroke-width="1"/>')

    # 萨奇图边界曲线 1/A
    path_parts = []
    for A_val, gain_val in bounds:
        if 0.05 <= A_val <= 1.0 and 0.5 <= gain_val <= 10:
            x, y = map_x(A_val), map_y(min(gain_val, 5.0))
            path_parts.append(f"{x:.1f},{y:.1f}")
    
    if path_parts:
        svg.append(f'<polyline points="{" ".join(path_parts)}" fill="none" stroke="#1565C0" stroke-width="2.5" stroke-linejoin="round"/>')

    # 边界标注线
    for gain_val, label in [(2.0, "安全"), (1.25, "过载"), (1.053, "临界")]:
        y = map_y(gain_val)
        svg.append(f'<line x1="{pad_l}" y1="{y}" x2="{pad_l+plot_w}" y2="{y}" stroke="{COLORS["subtle"]}" stroke-width="1" stroke-dasharray="4,3"/>')
        svg.append(f'<text x="{pad_l-5}" y="{y+4}" text-anchor="end" font-size="10" fill="{COLORS["subtle"]}">{label} {gain_val}</text>')

    # 工作点轨迹
    if data:
        traj_pts = []
        for d in data:
            n = d["n_proxy"]
            if n > 0:
                gain = 1.0 / n
                x, y = map_x(n), map_y(min(gain, 5.0))
                traj_pts.append(f"{x:.1f},{y:.1f}")
        
        if len(traj_pts) >= 2:
            svg.append(f'<polyline points="{" ".join(traj_pts)}" fill="none" stroke="#E91E63" stroke-width="2" stroke-opacity="0.7"/>')
        
        # 当前点
        latest = data[-1]
        n = latest["n_proxy"]
        if n > 0:
            gain = 1.0 / n
            cx, cy = map_x(n), map_y(min(gain, 5.0))
            z = get_zone(n)
            svg.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="8" fill="{zone_color(z)}" stroke="white" stroke-width="2"/>')
            svg.append(f'<text x="{cx:.1f}" y="{cy-14}" text-anchor="middle" font-size="11" font-weight="bold" fill="{zone_color(z)}">({n:.2f}, {gain:.2f})</text>')

    # 轴标签
    svg.append(f'<text x="{pad_l+plot_w//2}" y="{H-8}" text-anchor="middle" font-size="12" fill="{COLORS["text"]}">振幅 A = n_proxy (负载强度)</text>')
    svg.append(f'<text x="12" y="{pad_t+plot_h//2}" text-anchor="middle" font-size="12" fill="{COLORS["text"]}" transform="rotate(-90,12,{pad_t+plot_h//2})">增益因子 |N(A)| = 1/A</text>')

    # X轴刻度
    for A in [0, 0.25, 0.5, 0.75, 1.0]:
        x = map_x(A)
        svg.append(f'<text x="{x:.1f}" y="{pad_t+plot_h+18}" text-anchor="middle" font-size="10" fill="{COLORS["subtle"]}">{A:.2f}</text>')

    # 区域标签
    svg.append(f'<text x="{map_x(0.25):.0f}" y="{pad_t+20}" text-anchor="middle" font-size="11" font-weight="bold" fill="{COLORS["safe"]}">安全区(n<0.5)</text>')
    svg.append(f'<text x="{map_x(0.55):.0f}" y="{pad_t+20}" text-anchor="middle" font-size="10" font-weight="bold" fill="{COLORS["elevated"]}">高负荷</text>')
    svg.append(f'<text x="{map_x(0.9):.0f}" y="{pad_t+20}" text-anchor="middle" font-size="10" font-weight="bold" fill="{COLORS["critical"]}">临界</text>')
    svg.append(f'<text x="{map_x(0.975):.0f}" y="{pad_t+20}" text-anchor="middle" font-size="9" font-weight="bold" fill="{COLORS["critical"]}">临界</text>')

    svg.append('</svg>')
    return "\n".join(svg)

def svg_timeline(data):
    """生成时间线SVG - n_proxy和H的演化"""
    W, H = 560, 180
    pad_l, pad_r, pad_t, pad_b = 50, 20, 30, 35
    plot_w = W - pad_l - pad_r
    plot_h = H - pad_t - pad_b

    if not data:
        return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}"><text x="10" y="90">无数据</text></svg>'

    times = [d["ts"] for d in data]
    n_vals = [d["n_proxy"] for d in data]
    H_vals = [d["H"] for d in data]

    t_min, t_max = times[0], times[-1]
    n_max = max(max(n_vals) * 1.1, 1.0)
    H_max = 1.0

    def map_x(t): 
        if t_max == t_min: return pad_l + plot_w / 2
        return pad_l + ((t - t_min) / (t_max - t_min)) * plot_w
    def map_y_n(v): return pad_t + (1 - v / n_max) * plot_h
    def map_y_H(v): return pad_t + (1 - v / H_max) * plot_h

    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="system-ui,sans-serif">']
    svg.append(f'<rect width="{W}" height="{H}" fill="{COLORS["bg"]}"/>')

    # 背景区域标注
    for lo, hi, zname, fc in [(0, 0.5, "safe", "rgba(76,175,80,0.1)"), (0.5, 0.8, "elevated", "rgba(255,152,0,0.1)"), (0.8, 1.0, "critical", "rgba(244,67,54,0.1)")]:
        y1 = map_y_n(hi * n_max / n_max)
        y2 = map_y_n(lo * n_max / n_max)
        if y2 < pad_t: y2 = pad_t
        if y1 > pad_t + plot_h: y1 = pad_t + plot_h
        if y1 < pad_t + plot_h and y2 > pad_t:
            svg.append(f'<rect x="{pad_l}" y="{y1}" width="{plot_w}" height="{y2-y1}" fill="{fc}"/>')

    # 网格
    for i in range(5):
        y = map_y_n(i * 0.25 * n_max)
        label_val = i * 0.25 * n_max
        svg.append(f'<line x1="{pad_l}" y1="{y:.1f}" x2="{pad_l+plot_w}" y2="{y:.1f}" stroke="{COLORS["grid"]}" stroke-width="1"/>')
        svg.append(f'<text x="{pad_l-5}" y="{(y+4):.1f}" text-anchor="end" font-size="9" fill="{COLORS["subtle"]}">{label_val:.2f}</text>')

    # n_proxy曲线
    n_pts = " ".join([f"{map_x(t):.1f},{map_y_n(v):.1f}" for t, v in zip(times, n_vals)])
    svg.append(f'<polyline points="{n_pts}" fill="none" stroke="#1976D2" stroke-width="2"/>')
    
    # H曲线
    H_pts = " ".join([f"{map_x(t):.1f},{map_y_H(v):.1f}" for t, v in zip(times, H_vals)])
    svg.append(f'<polyline points="{H_pts}" fill="none" stroke="#E91E63" stroke-width="1.5" stroke-dasharray="4,2"/>')

    # 时间标签
    n_ticks = min(8, len(times))
    step = max(1, len(times) // n_ticks)
    for i in range(0, len(times), step):
        x = map_x(times[i])
        label = times[i].strftime("%H:%M")
        svg.append(f'<text x="{x:.1f}" y="{H-8}" text-anchor="middle" font-size="9" fill="{COLORS["subtle"]}">{label}</text>')

    # 图例
    svg.append(f'<circle cx="{pad_l+plot_w-80}" cy="{pad_t+10}" r="5" fill="#1976D2"/>')
    svg.append(f'<text x="{pad_l+plot_w-72}" y="{pad_t+14}" font-size="9" fill="{COLORS["text"]}">n_proxy</text>')
    svg.append(f'<line x1="{pad_l+plot_w-80}" y1="{pad_t+24}" x2="{pad_l+plot_w-60}" y2="{pad_t+24}" stroke="#E91E63" stroke-width="1.5" stroke-dasharray="4,2"/>')
    svg.append(f'<text x="{pad_l+plot_w-55}" y="{pad_t+28}" font-size="9" fill="{COLORS["text"]}">H</text>')

    # 边界线
    y50 = map_y_n(0.5 * n_max)
    svg.append(f'<line x1="{pad_l}" y1="{y50:.1f}" x2="{pad_l+plot_w}" y2="{y50:.1f}" stroke="{COLORS["elevated"]}" stroke-width="1" stroke-dasharray="3,3"/>')
    svg.append(f'<text x="{pad_l+plot_w+2}" y="{(y50+3):.1f}" font-size="8" fill="{COLORS["elevated"]}">0.5</text>')

    svg.append('</svg>')
    return "\n".join(svg)

def svg_phase_plane(data):
    """相平面可视化：H(健康度) vs L(负载度) + 萨奇图区域着色"""
    W, H_svg = 560, 320
    pad_l, pad_r, pad_t, pad_b = 60, 30, 40, 50
    plot_w = W - pad_l - pad_r
    plot_h = H_svg - pad_t - pad_b

    # H: [0, 1] → x, L: [0, 1] → y
    def mx(h): return pad_l + h * plot_w
    def my(L): return pad_t + (1 - L) * plot_h

    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H_svg}" font-family="system-ui,sans-serif">']
    svg.append(f'<rect width="{W}" height="{H_svg}" fill="{COLORS["bg"]}"/>')

    # === 萨奇图区域背景 ===
    # 坐标系: H横轴(右=健康), L纵轴(上=负载)
    # 区域:
    #   stable (safe): H>0.7 AND L<0.5 → 右上矩形
    #   warning: H<0.5 → 左半
    #   elevated/high-load: L>0.7 AND H>0.6 → 上右
    #   diverging (fuse): H<0.4 AND L>0.8 → 左下角
    #   drifting: else

    # safe/stable区: H>0.7, L<0.5
    svg.append(f'<rect x="{mx(0.7):.1f}" y="{my(0.5):.1f}" width="{plot_w - mx(0.7) + pad_l:.1f}" height="{my(0) - my(0.5):.1f}" fill="rgba(76,175,80,0.15)"/>')
    # warning区: H<0.5 (排除已有区域)
    svg.append(f'<rect x="{pad_l:.1f}" y="{pad_t:.1f}" width="{mx(0.5)-pad_l:.1f}" height="{plot_h:.1f}" fill="rgba(255,152,0,0.10)"/>')
    # elevated区: L>0.7 AND H>0.6
    svg.append(f'<rect x="{mx(0.6):.1f}" y="{pad_t:.1f}" width="{mx(1.0)-mx(0.6):.1f}" height="{my(0.7)-pad_t:.1f}" fill="rgba(244,67,54,0.12)"/>')
    # diverging/fuse区: H<0.4 AND L>0.8
    svg.append(f'<rect x="{pad_l:.1f}" y="{my(1.0):.1f}" width="{mx(0.4)-pad_l:.1f}" height="{my(0.8)-my(1.0):.1f}" fill="rgba(156,39,176,0.20)"/>')

    # 边界线
    # H=0.5 (warning boundary)
    svg.append(f'<line x1="{mx(0.5):.1f}" y1="{pad_t:.1f}" x2="{mx(0.5):.1f}" y2="{pad_t+plot_h:.1f}" stroke="{COLORS["subtle"]}" stroke-width="1" stroke-dasharray="4,3"/>')
    # L=0.5 (safe boundary)
    svg.append(f'<line x1="{pad_l:.1f}" y1="{my(0.5):.1f}" x2="{pad_l+plot_w:.1f}" y2="{my(0.5):.1f}" stroke="{COLORS["subtle"]}" stroke-width="1" stroke-dasharray="4,3"/>')
    # H=0.4 (fuse top)
    svg.append(f'<line x1="{mx(0.4):.1f}" y1="{my(0.8):.1f}" x2="{mx(0.4):.1f}" y2="{pad_t+plot_h:.1f}" stroke="rgba(156,39,176,0.6)" stroke-width="1" stroke-dasharray="3,2"/>')
    # L=0.7 (elevated boundary)
    svg.append(f'<line x1="{mx(0.6):.1f}" y1="{my(0.7):.1f}" x2="{pad_l+plot_w:.1f}" y2="{my(0.7):.1f}" stroke="rgba(244,67,54,0.5)" stroke-width="1" stroke-dasharray="3,2"/>')
    # H=0.7 (safe boundary)
    svg.append(f'<line x1="{mx(0.7):.1f}" y1="{my(0.5):.1f}" x2="{mx(0.7):.1f}" y2="{pad_t:.1f}" stroke="{COLORS["safe"]}" stroke-width="1" stroke-opacity="0.4" stroke-dasharray="4,3"/>')

    # 网格
    for h in [0.2, 0.4, 0.6, 0.8]:
        svg.append(f'<line x1="{mx(h):.1f}" y1="{pad_t:.1f}" x2="{mx(h):.1f}" y2="{pad_t+plot_h:.1f}" stroke="{COLORS["grid"]}" stroke-width="0.5"/>')
    for L in [0.2, 0.4, 0.6, 0.8]:
        svg.append(f'<line x1="{pad_l:.1f}" y1="{my(L):.1f}" x2="{pad_l+plot_w:.1f}" y2="{my(L):.1f}" stroke="{COLORS["grid"]}" stroke-width="0.5"/>')

    # 轨迹
    if data:
        pts = [(mx(d.get("H", 0)), my(d.get("L", 0))) for d in data]
        if len(pts) >= 2:
            for i in range(len(pts)-1):
                x1,y1 = pts[i]; x2,y2 = pts[i+1]
                age = i / max(len(pts)-1, 1)
                op = 0.3 + 0.7 * age
                svg.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#E91E63" stroke-width="1.5" stroke-opacity="{op:.2f}"/>')
        
        # 当前点
        cx, cy = pts[-1]
        latest_d = data[-1]
        H_val = latest_d.get("H", 0)
        L_val = latest_d.get("L", 0)
        
        # 确定当前zone颜色
        zone_bg = "#4CAF50"
        if H_val < 0.4 and L_val > 0.8: zone_bg = "#9C27B0"
        elif L_val > 0.7 and H_val > 0.6: zone_bg = "#f44336"
        elif H_val < 0.5: zone_bg = "#FF9800"
        
        svg.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="9" fill="{zone_bg}" stroke="white" stroke-width="2.5"/>')
        svg.append(f'<text x="{cx:.1f}" y="{cy-14}" text-anchor="middle" font-size="11" font-weight="bold" fill="{zone_bg}">({H_val:.2f},{L_val:.2f})</text>')

    # 轴标签
    svg.append(f'<text x="{pad_l+plot_w//2}" y="{H_svg-8}" text-anchor="middle" font-size="12" fill="{COLORS["text"]}">H 健康度 →</text>')
    svg.append(f'<text x="12" y="{pad_t+plot_h//2}" text-anchor="middle" font-size="12" fill="{COLORS["text"]}" transform="rotate(-90,12,{pad_t+plot_h//2})">负载度 L ↑</text>')

    # 刻度
    for h in [0, 0.2, 0.4, 0.6, 0.8, 1.0]:
        svg.append(f'<text x="{mx(h):.1f}" y="{pad_t+plot_h+16}" text-anchor="middle" font-size="10" fill="{COLORS["subtle"]}">{h:.1f}</text>')
    for L in [0, 0.5, 1.0]:
        svg.append(f'<text x="{pad_l-5}" y="{my(L)+4:.1f}" text-anchor="end" font-size="10" fill="{COLORS["subtle"]}">{L:.1f}</text>')

    # 区域标签
    svg.append(f'<text x="{mx(0.85):.0f}" y="{my(0.25):.0f}" text-anchor="middle" font-size="11" font-weight="bold" fill="{COLORS["safe"]}">stable</text>')
    svg.append(f'<text x="{mx(0.25):.0f}" y="{my(0.5):.0f}" text-anchor="middle" font-size="11" font-weight="bold" fill="rgba(255,152,0,0.7)">warning</text>')
    svg.append(f'<text x="{mx(0.8):.0f}" y="{my(0.85):.0f}" text-anchor="middle" font-size="10" font-weight="bold" fill="{COLORS["elevated"]}">elevated</text>')
    svg.append(f'<text x="{mx(0.2):.0f}" y="{my(0.9):.0f}" text-anchor="middle" font-size="9" font-weight="bold" fill="{COLORS["critical"]}">fuse</text>')

    svg.append('</svg>')
    return "\n".join(svg)

def generate_html(sagi_svg, timeline_svg, phase_plane_svg, data, zone, fuse=False, is_drifting=False, trajectory="unknown"):
    latest = data[-1] if data else {}
    n = latest.get("n_proxy", 0)
    gain_factor = f"{1/n:.2f}" if n > 0 else "—"
    H = latest.get("H", 0)
    q_curr = latest.get("q_curr", latest.get("q_total", latest.get("q", 0)))
    q_total = latest.get("q_total", latest.get("q", 0))
    sr = latest.get("sr", 0)
    spawn_on = latest.get("spawn_on", 45)
    spawn_off = latest.get("spawn_off", 38)
    current_zone = get_zone(n)

    status_colors = {
        "safe": "#4CAF50", "elevated": "#FF9800", "critical": "#9C27B0", "normal": "#2196F3"
    }
    status = current_zone if current_zone != "normal" else zone
    status_bg = status_colors.get(status, "#757575")

    html = f'''<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>萨奇图控制 - Sagi-Chart</title>
<style>
* {{ margin:0; padding:0; box-sizing:border-box; }}
body {{ font-family: system-ui,-apple-system,sans-serif; background:#F5F5F5; color:#212121; }}
.header {{ background:linear-gradient(135deg,#1a237e,#283593); color:white; padding:16px 24px; }}
.header h1 {{ font-size:18px; font-weight:600; letter-spacing:0.5px; }}
.header p {{ font-size:12px; opacity:0.8; margin-top:2px; }}
.status-bar {{ display:flex; gap:12px; padding:12px 24px; background:white; border-bottom:1px solid #E0E0E0; flex-wrap:wrap; }}
.stat {{ display:flex; flex-direction:column; }}
.stat-label {{ font-size:10px; color:#757575; text-transform:uppercase; letter-spacing:0.5px; }}
.stat-value {{ font-size:20px; font-weight:700; }}
.stat-value.green {{ color:#4CAF50; }}
.stat-value.orange {{ color:#FF9800; }}
.stat-value.red {{ color:#f44336; }}
.stat-value.blue {{ color:#1976D2; }}
.zone-badge {{ display:inline-block; padding:4px 14px; border-radius:20px; color:white; font-size:13px; font-weight:600; background:{status_bg}; }}
.content {{ padding:16px 24px; display:flex; flex-direction:column; gap:16px; }}
.card {{ background:white; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,0.1); overflow:hidden; }}
.card-header {{ padding:10px 14px; border-bottom:1px solid #F0F0F0; font-size:12px; font-weight:600; color:#424242; display:flex; justify-content:space-between; align-items:center; }}
.card-body {{ padding:12px; }}
.card-body svg {{ width:100%; height:auto; display:block; }}
table {{ width:100%; border-collapse:collapse; font-size:11px; }}
th {{ text-align:left; padding:6px 8px; background:#FAFAFA; color:#616161; font-weight:600; border-bottom:1px solid #E0E0E0; }}
td {{ padding:6px 8px; border-bottom:1px solid #F5F5F5; }}
tr:last-child td {{ border-bottom:none; }}
.参数字典 {{ display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-top:8px; }}
.param {{ background:#FAFAFA; padding:8px 10px; border-radius:6px; }}
.param-name {{ font-size:10px; color:#757575; }}
.param-val {{ font-size:16px; font-weight:700; color:#1565C0; }}
.footer {{ text-align:center; padding:12px; font-size:11px; color:#9E9E9E; }}
</style>
</head>
<body>
<div class="header">
  <h1>萨奇图增益调度控制台</h1>
  <p>钱学森《工程控制论》· 描述函数法 · Sagi-Chart Gain Scheduling · {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}</p>
</div>

<div class="status-bar">
  <div class="stat">
    <span class="stat-label">当前区域</span>
    <span class="zone-badge">{status.upper()}</span>
  </div>
  <div class="stat">
    <span class="stat-label">n_proxy</span>
    <span class="stat-value {'orange' if n>0.5 else 'green'}">{n:.3f}</span>
  </div>
  <div class="stat">
    <span class="stat-label">H 健康度</span>
    <span class="stat-value {'red' if H<0.4 else 'blue'}">{H:.3f}</span>
  </div>
  <div class="stat">
    <span class="stat-label">当前会话 q_curr</span>
    <span class="stat-value blue">{q_curr}</span>
  </div>
  <div class="stat">
    <span class="stat-label">派发率 sr</span>
    <span class="stat-value blue">{sr:.3f}</span>
  </div>
  <div class="stat">
    <span class="stat-label">SPAWN_ON</span>
    <span class="stat-value orange">{spawn_on}</span>
  </div>
  <div class="stat">
    <span class="stat-label">SPAWN_OFF</span>
    <span class="stat-value orange">{spawn_off}</span>
  </div>
  <div class="stat">
    <span class="stat-label">熔断</span>
    <span class="stat-value {'red' if fuse else 'green'}">{'🔴 FUSE' if fuse else 'OK'}</span>
  </div>
  <div class="stat">
    <span class="stat-label">漂移</span>
    <span class="stat-value {'red' if is_drifting else 'green'}">{'⚠️ DRIFT' if is_drifting else 'OK'}</span>
  </div>
  <div class="stat">
    <span class="stat-label">轨迹</span>
    <span class="stat-value blue">{trajectory.upper()}</span>
  </div>
  <div class="参数字典">
    <div class="param"><div class="param-name">安全边界</div><div class="param-val">0.5</div></div>
    <div class="param"><div class="param-name">去饱和边界</div><div class="param-val">0.6</div></div>
    <div class="param"><div class="param-name">过载边界</div><div class="param-val">0.8</div></div>
    <div class="param"><div class="param-name">增益因子</div><div class="param-val">{gain_factor}</div></div>
  </div>
</div>

<div class="content">
  <div class="card">
    <div class="card-header">
      <span>萨奇图 (Sagi-Chart) — 描述函数边界</span>
      <span style="font-weight:normal;color:#757575;font-size:11px;">蓝线=1/A边界 | 红点=当前工作点</span>
    </div>
    <div class="card-body">{sagi_svg}</div>
  </div>

  <div class="card">
    <div class="card-header">
      <span>指标演化时间线 (最近6小时)</span>
      <span style="font-weight:normal;color:#757575;font-size:11px;">蓝=n_proxy | 虚线=H</span>
    </div>
    <div class="card-body">{timeline_svg}</div>
  </div>

  <div class="card">
    <div class="card-header">
      <span>相平面 (H vs L) — 萨奇图着色</span>
      <span style="font-weight:normal;color:#757575;font-size:11px;">H→右=健康 L→上=负载 | 红点=当前</span>
    </div>
    <div class="card-body">{phase_plane_svg}</div>
  </div>

  <div class="card">
    <div class="card-header">最近数据点</div>
    <div class="card-body">
      <table>
        <tr><th>时间</th><th>n_proxy</th><th>H</th><th>L</th><th>q_curr</th><th>sr</th><th>萨奇图</th><th>漂移</th><th>轨迹</th><th>SPAWN_ON</th></tr>
'''
    for d in reversed(data[-12:]):
        html += f'''        <tr>
          <td>{d["ts"].strftime("%H:%M:%S")}</td>
          <td>{d["n_proxy"]:.3f}</td>
          <td>{d["H"]:.4f}</td>
          <td>{d["L"]:.3f}</td>
          <td>{d.get("q_curr", d.get("q_total", d.get("q",0)))}</td>
          <td>{d["sr"]:.4f}</td>
          <td>{d.get("sagi_zone", "safe")}</td>
          <td>{'⚠️' if d.get("is_drifting") else ''}</td>
          <td>{d.get("trajectory", "?")}</td>
          <td>{d.get("spawn_on","?")}</td>
        </tr>
'''
    html += '''      </table>
    </div>
  </div>
</div>

<div class="footer">
  萨奇图控制系统 · OpenClaw SRE Agent · 每分钟更新 · 数据来源: system_metrics.jsonl
</div>
</body>
</html>'''
    return html

def main():
    hours = int(sys.argv[1]) if len(sys.argv) > 1 else 6
    zone = get_ewma_zone()
    data = load_metrics(hours)
    bounds = generate_boundary_path()
    # 当前zone从metrics实时计算（萨奇图新边界）
    if data:
        n_latest = data[-1].get("n_proxy", 0)
        if n_latest <= 0.5:   zone = "safe"
        elif n_latest <= 0.8: zone = "elevated"
        else:                   zone = "critical"
    fuse = data[-1].get("fuse_triggered", False) if data else False
    
    is_drifting = data[-1].get("is_drifting", False) if data else False
    trajectory = data[-1].get("trajectory", "unknown") if data else "unknown"
    sagi_svg = svg_bounds_chart(bounds, data, zone)
    timeline_svg = svg_timeline(data)
    phase_plane_svg = svg_phase_plane(data)
    html = generate_html(sagi_svg, timeline_svg, phase_plane_svg, data, zone, fuse, is_drifting, trajectory)
    
    with open(HTML_OUT, "w") as f:
        f.write(html)
    
    print(f"[sagi-visualize] Generated: {HTML_OUT}")
    
    if data:
        latest = data[-1]
        n = latest["n_proxy"]
        z = get_zone(n)
        print(f"  当前: n_proxy={n:.3f} zone={z} ({len(data)} points, {hours}h)")
        print(f"  轨迹: {data[0]['ts'].strftime('%H:%M')} → {data[-1]['ts'].strftime('%H:%M')}")
        print(f"  峰值: max_n={max(d['n_proxy'] for d in data):.2f} max_q_curr={max(d.get('q_curr', d.get('q',0)) for d in data)}")

if __name__ == "__main__":
    main()
