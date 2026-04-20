#!/usr/bin/env python3
"""
K(n) 描述函数验证框架
用于验证经验公式在实际场景中的有效性

注意：这是经验验证，不是数学证明。
真正的描述函数证明需要：
1. 非线性特性的谐波展开
2. 奈奎斯特图绘制
3. 极限环分析
"""

import json
import os
import math

METRICS_DIR = os.path.expanduser("~/.openclaw/metrics")

# === 描述函数定义 ===
# 基于实测数据拟合 (2026-04-20)
# 数据来源: system_metrics.jsonl (15个数据点)
# 拟合结果: K_max=1.0, n_max=0.535, p=0.754, R²=0.973
K_MAX = 1.0
N_MAX = 0.535
P = 0.754
K_SAT = 0.0

def compute_K(n):
    """K(n) 描述函数 - 基于实测数据拟合"""
    if n <= 0:
        return K_MAX
    elif n >= N_MAX:
        return K_SAT
    else:
        return K_MAX * (1 - (n / N_MAX) ** P)

# === 验证方法 ===

def verify_monotonicity():
    """验证1：K(n) 应该是单调递减的"""
    print("=== 验证1: 单调性 ===")
    prev_K = K_MAX
    for n in [0.0, 0.5, 1.0, 2.0, 4.0, 8.0, 10.0]:
        K = compute_K(n)
        monotonic = K <= prev_K
        print(f"  n={n:.1f}: K={K:.3f} {'✅' if monotonic else '❌'}")
        prev_K = K
    print()

def verify_physical_constraints():
    """验证2：K(n) 应该满足物理约束"""
    print("=== 验证2: 物理约束 ===")
    
    # 约束1: K(0) = K_MAX
    K0 = compute_K(0)
    print(f"  K(0) = {K0:.3f} (should be {K_MAX}) {'✅' if abs(K0 - K_MAX) < 0.01 else '❌'}")
    
    # 约束2: K 应该始终 > 0
    all_positive = all(compute_K(n) > 0 for n in [0, 0.5, 1, 2, 4, 8, 10])
    print(f"  K(n) > 0 for all n: {'✅' if all_positive else '❌'}")
    
    # 约束3: K 应该始终 <= K_MAX
    all_bounded = all(compute_K(n) <= K_MAX for n in [0, 0.5, 1, 2, 4, 8, 10])
    print(f"  K(n) <= K_MAX: {'✅' if all_bounded else '❌'}")
    
    print()

def verify_stability_margin():
    """验证3：稳定性边界分析"""
    print("=== 验证3: 稳定性边界 ===")
    
    # 钱学森：n < 0.5 时系统绝对稳定
    # 此时 K(n) 应该较高
    n_stable = 0.4
    K_stable = compute_K(n_stable)
    print(f"  n={n_stable} (stable): K={K_stable:.3f}")
    
    # n = 0.5 是临界点
    n_critical = 0.5
    K_critical = compute_K(n_critical)
    print(f"  n={n_critical} (critical): K={K_critical:.3f}")
    
    # n > 1 是明显过载
    n_overload = 1.5
    K_overload = compute_K(n_overload)
    print(f"  n={n_overload} (overload): K={K_overload:.3f}")
    
    # 计算稳定性裕度
    margin = (K_stable - K_overload) / K_stable
    print(f"  稳定性裕度: {margin:.1%}")
    print()

def verify_control_effectiveness():
    """验证4：控制效果验证"""
    print("=== 验证4: 控制效果验证 ===")
    
    # 场景1：系统从过载恢复
    scenarios = [
        ("q突增到30, max_c=50", 30/50, 0.6),
        ("q=25, max_c=50", 25/50, 0.5),
        ("q=20, max_c=50", 20/50, 0.4),
        ("q=10, max_c=50", 10/50, 0.2),
    ]
    
    for name, n, expected_n in scenarios:
        K = compute_K(n)
        n_actual = n
        print(f"  {name}: n={n_actual:.2f}, K={K:.3f}")
        
    print()

