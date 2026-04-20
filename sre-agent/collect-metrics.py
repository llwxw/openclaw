#!/usr/bin/env python3
"""
SRE Agent 数据采集 + 萨奇图增益调度 + 熔断检测 + P1改进
v9: 三-zone自适应滞环 + 漂移态检测 + 轨迹方向控制
理论依据：钱学森工程控制论 第八/十/十七章
"""
import os, json, yaml
from datetime import datetime, timedelta

METRICS_FILE = os.path.expanduser("~/.openclaw/metrics/system_metrics.jsonl")
EPHEMERAL_DIR = os.path.expanduser("~/.openclaw/workspace/memory/ephemeral")
CONFIG_FILE = os.path.expanduser("~/.openclaw/memory/CONTROL_META.yaml")
METRICS_DIR = os.path.expanduser("~/.openclaw/metrics")
EWMA_STATE = os.path.join(METRICS_DIR, "ewma_state.json")
FUSE_STATE = os.path.join(METRICS_DIR, "fuse_state.json")

os.makedirs(METRICS_DIR, exist_ok=True)

# === 描述函数 K(n) ===
# 钱学森第八章：Agent能力随负载变化的非线性衰减
#
# 参数来源: 基于实测数据的经验估计
# ⚠️ 警告: 2026-04-20 的数据拟合存在多局部最优问题
#     当前参数是"合理近似"，不是严格拟合结果
#
# 原拟合尝试: K_max=1.14, n_max=0.535, p=0.754, R²=0.97
# 问题: 拟合不稳定，不同初始值导致不同结果
#
# 当前策略: K(n) 作为辅助预警指标，不做控制决策
#     稳定性保证来自 n<0.5 条件，不是 K(n)
#
DESCRIBE_K_MAX = 0.95  # 零负载时的能力上限
DESCRIBE_N_MAX = 8.0   # 饱和点（经验值）
DESCRIBE_P = 2.0       # 衰减指数（经验值）
DESCRIBE_K_SAT = 0.01  # 防止除零

def compute_K(n):
    """
    计算描述函数 K(n) - Agent 在负载率 n 下的能力系数
    
    模型: K(n) = K_max * (1 - (n/n_max)^p)
    
    注意: 这是经验公式，不是严格理论推导。
          主要用于状态显示和预警，不做控制决策。
          稳定性保证来自 n<0.5 条件。
    """
    if n <= 0:
        return DESCRIBE_K_MAX
    elif n >= DESCRIBE_N_MAX:
        return DESCRIBE_K_SAT
    else:
        return DESCRIBE_K_MAX * (1 - (n / DESCRIBE_N_MAX) ** DESCRIBE_P)

# === 配置 ===
def load_config():
    defaults = {
        "current_mode": "normal",
        "SCORE_THRESHOLD_current": 40,
        "MAX_CONCURRENT_TASKS_current": 5,
        "SPAWN_ON_current": 20,
        "SPAWN_OFF_current": 25,
    }
    try:
        with open(CONFIG_FILE) as f:
            data = yaml.safe_load(f)
        if data is None:
            return defaults
        params = data.get("parameters", {})
        return {
            "current_mode": data.get("current_mode", "normal"),
            "SCORE_THRESHOLD_current": params.get("SCORE_THRESHOLD", {}).get("current", 40),
            "MAX_CONCURRENT_TASKS_current": params.get("MAX_CONCURRENT_TASKS", {}).get("current", 5),
            "SPAWN_ON_current": params.get("SPAWN_ON", {}).get("current", 45),
            "SPAWN_OFF_current": params.get("SPAWN_OFF", {}).get("current", 38),
        }
    except:
        return defaults

config = load_config()

# === 萨奇图3-zone模型 ===
# 理论依据：钱学森第八章 - n < 0.5 即无条件稳定
# 各zone的基准滞环宽度：safe=窄(4), elevated=标准(7), critical=宽(18)
# 来自方案"自适应滞环"设计
SAGI_ZONES = [
    (0.0,  0.5,  "safe",       5,   5,  1.0,  1.0,  25, 20),   # n<0.5: 绝对稳定, 窄滞环（ON>OFF，防震荡）
    (0.5,  0.8,  "elevated",  -3,  -3,  1.3,  1.0,  22, 18),   # 0.5~0.8: 标准滞环（ON>OFF）
    (0.8,  99.0, "critical",   8,   6,  2.0, 1.0,  28, 22),    # n>0.8: 宽滞环（ON>OFF，最低增益）
]
# 元组: (n_min, n_max, zone_name, don, doff, maxcf, gf, base_on, base_off)

# === 参数校验（防止配置错误）===
def validate_parameters():
    """校验 SAGI_ZONES 参数的合理性"""
    for n_min, n_max, name, don, doff, maxcf, gf, base_on, base_off in SAGI_ZONES:
        # 1. maxcf 在 critical 区必须 > 1（提高容量才是正确的控制方向）
        if name == "critical" and maxcf <= 1.0:
            print(f"[WARN] SAGI_ZONES: critical zone maxcf={maxcf} <= 1.0 may cause instability")
        # 2. base_on 必须 > base_off（否则滞环失效）
        if base_on <= base_off:
            print(f"[WARN] SAGI_ZONES: zone={name} base_on={base_on} <= base_off={base_off}")
        # 3. 变化量不能过大（防止剧烈震荡）
        if abs(don) > 30 or abs(doff) > 30:
            print(f"[WARN] SAGI_ZONES: zone={name} don/doff too large: {don}/{doff}")

