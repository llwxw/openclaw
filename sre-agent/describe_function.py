#!/usr/bin/env python3
"""
描述函数 K(n) - Agent能力曲线
理论依据：钱学森工程控制论第十一章

K(n) = K_max · (1-(n/n_max)^p)  当 n < n_max 时（线性衰减区）
K(n) = K_sat                         当 n ≥ n_max 时（饱和区）

参数：
- K_max: 最大能力（n=0时）
- n_max: 饱和起始点（负载阈值）
- p: 衰减指数（描述非线性程度）
"""

import json, yaml, os

METRICS_DIR = os.path.expanduser("~/.openclaw/metrics")
EWMA_STATE = os.path.join(METRICS_DIR, "ewma_state.json")

def load_describing_function_config():
    """从CONTROL_META.yaml加载描述函数参数"""
    config_path = os.path.expanduser("~/.openclaw/memory/CONTROL_META.yaml")
    try:
        with open(config_path) as f:
            config = yaml.safe_load(f)
        df = config.get("describing_function", {})
        # 场景默认参数
        defaults = {
            "K_max": 0.95,
            "n_max": 8.0,
            "p": 2.0,
            "K_sat": 0.1
        }
        # 返回各场景参数
        return {scene: {**defaults, **params} for scene, params in df.items()}
    except:
        # 返回默认参数
        return {
            "default": {"K_max": 0.95, "n_max": 8.0, "p": 2.0, "K_sat": 0.1}
        }

def compute_K(n, scene="default", params=None):
    """
    计算描述函数值 K(n)
    
    参数：
    - n: 当前负载率（n_proxy）
    - scene: 场景类型（chitchat/code_generation/fault_recovery等）
    - params: 可选，指定K_max/n_max/p/K_sat
    
    返回：
    - K(n): Agent能力系数 [0, K_max]
    """
    if params is None:
        config = load_describing_function_config()
        params = config.get(scene, config.get("default", {}))
    
    K_max = params.get("K_max", 0.95)
    n_max = params.get("n_max", 8.0)
    p = params.get("p", 2.0)
    K_sat = params.get("K_sat", 0.1)
    
    if n >= n_max:
        # 饱和区
        return K_sat
    elif n <= 0:
        # 空载
        return K_max
    else:
        # 线性衰减区
        return K_max * (1 - (n / n_max) ** p)

def compute_success_probability(K):
    """
    基于描述函数计算任务成功概率
    
    参数：
    - K: Agent能力系数 [0, K_max]
    
    返回：
    - P_success: 成功概率 [0, 1]
    """
    # 归一化K到[0,1]
    K_normalized = K / 0.95  # 假设K_max=0.95
    return max(0.0, min(1.0, K_normalized))

def predict_queue_stability(n, K):
    """
    预测队列稳定性
    
    参数：
    - n: 当前负载率
    - K: Agent能力系数
    
    返回：
    - stable: 是否稳定
    - confidence: 置信度 [0, 1]
    """
    # 稳定性条件：K > n（能力 > 负载）
    stable = K > n * 0.5  # 保守阈值：能力 > 50%负载
    confidence = min(K / 0.95, 1.0)  # 基于能力置信度
    
    return stable, confidence

def main():
    """主函数：计算当前系统描述函数状态"""
    print("[K(n)] 描述函数模块启动...")
    
    # 加载配置
    config = load_describing_function_config()
    print(f"[K(n)] 已加载 {len(config)} 个场景配置")
    
    # 读取当前状态
    try:
        with open(EWMA_STATE) as f:
            ewma = json.load(f)
        n = ewma.get("n_proxy", 0)
        q = ewma.get("q_curr", 0)
        print(f"[K(n)] 当前状态: n={n:.3f}, q={q}")
    except:
        print("[K(n)] 无法读取ewma_state，使用默认值n=0")
        n = 0
    
    # 计算各场景K值
    print(f"\n[K(n)] 各场景能力系数:")
    for scene in ["chitchat", "code_generation", "fault_recovery", "math_reasoning"]:
        if scene in config:
            params = config[scene]
            K = compute_K(n, scene)
            P = compute_success_probability(K)
            stable, conf = predict_queue_stability(n, K)
            print(f"  {scene:20s}: K={K:.3f}, P_success={P:.1%}, stable={stable}")
    
    # 计算默认K值
    K_default = compute_K(n)
    P_default = compute_success_probability(K_default)
    stable, conf = predict_queue_stability(n, K_default)
    print(f"  {'default':20s}: K={K_default:.3f}, P_success={P_default:.1%}, stable={stable}")
    
    # 保存结果
    result = {
        "n": n,
        "K": K_default,
        "P_success": P_default,
        "stable": stable,
        "confidence": conf
    }
    output_path = os.path.join(METRICS_DIR, "describe_function.json")
    with open(output_path, "w") as f:
        json.dump(result, f, indent=2)
    print(f"\n[K(n)] 结果已保存到 {output_path}")
    print(f"[K(n)] 稳定性判断: {'稳定' if stable else '不稳定'} (置信度: {conf:.1%})")

if __name__ == "__main__":
    main()
