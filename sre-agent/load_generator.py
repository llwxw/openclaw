#!/usr/bin/env python3
"""
K(n) 参数标定实验
通过人为制造不同负载，采集 sr(成功率) 数据
然后拟合 K(n) = K_max * (1 - (n/n_max)^p) 的参数
"""

import os
import json
import time
import subprocess
import yaml
from datetime import datetime

METRICS_DIR = os.path.expanduser("~/.openclaw/metrics")
CONFIG_FILE = os.path.expanduser("~/.openclaw/memory/CONTROL_META.yaml")

def read_current_state():
    """读取当前系统状态"""
    state_file = os.path.join(METRICS_DIR, "ewma_state.json")
    try:
        with open(state_file) as f:
            return json.load(f)
    except:
        return {}

def get_current_max_c():
    """获取当前 max_c"""
    try:
        with open(CONFIG_FILE) as f:
            cfg = yaml.safe_load(f)
            return cfg.get("parameters", {}).get("MAX_CONCURRENT_TASKS", {}).get("current", 50)
    except:
        return 50

def set_load_level(q_target, max_c_target):
    """
    设置负载等级
    这需要实际注入任务，不是只改参数
    """
    pass  # TODO: 需要实际注入任务

def run_experiment():
    """
    实验设计：
    
    目标：测量不同 n = q/max_c 下的 sr(成功率)
    
    方法：
    1. 设置 max_c = 50 (固定)
    2. 注入不同数量的任务 q = 5, 10, 15, 20, 25, 30
    3. 等待任务完成
    4. 记录 sr 和 n
    5. 重复多次取平均
    
    注意：这需要 OpenClaw 实际执行任务，不是模拟
    """
    print("=" * 60)
    print("K(n) 参数标定实验")
    print("=" * 60)
    print()
    
    print("⚠️  警告：这个实验需要实际注入任务到 OpenClaw")
    print()
    print("实验设计：")
    print("1. 设置 max_c = 50")
    print("2. 注入 q = 5, 10, 15, 20, 25, 30 个任务")
    print("3. 记录每次的 sr(成功率)")
    print("4. 用数据拟合 K(n) = K_max * (1 - (n/n_max)^p)")
    print()
    
    max_c = 50
    results = []
    
    # 读取最近的数据（如果有）
    metrics_file = os.path.join(METRICS_DIR, "system_metrics.jsonl")
    if os.path.exists(metrics_file):
        print("分析历史数据...")
        with open(metrics_file) as f:
            lines = f.readlines()
        
        # 收集不同 n 下的 sr
        n_sr_pairs = {}
        for line in lines[-1000:]:  # 最近1000条
            try:
                d = json.loads(line)
                n = d.get("n_proxy", 0)
                sr = d.get("sr", 0)
                if n > 0 and sr > 0:
                    bucket = round(n, 1)
                    if bucket not in n_sr_pairs:
                        n_sr_pairs[bucket] = []
                    n_sr_pairs[bucket].append(sr)
            except:
                pass
        
        if n_sr_pairs:
            print(f"找到 {len(n_sr_pairs)} 个不同的 n 值")
            for n, sr_list in sorted(n_sr_pairs.items()):
                avg_sr = sum(sr_list) / len(sr_list)
                results.append((n, avg_sr))
                print(f"  n={n:.1f}: sr={avg_sr:.3f} (样本数={len(sr_list)})")
        else:
            print("⚠️  没有足够的 variation 数据")
            print()
            print("当前系统状态: q=0, 无负载，无法标定")
    else:
        print("⚠️  没有历史数据文件")
    
    print()
    
    # 输出拟合建议
    print("=" * 60)
    print("拟合建议")
    print("=" * 60)
    print()
    print("如果收集到足够数据，可以用以下方法拟合：")
    print()
    print("```python")
    print("import numpy as np")
    print("from scipy.optimize import curve_fit")
    print()
    print("# 定义模型")
    print("def K_model(n, K_max, n_max, p):")
    print("    return K_max * (1 - (n / n_max) ** p)")
    print()
    print("# 拟合")
    print("n_data = np.array([n for n, sr in results])")
    print("sr_data = np.array([sr for n, sr in results])")
    print("popt, pcov = curve_fit(K_model, n_data, sr_data, p0=[0.95, 8.0, 2.0])")
    print("K_max, n_max, p = popt")
    print("print(f'K_max={K_max:.3f}, n_max={n_max:.2f}, p={p:.2f}')")
    print("```")
    print()
    
    # 理论分析
    print("=" * 60)
    print("理论分析")
    print("=" * 60)
    print()
    print("基于 queueing theory 的预测：")
    print()
    print("1. 低负载 (n < 0.3): sr ≈ 0.9-1.0")
    print("   原因：资源充足，任务并行执行")
    print()
    print("2. 中负载 (0.3 < n < 0.7): sr ≈ 0.6-0.9")
    print("   原因：资源竞争，排队延迟")
    print()
    print("3. 高负载 (n > 0.7): sr 急剧下降")
    print("   原因：系统饱和，上下文切换开销")
    print()
    print("4. 临界点 (n ≈ 0.5): sr 开始明显下降")
    print("   原因：这就是为什么 n < 0.5 是稳定条件")
    print()
    
    print("=" * 60)
    print("结论")
    print("=" * 60)
    print()
    print("当前数据不足以精确标定 K(n)。")
    print()
    print("需要：")
    print("1. 主动制造不同负载 (q = 5,10,15,20,25,30)")
    print("2. 每个负载重复 5-10 次")
    print("3. 记录 sr 和计算 K = sr (如果假设 sr ∝ K)")
    print("4. 用 scipy.optimize.curve_fit 拟合参数")
    print()
    print("或者：")
    print("1. 运行 wiki-learn 或其他任务")
    print("2. 积累足够的历史 variation")
    print("3. 用历史数据拟合")
    
    return results