validate_parameters()

def get_sagi_zone(n):
    if n <= 0.5:   return "safe"
    elif n <= 0.8: return "elevated"
    else:            return "critical"

# === 统一状态机 ===
# 合并 classify(H,L) 和 get_sagi_zone(n) 两个回路
# 钱学森：系统状态应该由多个指标综合判断，不是各自为战
UNIFIED_ZONE_PRIORITY = {
    "diverging": 0,   # 最高优先级：系统正在发散
    "critical": 1,     # 系统过载
    "overload": 2,     # 高负载但未发散
    "elevated": 3,     # 中等负载
    "drifting": 4,     # 慢性漂移
    "warning": 5,      # 健康度不足
    "stable": 6,       # 最低优先级：稳定
}

def get_unified_state(region, sagi_zone, fuse_triggered):
    """
    合并 region 和 sagi_zone 为统一控制状态
    
    原则：
    1. fuse_triggered = 最高优先级（系统保护）
    2. diverging = 第二优先级（系统崩溃中）
    3. 其他按 severity 排序
    
    返回：(unified_zone, priority, control_action)
    """
    if fuse_triggered:
        return ("fuse", 0, "EMERGENCY")
    
    # 将 region 映射到 unified zone
    region_to_unified = {
        "stable": "stable",
        "warning": "warning",
        "overload": "overload",
        "diverging": "diverging",
        "drifting": "drifting",
    }
    
    unified_region = region_to_unified.get(region, "unknown")
    
    # 计算 combined severity
    region_priority = UNIFIED_ZONE_PRIORITY.get(unified_region, 99)
    sagi_priority = UNIFIED_ZONE_PRIORITY.get(sagi_zone, 99)
    
    # 两者取更严重的
    if region_priority <= sagi_priority:
        combined = unified_region
        combined_priority = region_priority
    else:
        combined = sagi_zone
        combined_priority = sagi_priority
    
    # 确定控制动作
    if combined == "diverging":
        action = "FUSE_TRIGGER"
    elif combined == "critical":
        action = "SAGI_INCREASE_CAPACITY"
    elif combined == "overload":
        action = "SAGI_REDUCE_RATE"
    elif combined == "elevated":
        action = "SAGI_MONITOR"
    elif combined == "stable":
        action = "NORMAL"
    elif combined == "warning":
        action = "ANALYZE"
    else:
        action = "UNKNOWN"
    
    return (combined, combined_priority, action)

def get_sagi_params(zone):
    for _, _, name, don, doff, maxcf, gf, base_on, base_off in SAGI_ZONES:
        if name == zone:
            return don, doff, maxcf, gf, base_on, base_off
    return 0, 0, 1.0, 1.0, 45, 38

# === 第一部分：数据采集 ===
q_curr, q_total, scored, spawned = 0, 0, 0, 0
scores = []

current_hour = datetime.now().strftime("%Y-%m-%d-%H")
current_file = os.path.join(EPHEMERAL_DIR, f"{current_hour}.jsonl")

if os.path.exists(current_file):
    with open(current_file) as f:
        for line in f:
            if not line.strip(): continue
            q_total += 1
            q_curr += 1
            try:
                obj = json.loads(line.strip())
                score = obj.get("score", 0)
                scores.append(score)
                if score > 0:
                    scored += 1
                if score >= config["SCORE_THRESHOLD_current"]:
                    spawned += 1
            except:
                pass

for h in range(1, 4):
    ts_h = datetime.now() - timedelta(hours=h)
    fname = f"{ts_h.strftime('%Y-%m-%d-%H')}.jsonl"
    fpath = os.path.join(EPHEMERAL_DIR, fname)
    if os.path.exists(fpath):
        with open(fpath) as f:
            for line in f:
                if not line.strip(): continue
                q_total += 1
                try:
                    obj = json.loads(line.strip())
                    scores.append(obj.get("score", 0))
                except:
                    pass

q = q_total
sr = spawned / q if q > 0 else 0.0
cur_max_c = config.get("MAX_CONCURRENT_TASKS_current", 5)  # 从配置读取，默认5
n_proxy = q_curr / cur_max_c if cur_max_c > 0 else q_curr / 5.0

# 相平面分类（钱学森第十章：相平面五态）
# H = 0.6×load健康度 + 0.4×quality健康度
# load健康度 = 1 - q/30 (q越少越健康)
# quality健康度 = sr/0.3 (sr≥0.3时=1, 满质量; sr=0时=0)
# L = 负载度 = n_proxy/2 = q/10
def classify(q_curr, sr, n_proxy):
    load_health = 1 - min(q_curr / 30.0, 1.0)
    quality_health = min(sr / 0.3, 1.0) if sr > 0 else 0.0
    H = 0.6 * load_health + 0.4 * quality_health
    L = min(n_proxy / 2.0, 1.0)
    # 五态判定（钱学森第十章）
    # stable: H>0.5且L<0.5 → 系统健康且低负载
    # warning: H<0.5 → 系统健康度不足
    # overload: L>0.5且H>0.4 → 高负载但未发散
    # diverging: H<0.4且L>0.5 → 系统正在发散
    # drifting: 其他组合 → 慢性漂移
    if H > 0.5 and L < 0.5:
        return "stable", H, L
    elif H < 0.4 and L > 0.5:
        # 发散区优先级最高（H<0.4说明系统已严重恶化）
        return "diverging", H, L
    elif H < 0.5:
        return "warning", H, L
    elif L > 0.5 and H > 0.4:
        return "overload", H, L
    else:
        return "drifting", H, L