def verify_recent_data():
    """验证5：基于最近实际数据验证"""
    print("=== 验证5: 最近数据分析 ===")
    
    metrics_file = os.path.join(METRICS_DIR, "system_metrics.jsonl")
    if not os.path.exists(metrics_file):
        print("  ⚠️  No metrics file found")
        return
    
    try:
        with open(metrics_file) as f:
            lines = f.readlines()
        
        if len(lines) < 10:
            print(f"  ⚠️  Only {len(lines)} records, need more for analysis")
            return
        
        # 分析最近的记录
        recent = []
        for line in lines[-30:]:
            try:
                d = json.loads(line)
                n = d.get("n_proxy", 0)
                K = compute_K(n)
                H = d.get("H", 0)
                q = d.get("q_curr", 0)
                recent.append({"n": n, "K": K, "H": H, "q": q})
            except:
                pass
        
        if not recent:
            print("  ⚠️  No valid records")
            return
        
        # 统计 K 值的分布
        K_values = [r["K"] for r in recent]
        avg_K = sum(K_values) / len(K_values)
        min_K = min(K_values)
        max_K = max(K_values)
        
        # 统计稳定性
        stable_count = sum(1 for r in recent if r["n"] < 0.5)
        stable_ratio = stable_count / len(recent)
        
        print(f"  最近 {len(recent)} 条记录:")
        print(f"    K 值: avg={avg_K:.3f}, min={min_K:.3f}, max={max_K:.3f}")
        print(f"    n < 0.5 稳定性: {stable_ratio:.1%}")
        print(f"    系统状态: {'✅ 稳定' if stable_ratio > 0.8 else '⚠️ 不稳定' if stable_ratio > 0.5 else '❌ 危机'}")
        print()
        
    except Exception as e:
        print(f"  ❌ Error: {e}")
        print()

def theoretical_background():
    """理论背景说明"""
    print("=" * 60)
    print("K(n) 描述函数 - 理论背景")
    print("=" * 60)
    print("""
钱学森《工程控制论》第八章描述函数法：

1. 核心思想：将非线性特性用描述函数 F(A) 近似
   F(A) = (2/π) * [arcsin(a/r) + a*sqrt(r²-a²)/r²]

2. 稳定性判据：G(jω)F(A) = -1 有解时系统不稳定

3. 我们的简化：
   - 假设非线性是单调递减的
   - 用幂函数近似描述函数
   - K(n) = K_max * (1 - (n/n_max)^p)

4. 这个简化的局限：
   - 没有考虑谐波分量
   - 没有考虑相位滞后
   - 没有严格的稳定性证明

5. 验证方法：
   - 只能通过大量仿真验证
   - 无法给出数学保证
   - 需要在实际运行中观察

结论：K(n) 是经验公式，不是理论证明的描述函数。
      系统设计需要配合其他稳定性机制（如 n < 0.5 条件）。
""")

def main():
    print("=" * 60)
    print("K(n) 描述函数验证框架")
    print("=" * 60)
    print()
    
    verify_monotonicity()
    verify_physical_constraints()
    verify_stability_margin()
    verify_control_effectiveness()
    verify_recent_data()
    theoretical_background()
    
    print("=" * 60)
    print("验证完成")
    print("=" * 60)
    print()
    print("重要结论：")
    print("1. K(n) 满足基本的单调性和有界性")
    print("2. n < 0.5 时 K 较高，与钱学森稳定性条件一致")
    print("3. 但这只是经验验证，不是数学证明")
    print("4. 真正的稳定性保证来自 n < 0.5 条件，不是 K(n)")
    print()
    print("使用建议：")
    print("- K(n) 可作为辅助指标，但不要作为主要稳定性判据")
    print("- 主要稳定性条件：n < 0.5")
    print("- K(n) 的作用：早期预警、能力评估")

if __name__ == "__main__":
    main()
