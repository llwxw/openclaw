#!/usr/bin/env python3
"""
EWMA变化检测器 + 控制模式切换
基于双EWMA差值检测非平稳变化，触发"发射段模式"
同时根据n_proxy触发萨奇图降增益
每分钟运行（由cron调用）
"""
import os, json, yaml
from datetime import datetime, timedelta

METRICS_FILE = os.path.expanduser("~/.openclaw/metrics/system_metrics.jsonl")
EWMA_STATE_FILE = os.path.expanduser("~/.openclaw/metrics/ewma_state.json")
CONFIG_FILE = os.path.expanduser("~/.openclaw/memory/CONTROL_META.yaml")
AUDIT_FILE = os.path.expanduser("~/.openclaw/metrics/decision_audit.jsonl")
SATCHKUS_LOG = os.path.expanduser("~/.openclaw/metrics/satchkus.log")

# EWMA参数
ALPHA_FAST = 0.6   # 快滤波器（对当前值敏感）
ALPHA_SLOW = 0.1   # 慢滤波器（趋势追踪）
CHANGE_THRESHOLD = 0.12  # 触发发射段模式的偏差阈值

# 萨奇图参数
N_SATCHKUS_THRESHOLD = 0.5  # n_proxy超过此值则降增益

def load_state():
    try:
        with open(EWMA_STATE_FILE) as f:
            return json.load(f)
    except:
        return {"H_fast": None, "H_slow": None, "n_fast": None, "n_slow": None}

def save_state(state):
    with open(EWMA_STATE_FILE, "w") as f:
        json.dump(state, f)

def load_config():
    try:
        with open(CONFIG_FILE) as f:
            return yaml.safe_load(f)
    except:
        return {}

def save_config(data):
    with open(CONFIG_FILE, "w") as f:
        yaml.dump(data, f, allow_unicode=True, default_flow_style=False)

def log_audit(action, details):
    entry = {"ts": datetime.now().isoformat(), "action": action, **details}
    with open(AUDIT_FILE, "a") as f:
        f.write(json.dumps(entry) + "\n")

def get_latest_metric():
    try:
        with open(METRICS_FILE) as f:
            lines = f.readlines()
        if not lines:
            return None
        return json.loads(lines[-1].strip())
    except:
        return None

def ewma(prev, current, alpha):
    if prev is None:
        return current
    return alpha * current + (1 - alpha) * prev

def main():
    metric = get_latest_metric()
    if metric is None:
        print("[ewma] no metrics available")
        return

    state = load_state()
    config = load_config()

    H = metric.get("H", 0.5) or 0.5
    n_proxy = metric.get("n_proxy", 0) or 0

    # 更新EWMA
    H_fast_new = ewma(state.get("H_fast"), H, ALPHA_FAST)
    H_slow_new = ewma(state.get("H_slow"), H, ALPHA_SLOW)
    n_fast_new = ewma(state.get("n_fast"), n_proxy, ALPHA_FAST)
    n_slow_new = ewma(state.get("n_slow"), n_proxy, ALPHA_SLOW)

    # 检测变化
    delta_H = abs(H_fast_new - H_slow_new)
    delta_n = abs(n_fast_new - n_slow_new)

    state["H_fast"] = H_fast_new
    state["H_slow"] = H_slow_new
    state["n_fast"] = n_fast_new
    state["n_slow"] = n_slow_new
    state["last_update"] = datetime.now().isoformat()

    changes = []

    # === 检测1: 发射段模式触发（变化检测）===
    current_mode = config.get("current_mode", "normal")
    if current_mode != "launch":
        if delta_H > CHANGE_THRESHOLD or delta_n > 0.3:
            if current_mode != "conservative":
                print(f"[ewma] 触发发射段模式: delta_H={delta_H:.3f} delta_n={delta_n:.3f}")
                config["current_mode"] = "launch"
                changes.append(("enter_launch", {"reason": "ewma_change", "delta_H": delta_H, "delta_n": delta_n}))
                log_audit("enter_launch", {"reason": "ewma_change", "delta_H": delta_H, "delta_n": delta_n})
    else:
        # 发射段模式：等待稳定后退出
        if delta_H < CHANGE_THRESHOLD * 0.5 and delta_n < 0.15:
            if H > 0.6 and n_proxy < 0.4:
                print(f"[ewma] 退出发射段模式，回归normal")
                config["current_mode"] = "normal"
                changes.append(("exit_launch", {"H": H, "n_proxy": n_proxy}))
                log_audit("exit_launch", {"H": H, "n_proxy": n_proxy})

    # === 检测2: 萨奇图无条件稳定性 ===
    if n_proxy > N_SATCHKUS_THRESHOLD:
        params = config.get("parameters", {})
        max_c = params.get("MAX_CONCURRENT_TASKS", {}).get("current", 5)
        threshold = params.get("SCORE_THRESHOLD", {}).get("current", 40)
        
        # 降增益策略：降低max_concurrent或提高threshold
        if max_c > 2:
            new_max_c = max(2, int(max_c * 0.7))
            params["MAX_CONCURRENT_TASKS"]["current"] = new_max_c
            config["parameters"] = params
            
            msg = f"萨奇图降增益: max_concurrent {max_c} -> {new_max_c} (n_proxy={n_proxy:.2f} > {N_SATCHKUS_THRESHOLD})"
            print(f"[satchkus] {msg}")
            changes.append(("satchkus_reduce", {"max_c": max_c, "new_max_c": new_max_c, "n_proxy": n_proxy}))
            log_audit("satchkus_reduce", {"max_c": max_c, "new_max_c": new_max_c, "n_proxy": n_proxy})
            
            # 同步记录
            with open(SATCHKUS_LOG, "a") as f:
                f.write(f"{datetime.now().isoformat()} {msg}\n")

    # === 保存状态 ===
    save_state(state)
    save_config(config)

    # 打印摘要
    if changes:
        for action, details in changes:
            print(f"  [{action}] {details}")
    else:
        print(f"[ewma] 无变化 H_fast={H_fast_new:.3f} H_slow={H_slow_new:.3f} delta_H={delta_H:.3f} n_proxy={n_proxy:.2f} mode={config.get('current_mode')}")

if __name__ == '__main__':
    main()