region, H, L = classify(q_curr, sr, n_proxy)

# === 第二部分：漂移态检测（方案：五态之一）===
# 钱学森工程控制论：漂移态 = 各指标缓慢漂移无收敛发散
# 检测方法：连续6个点|H变化|<0.05 且 |L变化|<0.05，但未达稳定区
def detect_drift_state():
    """检测是否处于漂移态（钱学森：最危险的状态）"""
    try:
        lines = open(METRICS_FILE).readlines()
        if len(lines) < 6:
            return False, "insufficient_data"
        recent = []
        for l in lines[-6:]:
            try:
                d = json.loads(l.strip())
                recent.append((d['H'], d['L']))
            except:
                pass
        if len(recent) < 6:
            return False, "insufficient_data"
        H_vals = [r[0] for r in recent]
        L_vals = [r[1] for r in recent]
        H_deltas = [abs(H_vals[i+1] - H_vals[i]) for i in range(len(H_vals)-1)]
        L_deltas = [abs(L_vals[i+1] - L_vals[i]) for i in range(len(L_vals)-1)]
        max_H_d = max(H_deltas) if H_deltas else 0
        max_L_d = max(L_deltas) if L_deltas else 0
        # 漂移条件：五态之一（方案定义）
        # stable: H>0.7 and L<0.5
        # warning: H<0.5
        # overload: L>0.7 and H>0.6
        # diverging: H<0.4 and L>0.8
        # drifting: else (H在[0.5,0.7)之间缓慢变化，既非稳定也非发散)
        # 钱学森：漂移态=最危险——系统"看起来正常"但长期漂移出边界
        # 修复：H∈[0.5,0.7)且L<0.5是正常区域，不应算drift（钱学森第十章：稳定区扩展定义）
        in_stable = (H_vals[-1] > 0.7 and L_vals[-1] < 0.5) or (H_vals[-1] >= 0.5 and L_vals[-1] < 0.5)
        in_warning = (H_vals[-1] < 0.5)
        in_overload = (L_vals[-1] > 0.7 and H_vals[-1] > 0.6)
        in_diverging = (H_vals[-1] < 0.4 and L_vals[-1] > 0.8)
        in_drift_zone = not (in_stable or in_warning or in_overload or in_diverging)
        is_drifting = (q_curr > 0 and
                       max_H_d < 0.02 and max_L_d < 0.02 and
                       in_drift_zone)
        return is_drifting, f"H_drift={max(H_deltas):.3f} L_drift={max(L_deltas):.3f}"
    except:
        return False, "error"

is_drifting, drift_info = detect_drift_state()

# === 第三部分：轨迹方向检测（方案）===
# 钱学森：轨迹方向比位置更重要
# 计算最近6个点的轨迹向量，判断方向
def get_trajectory_direction():
    """返回轨迹方向: 'toward_stable', 'toward_diverging', 'unknown'"""
    try:
        lines = open(METRICS_FILE).readlines()
        if len(lines) < 6:
            return "unknown"
        recent = []
        for l in lines[-6:]:
            try:
                d = json.loads(l.strip())
                recent.append((d['H'], d['L']))
            except:
                pass
        if len(recent) < 6:
            return "unknown"
        # 方案要求：arctan2(dL, dH) 方向角
    # 钱学森：相平面中轨迹方向比位置更重要
    # atan2(dL, dH): 
    #   → -45°~45°: 向右(H增L稳) = 趋于稳定
    #   → 135°~225°: 向左(H减L增) = 趋于发散
    #   → 其他: 方向不明
        H_start, L_start = recent[0]
        H_end, L_end = recent[-1]
        dH = H_end - H_start
        dL = L_end - L_start
        import math
        angle = math.degrees(math.atan2(dL, dH)) if (dH != 0 or dL != 0) else 0
        # 向右(稳定): angle in [-45, 45]
        # 向右上(可能漂移): angle in [45, 135]
        # 向左(发散): angle in [135, 225] or [-225, -135]
        if -45 <= angle <= 45:
            return "toward_stable"
        elif 135 <= angle <= 180 or -180 <= angle <= -135:
            return "toward_diverging"
        else:
            return "unknown"
    except:
        return "unknown"

trajectory = get_trajectory_direction()

# === 第四部分：EWMA状态更新 ===
ewma_state = {"zone_consecutive": {}, "last_adjusted_zone": "safe", "suppressed_cycles": 0}
try:
    ewma_state = json.load(open(EWMA_STATE))
except:
    pass

# 对偶EWMA：快滤波器(α=0.6)跟踪当前值，慢滤波器(α=0.1)追踪趋势
# 变化检测：|fast-slow| > 阈值 → 发射段模式
ALPHA_FAST = 0.6
ALPHA_SLOW = 0.1
CHANGE_THRESHOLD = 0.015

