#!/usr/bin/env python3
"""
萨奇图增益调度器 (Sagi-Chart Gain Scheduler)
基于描述函数理论，当系统接近萨奇图边界时自动调整派发参数

理论依据：钱学森《工程控制论》第十章
- 当 |N(A)| 接近 1/|G(jω)| 边界时，系统进入非线性振荡区
- 通过降低开环增益K将工作点拉回稳定区

实现：n_proxy > SATURATION_THRESHOLD → 降低SPAWN_ON/SPAWN_OFF阈值
      n_proxy > OVERLOAD_THRESHOLD → 提高阈值并减少并发
"""
import os, json, sys

METRICS_FILE = os.path.expanduser("~/.openclaw/metrics/system_metrics.jsonl")
EWMA_STATE = os.path.expanduser("~/.openclaw/metrics/ewma_state.json")
CONFIG_FILE = os.path.expanduser("~/.openclaw/memory/CONTROL_META.yaml")
LOG_FILE = os.path.expanduser("~/.openclaw/metrics/sagi.log")

# 萨奇图边界（n_proxy标准化：1.0=满负载）
SATURATION_THRESHOLD = 0.5   # 萨奇图边界：n_proxy > 0.5 进入饱和区
OVERLOAD_THRESHOLD = 0.8     # 过载边界：n_proxy > 0.8 触发强降增益
CRITICAL_THRESHOLD = 0.95    # 临界振荡：n_proxy > 0.95 触发熔断

# 增益调度表（n_proxy越高，增益越低）
GAIN_SCHEDULE = {
    (0.0, 0.5):   {"gain_factor": 1.0,  "action": "normal",      "spawn_on_delta": 0,  "spawn_off_delta": 0,  "max_c_factor": 1.0},
    (0.5, 0.8):   {"gain_factor": 0.75, "action": "desaturation",  "spawn_on_delta": -5, "spawn_off_delta": -5, "max_c_factor": 0.8},
    (0.8, 0.95):  {"gain_factor": 0.5,  "action": "overload",      "spawn_on_delta": -10,"spawn_off_delta": -8, "max_c_factor": 0.5},
    (0.95, 1.0):  {"gain_factor": 0.25, "action": "critical",     "spawn_on_delta": -15,"spawn_off_delta": -12,"max_c_factor": 0.25},
}

# 反向滞环：恢复时使用更高阈值（防止过早回到高增益）
RECOVERY_HYSTERESIS = 0.15  # n_proxy降到 threshold - 0.15 后才提升增益

def log(msg):
    ts = __import__('datetime').datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[sagi] {ts} {msg}"
    print(line)
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except:
        pass

def get_current_gain_zone(n_proxy):
    """根据n_proxy返回当前增益区域"""
    for (low, high), params in GAIN_SCHEDULE.items():
        if low < n_proxy <= high:
            return (low, high), params
    if n_proxy <= 0.0:
        return (0.0, 0.5), GAIN_SCHEDULE[(0.0, 0.5)]
    return (0.95, 1.0), GAIN_SCHEDULE[(0.95, 1.0)]

def get_n_proxy_from_metrics():
    """从最新metrics获取n_proxy"""
    try:
        with open(METRICS_FILE) as f:
            lines = f.readlines()
        if not lines:
            return None
        obj = json.loads(lines[-1].strip())
        return obj.get("n_proxy", 0.0)
    except:
        return None

def get_ewma_state():
    """获取EWMA状态"""
    try:
        return json.load(open(EWMA_STATE))
    except:
        return {}

def get_previous_zone():
    """从上次记录获取之前的增益区域"""
    try:
        with open(EWMA_STATE) as f:
            state = json.load(f)
        return state.get("sagi_zone", "normal")
    except:
        return None

def compute_new_thresholds(current_spawn_on, current_spawn_off, params, zone, n_proxy):
    """根据增益区域计算新阈值"""
    delta_on = params["spawn_on_delta"]
    delta_off = params["spawn_off_delta"]
    
    new_on = max(20, current_spawn_on + delta_on)
    new_off = max(15, current_spawn_off + delta_off)
    
    return new_on, new_off

def update_control_meta(spawn_on, spawn_off, mode):
    """更新CONTROL_META.yaml"""
    try:
        lines = open(CONFIG_FILE).readlines()
        new_lines = []
        for line in lines:
            if line.startswith("SPAWN_ON:") and "current:" in line:
                new_lines.append(line[:line.find("current:")] + f"current: {spawn_on}\n")
            elif line.startswith("SPAWN_OFF:") and "current:" in line:
                new_lines.append(line[:line.find("current:")] + f"current: {spawn_off}\n")
            elif line.startswith("current_mode:") and mode != "normal":
                new_lines.append(f"current_mode: {mode}\n")
            else:
                new_lines.append(line)
        
        with open(CONFIG_FILE, "w") as f:
            f.writelines(new_lines)
        return True
    except Exception as e:
        log(f"Failed to update CONTROL_META: {e}")
        return False

def compute_max_concurrent(current_max_c, params):
    """根据增益因子计算新的最大并发"""
    return max(1, int(current_max_c * params["max_c_factor"]))

def main():
    n_proxy = get_n_proxy_from_metrics()
    if n_proxy is None:
        log("No metrics data available")
        return

    ewma = get_ewma_state()
    (low, high), params = get_current_gain_zone(n_proxy)
    zone = params["action"]
    prev_zone = get_previous_zone()
    
    # 从metrics获取当前阈值
    try:
        with open(METRICS_FILE) as f:
            last = json.loads(f.readlines()[-1].strip())
        current_spawn_on = int(last.get("spawn_on", 45))
        current_spawn_off = int(last.get("spawn_off", 38))
        current_max_c = int(last.get("max_c", 5))
    except:
        current_spawn_on = 45
        current_spawn_off = 38
        current_max_c = 5

    log(f"状态: n_proxy={n_proxy:.3f} zone={zone} (区间{low}-{high}) prev_zone={prev_zone}")
    
    # 只有区域变化时才更新阈值（防止频繁调整）
    if zone != prev_zone:
        new_on, new_off = compute_new_thresholds(current_spawn_on, current_spawn_off, params, zone, n_proxy)
        new_max_c = compute_max_concurrent(current_max_c, params)
        
        log(f"⚡ 增益调度触发: {prev_zone} → {zone}")
        log(f"   SPAWN_ON: {current_spawn_on} → {new_on} (Δ{delta_on:=new_on-current_spawn_on})")
        log(f"   SPAWN_OFF: {current_spawn_off} → {new_off} (Δ{delta_off:=new_off-current_spawn_off})")
        log(f"   max_concurrent: {current_max_c} → {new_max_c}")
        log(f"   增益因子: {params['gain_factor']:.2f}")
        
        update_control_meta(new_on, new_off, zone)
        
        # 记录区域变化
        try:
            state = json.load(open(EWMA_STATE)) if os.path.exists(EWMA_STATE) else {}
        except:
            state = {}
        state["sagi_zone"] = zone
        state["sagi_n_proxy"] = n_proxy
        state["sagi_last_change"] = __import__('datetime').datetime.now().isoformat()
        json.dump(state, open(EWMA_STATE, "w"))
    else:
        log(f"区域稳定: {zone}，无需调整阈值")

if __name__ == "__main__":
    main()