def estimate_K_from_theory():
    """
    基于理论的 K(n) 估计
    使用 M/M/1 队列的近似公式
    """
    print()
    print("=" * 60)
    print("理论估计 (M/M/1 近似)")
    print("=" * 60)
    print()
    
    # M/M/1 队列：throughput = λ/(μ-λ) = ρ/(1-ρ)
    # 其中 ρ = λ/μ = n (利用率)
    # 延迟 D = 1/(μ-λ) = 1/μ * 1/(1-ρ)
    
    # 假设 sr ∝ 1/latency ∝ 1/D
    # 则 sr ∝ (1-ρ) = (1-n)
    
    # 但实际上不是线性关系，需要修正
    
    print("简化模型: sr(n) ≈ sr_max * (1 - n/n_max)^p")
    print()
    print("参数估计:")
    print("  n_max ≈ 1.0 (当 n=1 时 sr 应该接近 0)")
    print("  p ≈ 1.5-2.0 (非线性程度)")
    print("  K_max ≈ 0.95 (零负载极限)")
    print()
    
    print("当前使用的参数:")
    print("  K_max = 0.95 (合理)")
    print("  n_max = 8.0 (太大！)")
    print("  p = 2.0 (合理)")
    print()
    
    print("建议修正:")
    print("  n_max = 1.0 → 0.8 (接近饱和点)")
    print("  或者保持 n_max = 8.0 但重新解释含义")
    print()
    
    print("真正的问题是: n 本身是 q/max_c")
    print("  max_c 是容量，n = q/max_c")
    print("  当 n = 1 时，q = max_c，系统满载")
    print("  当 n > 1 时，队列堆积，系统不稳定")
    print()
    
    print("所以 K(n) 的定义应该是:")
    print("  K(n) = 能力 / 在队列 n 下的最大可能能力")
    print("  当 n=0, K=1 (最佳)")
    print("  当 n=1, K→0 (饱和)")
    print("  当 n>1, K=0 (过载)")
    print()
    
    print("修正建议:")
    print("  K(n) = max(0, 1 - n^p)  (简单形式)")
    print("  或 K(n) = exp(-α*n^p)  (指数形式)")
    print()
    
    return {
        "current": {"K_max": 0.95, "n_max": 8.0, "p": 2.0},
        "theoretical": {"K_max": 1.0, "n_max": 1.0, "p": 1.5},
    }

if __name__ == "__main__":
    results = run_experiment()
    params = estimate_K_from_theory()