def ewma_calc(prev, current, alpha):
    if prev is None: return current
    return alpha * current + (1 - alpha) * prev

H_fast_new = ewma_calc(ewma_state.get("H_fast"), H, ALPHA_FAST)
H_slow_new = ewma_calc(ewma_state.get("H_slow"), H, ALPHA_SLOW)
n_fast_new = ewma_calc(ewma_state.get("n_fast"), n_proxy, ALPHA_FAST)
n_slow_new = ewma_calc(ewma_state.get("n_slow"), n_proxy, ALPHA_SLOW)
delta_H = abs(H_fast_new - H_slow_new)
delta_n = abs(n_fast_new - n_slow_new)


Q_HISTORY_LEN = 10
q_history = ewma_state.get("q_history", [])
q_history.append(float(q_curr))
if len(q_history) > Q_HISTORY_LEN:
    q_history = q_history[-Q_HISTORY_LEN:]
ewma_state["q_history"] = q_history
q_rate = 0.0
if len(q_history) >= 6:
    recent = sum(q_history[-3:]) / 3
    older = sum(q_history[:3]) / 3
    q_rate = recent - older

# 发射段模式（钱学森第十二章：变系数系统）
# 退出机制：时间timeout（10分钟）或ewma收敛
current_mode = ewma_state.get("mode") or config.get("current_mode", "normal")  # ewma_state优先（内存中状态更准确）
launch_enter = False
launch_exit = False
mode_note = ""  # 初始化，避免未定义错误
launch_exit = False
launch_entry_time = ewma_state.get("launch_entry_time")  # 进入launch的时间戳
LAUNCH_TIMEOUT_SECS = 600  # 10分钟强制退出
if current_mode != "launch":
    # 检查冷却期：timeout退出后60秒内不重新进入
    cooldown_until = ewma_state.get("launch_cooldown_until", 0)
    in_cooldown = datetime.now().timestamp() < cooldown_until
    
    # 计算描述函数 K(n) - Agent能力系数
    K_current = compute_K(n_proxy)
    K_prev = ewma_state.get("K_prev", K_current)
    K_delta = K_current - K_prev  # K下降表示能力恶化
    ewma_state["K_prev"] = K_current
    
    # 任何DRIFT态都强制进入LAUNCH（钱学森第十二章：漂移态=最危险）
    # LAUNCH 滞环：需要连续2周期超标才进入，防止短暂波动导致震荡
    # 增强条件：K(n) 突然下降也是不稳定信号
    launch_consecutive = ewma_state.get("launch_consecutive_count", 0)
    if in_cooldown:
        launch_consecutive = 0  # 冷却期内不累积
    # 钱学森第十章：不稳定信号必须结合状态判定
    # 修复：delta_H 大时若H仍健康(H>0.5)说明是恢复期的正常收敛，不应触发LAUNCH
    # 钱学森：真正危险的是H<0.5时的delta_H（系统崩溃中）或K(n)突然下降
    # 钱学森第十章：不稳定信号必须结合状态判定
    # 钱学森第十二章：LAUNCH触发需要真正危险的不稳定信号
    # 修复2：delta_n>0.3 在恢复期（H>0.5且n<0.8）时不应触发LAUNCH
    #       钱学森：过载恢复期n升高是正常响应，不是系统失控
    # 注意：current_zone 在 line 540 才计算，这里用 get_sagi_zone(n_proxy) 直接计算
    # 钱学森第十章：trajectory 指向稳定时，即使 H<0.5 也不视为危险
    # 修复：H<0.5 但 trajectory=toward_stable 说明系统在自然恢复，不是失控
    recovering_stable = (H < 0.5 and trajectory == "toward_stable")
    unstable_signal = ((delta_H > CHANGE_THRESHOLD and H < 0.5 and not recovering_stable) or
                       (delta_n > 0.3 and get_sagi_zone(n_proxy) in ["critical", "diverging"]) or
                       (is_drifting and trajectory != "toward_stable") or K_delta < -0.1)
    if unstable_signal:
        launch_consecutive = launch_consecutive + 1
    else:
        launch_consecutive = 0
    ewma_state["launch_consecutive_count"] = launch_consecutive
    enter_launch = (launch_consecutive >= 2 and unstable_signal)
    if enter_launch:
        current_mode = "launch"
        launch_enter = True
        if is_drifting:
            adjustment_made = f"LAUNCH_ENTER DRIFT→LAUNCH delta_H={delta_H:.3f} K={K_current:.2f}(Δ{100*K_delta:.0f}%)"
        else:
            adjustment_made = f"LAUNCH_ENTER delta_H={delta_H:.3f} K={K_current:.2f}(Δ{100*K_delta:.0f}%)"
        mode_note = f"[LAUNCH_ENTER:K={K_current:.2f}]"
        ewma_state["launch_entry_time"] = datetime.now().timestamp()  # 记录进入时间
        ewma_state["suppressed_cycles"] = 0  # LAUNCH_ENTER时重置
else:
    # 发射段退出判断（钱学森第十二章：q变化率作为辅助信号）
    # 修复：当q正在下降时（q_rate < -0.1），说明过载正在消退，即使delta_n稍大也允许退出
    # 钱学森第十二章：过载消退是比EWMA收敛更可靠的退出信号
    base_exit = delta_H < CHANGE_THRESHOLD * 0.5 and H > 0.5 and n_proxy < 0.4 and (delta_n < 0.15 or q_rate < -0.1)
    # suppressed_cycles在LAUNCH_ENTER时重置为0，之后每次停留都递增

    # 时间/次数双重超时退出（钱学森第十二章：优先于q_rate判断）
    elapsed = datetime.now().timestamp() - launch_entry_time if launch_entry_time else 0

    # =============================================================
    # 第一步：紧急退出检查（q=0 表示过载已完全消退，无需继续等待）
    # 钱学森第十二章：q 是最直接的系统负载指标，q=0 意味着绝对安全
    # =============================================================
    if q_curr == 0 and q_rate <= 0 and n_proxy < 0.5:
        current_mode = "normal"
        launch_exit = True
        ewma_state["launch_entry_time"] = None
        ewma_state["mode"] = "normal"
        ewma_state["suppressed_cycles"] = 0
        ewma_state["launch_cooldown_until"] = datetime.now().timestamp() + 30
        adjustment_made = f"LAUNCH_EXIT(q=0) H={H:.3f} n={n_proxy:.2f} q_rate={q_rate:.2f}"
        adjust_type_this_run = "LAUNCH_exit"
        mode_note = "[LAUNCH_EXIT:q_empty]"

    # =============================================================
    # 第二步：萨奇图主动干预（钱学森第八章：LAUNCH期间主动调整max_c）
    # 无论哪个分支，在退出LAUNCH前都尝试使 n < 0.5（无条件稳定条件）
    # =============================================================
    elif not launch_exit:
        launch_capacity_adjusted = False
        if n_proxy > 0.5 and cur_max_c < 50:
            target_max_c = int(q_curr / 0.45) + 1
            target_max_c = max(cur_max_c + 1, min(target_max_c, 50))
            if target_max_c > cur_max_c:
                adjustment_made = 'LAUNCH_CAPACITY n=%.2f>0.5 -> max_c:%d->%d' % (n_proxy, cur_max_c, target_max_c)
                adjust_type_this_run = 'LAUNCH_capacity'
                cur_max_c = target_max_c
                launch_capacity_adjusted = True
                n_proxy = q_curr / cur_max_c

        if not launch_capacity_adjusted and (ewma_state.get("suppressed_cycles", 0) >= 10 or elapsed >= LAUNCH_TIMEOUT_SECS):
            # 只有在本次未做容量调整时才接受超时退出（钱学森第十二章）
            sc_before_reset = ewma_state.get("suppressed_cycles", 0)
            current_mode = "normal"
            launch_exit = True
            ewma_state["launch_entry_time"] = None
            ewma_state["mode"] = "normal"
            ewma_state["suppressed_cycles"] = 0
            ewma_state["launch_cooldown_until"] = datetime.now().timestamp() + 60
            adjustment_made = f"LAUNCH_TIMEOUT sc={sc_before_reset}→0 ({elapsed:.0f}s)"
            adjust_type_this_run = "LAUNCH_exit"
            mode_note = "[LAUNCH_EXIT_TIMEOUT]"
    elif q_rate > 0.1:
        # q正在上升：过载在建立，留在launch模式（钱学森第十二章）
        ewma_state["suppressed_cycles"] = ewma_state.get("suppressed_cycles", 0) + 1
        # 萨奇图主动干预：LAUNCH期间若n>0.5则提高容量使n<0.5（钱学森第八章：n<0.5无条件稳定）
        if n_proxy > 0.5 and cur_max_c < 50:
            target_max_c = int(q_curr / 0.45) + 1
            target_max_c = max(cur_max_c + 1, min(target_max_c, 50))
            if target_max_c > cur_max_c:
                adjustment_made = f"LAUNCH_CAPACITY n={n_proxy:.2f}>0.5 -> max_c:{cur_max_c}->{target_max_c}"
                adjust_type_this_run = "LAUNCH_capacity"
                cur_max_c = target_max_c
        

        mode_note = f"[LAUNCH_HOLDING:q_↑{q_rate:.2f}]"
    elif base_exit:
        if q_rate < -0.1:
            # q正在下降：过载消退信号，加速退出（钱学森第十二章）
            current_mode = "normal"
            launch_exit = True
            ewma_state["launch_entry_time"] = None
            ewma_state["mode"] = "normal"
            adjustment_made = f"LAUNCH_EXIT(q↓) H={H:.3f} n={n_proxy:.2f} q_rate={q_rate:.2f}"
            adjust_type_this_run = "LAUNCH_exit"
            mode_note = "[LAUNCH_EXIT:q_falling]"
        else:
            # q稳定且EWMA已收敛，正常退出
            current_mode = "normal"
            launch_exit = True
            ewma_state["launch_entry_time"] = None
            ewma_state["mode"] = "normal"
            adjustment_made = f"LAUNCH_EXIT H={H:.3f} n={n_proxy:.2f} q_rate={q_rate:.2f}"
            adjust_type_this_run = "LAUNCH_exit"
            mode_note = "[LAUNCH_EXIT]"
    else:
        # 未满足base_exit条件且q无上升信号：EWMA尚未收敛，留在launch并计数
        ewma_state["suppressed_cycles"] = ewma_state.get("suppressed_cycles", 0) + 1
        # 萨奇图主动干预：LAUNCH期间若n>0.5则提高容量使n<0.5（钱学森第八章：n<0.5无条件稳定）
        # 这是LAUNCH退出条件n<0.4的前置动作
        if n_proxy > 0.5 and cur_max_c < 50:
            target_max_c = int(q_curr / 0.45) + 1  # 使n回到0.45以下（留5%余量）
            target_max_c = max(cur_max_c + 1, min(target_max_c, 50))
            if target_max_c > cur_max_c:
                adjustment_made = f"LAUNCH_CAPACITY n={n_proxy:.2f}>0.5 → max_c:{cur_max_c}→{target_max_c}"
                adjust_type_this_run = "LAUNCH_capacity"
                cur_max_c = target_max_c
        mode_note = f"[LAUNCH_HOLDING:ΔH={delta_H:.3f} sc={ewma_state['suppressed_cycles']}]"

# 保存EWMA状态（mode字段每次都同步，防止残留旧状态）
if launch_enter or launch_exit:
    ewma_state["last_mode_change"] = datetime.now().isoformat()
ewma_state["mode"] = current_mode

# EWMA字段（统一在脚本末尾写入ewma_state）
ewma_state["H_fast"] = H_fast_new  # 注意：ewma_state是局部变量，这里是保存到局部dict
ewma_state["H_slow"] = H_slow_new
ewma_state["n_fast"] = n_fast_new
ewma_state["n_slow"] = n_slow_new
ewma_state["delta_H"] = delta_H
ewma_state["delta_n"] = delta_n
ewma_state["q_rate"] = q_rate

# === 第五部分：萨奇图增益调度 ===
current_zone = get_sagi_zone(n_proxy)
zc = dict(ewma_state.get("zone_consecutive", {}))
zc[current_zone] = zc.get(current_zone, 0) + 1
for old_z in ["overload", "desaturation"]:
    zc.pop(old_z, None)
for z in ["safe", "elevated", "critical"]:
    if z != current_zone:
        zc[z] = max(0, zc.get(z, 1) - 1)
ewma_state["zone_consecutive"] = zc

# === 控制效果跟踪（闭环反馈）===
# 评估上次调整是否有效，如果无效则回滚
prev_adjust = ewma_state.get("last_adjustment", {})
if prev_adjust:
    prev_n = prev_adjust.get("n_after", n_proxy)
    prev_H = prev_adjust.get("H_after", H)
    n_change = n_proxy - prev_n
    H_change = H - prev_H
    
    # 判断调整是否有效
    adjustment_was_good = False
    if prev_adjust.get("type") == "SAGI":
        # SAGI 调整后 n 应该下降或保持低
        adjustment_was_good = (n_change <= 0.05)  # n 没上升就算好
    elif prev_adjust.get("type") == "fuse":
        # fuse 后 n 应该明显下降
        adjustment_was_good = (n_proxy < 1.0)
    elif prev_adjust.get("type") == "LAUNCH_exit":
        # LAUNCH 退出后应该稳定
        adjustment_was_good = (delta_H < 0.1)
    
    # 如果连续2次调整无效，触发告警
    bad_adjust_count = ewma_state.get("bad_adjust_count", 0)
    if not adjustment_was_good:
        bad_adjust_count += 1
        ewma_state["bad_adjust_count"] = bad_adjust_count
        if bad_adjust_count >= 2:
            mode_note = "[ADJUST_WARN]"
    else:
        ewma_state["bad_adjust_count"] = 0

# 记录本次调整前的状态（供下次评估）
prev_n_for_next = n_proxy
prev_H_for_next = H
adjust_type_this_run = None  # 待本次控制逻辑填充

# === 第五部分：熔断检测 ===
fuse_state = {"fuse_triggered": False, "consecutive_diverging": 0, "consecutive_safe": 0}
try:
    fuse_state = json.load(open(FUSE_STATE))
except:
    pass

is_diverging = (H < 0.4 and L > 0.8)
fuse_state["consecutive_diverging"] = (fuse_state.get("consecutive_diverging", 0) + 1) if is_diverging else 0

fuse_triggered = fuse_state.get("fuse_triggered", False)
if not fuse_triggered and fuse_state["consecutive_diverging"] >= 3:
    fuse_triggered = True
    fuse_state["fuse_triggered"] = True
    fuse_state["fuse_triggered_at"] = datetime.now().isoformat()

# fuse恢复条件：明显在safe区(n<=0.3)或明显恢复(H>0.5且L<0.5)连续3次
# 理由：q=0时H=0.227（sr=0），不能要求H>0.5才能恢复
is_safe_for_recovery = (H > 0.5 and L < 0.5) or (n_proxy <= 0.3 and zc.get("safe", 0) >= 3)
ts = datetime.now().isoformat()
cur_on = config["SPAWN_ON_current"]
cur_off = config["SPAWN_OFF_current"]
cur_max_c = config["MAX_CONCURRENT_TASKS_current"]
last_adj_zone = ewma_state.get("last_adjusted_zone", "safe")
adjustment_made = ""

# fuse恢复：放在阈值调整之前，确保cur_on等已定义
if fuse_triggered:
    fuse_state["consecutive_safe"] = fuse_state.get("consecutive_safe", 0) + (1 if is_safe_for_recovery else 0)
    if fuse_state["consecutive_safe"] >= 3:
        fuse_triggered = False
        fuse_state["fuse_triggered"] = False
        fuse_state["fuse_triggered_at"] = None
        fuse_state["consecutive_safe"] = 0
        fuse_state["consecutive_diverging"] = 0
        adjustment_made = f"FUSE_RECOVERY fuse→safe ON:{cur_on}→45 max_c:{cur_max_c}→5"
        adjust_type_this_run = "fuse_recovery"
        cur_on, cur_off, cur_max_c = 45, 38, 5
        ewma_state["last_adjusted_zone"] = "safe"
        ewma_state["fuse_repeat_cycles"] = 0
        mode_note = "[fuse_recovery]"
else:
    fuse_state["consecutive_safe"] = 0

# fuse优先级最高：每次都要检查
if fuse_triggered:
    if last_adj_zone != "fuse" or ewma_state.get("fuse_repeat_cycles", 0) == 0:
        new_on = max(5, cur_on - 15)
        new_off = max(15, cur_off - 12)
        new_max_c = max(1, int(cur_max_c * 0.25))
        adjustment_made = f"FUSE ON:{cur_on}→{new_on} max_c:{cur_max_c}→{new_max_c}"
        adjust_type_this_run = "fuse"
        cur_on, cur_off, cur_max_c = new_on, new_off, new_max_c
        ewma_state["last_adjusted_zone"] = "fuse"
        ewma_state["suppressed_cycles"] = 0
        ewma_state["fuse_repeat_cycles"] = 1
        mode_note = "[fuse]"
    else:
        ewma_state["fuse_repeat_cycles"] = ewma_state.get("fuse_repeat_cycles", 0) + 1
        mode_note = "[fuse_active]"

elif not launch_exit and zc.get(current_zone, 0) >= 3 and current_zone != last_adj_zone and current_mode != "launch":
    don, doff, maxcf, gf, base_on, base_off = get_sagi_params(current_zone)
    # 钱学森：漂移态时减少干预，让系统自然恢复
    if is_drifting and trajectory == "toward_stable":
        # 漂移但轨迹指向稳定 → 减少干预
        don = int(don * 0.3)
        doff = int(doff * 0.3)
        maxcf = 1.0  # 不降max_c
        adjustment_made = f"SAGI_DRIFT {last_adj_zone}→{current_zone}(干预减少) ON:{cur_on}→{cur_on+don} max_c:{cur_max_c}"
        adjust_type_this_run = "SAGI"
        mode_note = f"[drift:{trajectory}]"
    else:
        adjustment_made = f"SAGI {last_adj_zone}→{current_zone} ON:{cur_on}→{cur_on+don} max_c:{cur_max_c}→{int(cur_max_c*maxcf)}(gf={gf})"
        adjust_type_this_run = "SAGI"
        # LAUNCH mode_note 保护：如果当前在 LAUNCH 模式，不覆盖 LAUNCH 相关 notes
        if current_mode == "launch":
            pass  # 保持 LAUNCH block 设置的 mode_note
        else:
            mode_note = f"[{current_zone}]"
    
    new_on = max(20, cur_on + don)
    new_off = max(15, cur_off + doff)
    new_max_c = max(1, int(cur_max_c * maxcf))
    if new_on != cur_on or new_max_c != cur_max_c:
        cur_on, cur_off, cur_max_c = new_on, new_off, new_max_c
        ewma_state["last_adjusted_zone"] = current_zone
        ewma_state["suppressed_cycles"] = 0

elif current_zone == "safe" and last_adj_zone in ["elevated", "critical", "overload", "desaturation", "launch"] and current_mode != "launch":
    # fuse状态走上面的独立fuse恢复分支，这里只处理非fuse的降增益后的恢复
    if zc.get("safe", 0) >= 3:
        adjustment_made = f"RECOVERY ON:{cur_on}→{cur_on} max_c:{cur_max_c}→5"
        cur_on, cur_off, cur_max_c = cur_on, cur_off, 5
        ewma_state["last_adjusted_zone"] = "safe"
        ewma_state["suppressed_cycles"] = 0
        mode_note = "[recovery]"

# === 统一状态机：合并两个控制回路 ===
# 在所有控制决策前计算统一状态，确保两个回路协调
unified_zone, unified_priority, unified_action = get_unified_state(region, current_zone, fuse_triggered)
ewma_state["unified_zone"] = unified_zone

# 漂移态特殊处理（钱学森：最危险的状态）
if is_drifting:
    mode_note += "[DRIFT]"
    ewma_state["drift_cycles"] = ewma_state.get("drift_cycles", 0) + 1
    # 漂移态：提高采样频率已在sagi-visualize.py体现，控制上不降增益
    # 但若漂移超过20cycle，强制窄滞环以增加响应速度
    if ewma_state.get("drift_cycles", 0) > 20:
        cur_on = min(cur_on + 1, 45)
        adjustment_made += f" DRIFT_TIMEOUT→ON+1({cur_on})"
else:
    ewma_state["drift_cycles"] = 0

# === 超时自动恢复：防止阈值永久压制 ===
SUPPRESSION_TIMEOUT = 10

if last_adj_zone in ["elevated", "critical", "fuse"] and current_mode != "launch":
    if current_zone in ["elevated", "safe"]:
        ewma_state["suppressed_cycles"] = ewma_state.get("suppressed_cycles", 0) + 1
        if ewma_state["suppressed_cycles"] >= SUPPRESSION_TIMEOUT:
            step_on = min(2, 45 - cur_on)
            step_off = min(2, 38 - cur_off)
            step_maxc = min(1, 5 - cur_max_c)
            if step_on > 0 or step_maxc > 0:
                adjustment_made = f"AUTO_RECOVERY ON:{cur_on}→{cur_on+step_on} max_c:{cur_max_c}→{cur_max_c+step_maxc}"
                cur_on += step_on
                cur_off += step_off
                cur_max_c += step_maxc
                ewma_state["last_adjusted_zone"] = current_zone
                ewma_state["suppressed_cycles"] = 0
    else:
        ewma_state["suppressed_cycles"] = 0
else:
    # last_adj_zone="launch" 且 current_mode="launch"：留在LAUNCH，pass（由LAUNCH_ENTER/HOLDING管理）
    # 其他情况：重置suppressed_cycles（表示不在LAUNCH也不在suppression）
    if current_mode != "launch":
        ewma_state["suppressed_cycles"] = 0

# === 写入配置（钱学森第十二章：模式状态每次都同步）===
# current_mode必须每次都写入（不受adjustment_made限制）
# 原因：ewma_state中的mode会被下次读取覆盖，只有YAML是持久化的
try:
    with open(CONFIG_FILE) as f:
        cfg = yaml.safe_load(f)
    if cfg is None: cfg = {}
    if "parameters" not in cfg: cfg["parameters"] = {}
    cfg["current_mode"] = current_mode  # 每次都同步
    if adjustment_made or mode_note:
        # 仅当有参数调整时才写参数块
        if "SPAWN_ON" in cfg["parameters"]:
            cfg["parameters"]["SPAWN_ON"]["current"] = cur_on
        if "SPAWN_OFF" in cfg["parameters"]:
            cfg["parameters"]["SPAWN_OFF"]["current"] = cur_off
        if "MAX_CONCURRENT_TASKS" in cfg["parameters"]:
            cfg["parameters"]["MAX_CONCURRENT_TASKS"]["current"] = cur_max_c
    with open(CONFIG_FILE, "w") as f:
        yaml.dump(cfg, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
except Exception as e:
    adjustment_made += f" [CFG_ERR:{e}]"

ewma_state["last_adjusted_at"] = ts

# 保存本次调整信息（供下次评估）
if adjust_type_this_run and adjustment_made:
    ewma_state["last_adjustment"] = {
        "type": adjust_type_this_run,
        "n_before": prev_n_for_next,  # 注：这是调整前的值
        "H_before": prev_H_for_next,
        "adjustment": adjustment_made,
        "at": ts
    }

# EWMA 状态备份（防文件损坏）
import shutil
EWMA_BACKUP = EWMA_STATE + ".bak"
shutil.copy2(EWMA_STATE, EWMA_BACKUP)
json.dump(ewma_state, open(EWMA_STATE, "w"))
json.dump(fuse_state, open(FUSE_STATE, "w"))

# === 第七部分：写入指标 ===
metric = {
    "ts": ts,
    "q_curr": q_curr, "q_total": q, "scored": scored, "spawned_proxy": spawned,
    "sr": round(sr, 4), "n_proxy": round(n_proxy, 2),
    "H": round(H, 4), "L": round(L, 4),
    "threshold": config["SCORE_THRESHOLD_current"],
    "max_c": cur_max_c,
    "mode": current_mode,
    "region": region,
    "spawn_on": cur_on,
    "spawn_off": cur_off,
    "sagi_zone": current_zone,
    "fuse_triggered": fuse_triggered,
    "is_drifting": is_drifting,
    "phase_H": round(H, 4),
    "phase_L": round(L, 4),
    "phase_trajectory": trajectory,  # 相平面轨迹（钱学森第十章）
    "phase_region": region,
}

with open(METRICS_FILE, "a") as f:
    f.write(json.dumps(metric) + "\n")

# 保留最近7天
cutoff = datetime.now() - timedelta(days=7)
try:
    lines = open(METRICS_FILE).readlines()
    kept = []
    for l in lines:
        try:
            obj2 = json.loads(l.strip())
            ts2 = datetime.fromisoformat(obj2['ts'].replace('Z', '+00:00'))
            if ts2 > cutoff:
                kept.append(l)
        except:
            pass
    open(METRICS_FILE, 'w').writelines(kept)
except:
    pass

# 输出
status_parts = [f"ts={ts[-14:]} q={q_curr} n={n_proxy:.2f} H={H:.3f} L={L:.3f}"]
status_parts.append(f"region={region} sagi={current_zone} unified={unified_zone}({unified_action}) fuse={'Y' if fuse_triggered else 'N'}")
if is_drifting:
    status_parts.append(f"DRIFT({drift_info})")
if trajectory != "unknown":
    status_parts.append(f"traj={trajectory}")
if mode_note:
    status_parts.append(mode_note)
print("[collect] " + " ".join(status_parts), flush=True)
if adjustment_made:
    print(f"[sagi] {adjustment_made}", flush=True)
