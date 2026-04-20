#!/usr/bin/env python3
"""
SRE 自我调控系统 - 单元测试
测试 collect-metrics.py 核心函数
"""

import sys
import importlib.util

# 动态导入 collect_metrics
spec = importlib.util.spec_from_file_location("collect_metrics", "/home/ai/.openclaw/sre-agent/collect-metrics.py")
cm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cm)

get_sagi_zone = cm.get_sagi_zone
get_sagi_params = cm.get_sagi_params
classify = cm.classify
EWMA_STATE = cm.EWMA_STATE
FUSE_STATE = cm.FUSE_STATE
SAGI_ZONES = cm.SAGI_ZONES

def test_get_sagi_zone():
    """测试 SAGI zone 分类"""
    print("=== test_get_sagi_zone ===")
    tests = [
        (0.0, "safe"),
        (0.3, "safe"),
        (0.5, "safe"),
        (0.51, "elevated"),
        (0.7, "elevated"),
        (0.8, "elevated"),
        (0.81, "critical"),
        (1.0, "critical"),
        (5.0, "critical"),
    ]
    for n, expected in tests:
        result = get_sagi_zone(n)
        status = "✅" if result == expected else "❌"
        print(f"  {status} n={n} → {result} (expected {expected})")
    print()

def test_get_sagi_params():
    """测试 SAGI 参数获取"""
    print("=== test_get_sagi_params ===")
    tests = [
        ("safe",       (0, 0, 1.0, 1.0, 42, 38)),
        ("elevated",   (-8, -8, 0.6, 0.6, 45, 38)),
        ("critical",   (15, 12, 2.0, 1.0, 50, 45)),
        ("unknown",    (0, 0, 1.0, 1.0, 45, 38)),
    ]
    for zone, expected in tests:
        result = get_sagi_params(zone)
        status = "✅" if result == expected else "❌"
        print(f"  {status} zone={zone} → {result} (expected {expected})")
    print()

def test_classify():
    """测试 classify 五态分类"""
    print("=== test_classify ===")
    # (q, sr, n, expected_region)
    tests = [
        (0, 0.9, 0.1, "stable"),      # H=0.94, L=0.05
        (5, 0.3, 0.2, "stable"),      # H=0.9, L=0.1
        (10, 0.2, 0.4, "stable"),     # H=0.67, L=0.2 (not warning - H>0.5)
        (20, 0.5, 0.8, "stable"),    # H=0.6, L=0.4 (not overload - L<0.5)
        (30, 0.1, 1.5, "diverging"),  # H=0.13, L=0.75 (H<0.4且L>0.5)
        (0, 0.0, 0.0, "stable"),      # H=0.6, L=0.0 (sr=0但H>0.5)
        (30, 0.4, 1.5, "warning"),      # H=0.4, L=0.75 (H<0.5 triggers warning, H=0.4 NOT<0.4)
        (30, 0.05, 1.5, "diverging"),  # H=0.07, L=0.75 (diverging now reachable after fix)
        (25, 0.6, 1.2, "overload"),    # H=0.5, L=0.6 (L>0.5且H>0.4)
    ]
    for q, sr, n, expected in tests:
        region, H, L = classify(q, sr, n)
        status = "✅" if region == expected else "❌"
        print(f"  {status} q={q} sr={sr} n={n} → {region} (expected {expected}) H={H:.2f} L={L:.2f}")
    print()

def test_n_proxy_math():
    """测试 n_proxy 数学定义"""
    print("=== test_n_proxy_math ===")
    tests = [
        (10, 50, 0.2),
        (20, 50, 0.4),
        (30, 50, 0.6),
        (25, 20, 1.25),
    ]
    for q, max_c, expected_n in tests:
        calc_n = q / max_c
        status = "✅" if abs(calc_n - expected_n) < 0.01 else "❌"
        print(f"  {status} q={q} / max_c={max_c} = {calc_n:.2f} (expected {expected_n})")
    print()

def test_fuse_trigger_condition():
    """测试熔断触发条件"""
    print("=== test_fuse_trigger ===")
    tests = [
        (0.2, 0.5, 1.0, True),
        (0.5, 0.8, 1.0, True),
        (0.5, 0.5, 2.0, True),
        (0.5, 0.5, 1.0, False),
        (0.3, 0.5, 1.0, False),
    ]
    for H, L, n, expected in tests:
        triggered = (H < 0.25 or L > 0.7 or n > 1.5)
        status = "✅" if triggered == expected else "❌"
        print(f"  {status} H={H} L={L} n={n} → triggered={triggered} (expected {expected})")
    print()

def test_launch_enter_condition():
    """测试 LAUNCH 进入条件"""
    print("=== test_launch_enter ===")
    CHANGE_THRESHOLD = 0.12
    tests = [
        (0.13, 0.1, True),
        (0.05, 0.4, True),
        (0.05, 0.1, False),
        (0.12, 0.1, False),
        (0.13, 0.3, True),
    ]
    for delta_H, delta_n, expected in tests:
        enter = (delta_H > CHANGE_THRESHOLD or delta_n > 0.3)
        status = "✅" if enter == expected else "❌"
        print(f"  {status} delta_H={delta_H} delta_n={delta_n} → enter={enter} (expected {expected})")
    print()

def test_launch_exit_condition():
    """测试 LAUNCH 退出条件"""
    print("=== test_launch_exit ===")
    CHANGE_THRESHOLD = 0.12
    tests = [
        (0.05, 0.1, 0.6, 0.3, True),
        (0.07, 0.1, 0.6, 0.3, False),
        (0.05, 0.2, 0.6, 0.3, False),
        (0.05, 0.1, 0.4, 0.3, False),
        (0.05, 0.1, 0.6, 0.5, False),
    ]
    for delta_H, delta_n, H, n, expected in tests:
        base_exit = (delta_H < CHANGE_THRESHOLD * 0.5 and delta_n < 0.15 and H > 0.5 and n < 0.4)
        status = "✅" if base_exit == expected else "❌"
        print(f"  {status} dH={delta_H} dn={delta_n} H={H} n={n} → exit={base_exit}")
    print()

def test_describing_function():
    """测试描述函数 K(n)"""
    print("=== test_describing_function ===")
    try:
        spec2 = importlib.util.spec_from_file_location("describe_function", "/home/ai/.openclaw/sre-agent/describe_function.py")
        df = importlib.util.module_from_spec(spec2)
        spec2.loader.exec_module(df)
        compute_K = df.compute_K
        tests = [
            (0.0, 0.95),
            (0.5, 0.75),
            (1.0, 0.25),
            (8.0, 0.10),
            (10.0, 0.10),
        ]
        for n, expected_min in tests:
            K = compute_K(n)
            status = "✅" if K >= expected_min - 0.01 else "❌"
            print(f"  {status} n={n} → K={K:.3f} (min expected {expected_min})")
    except Exception as e:
        print(f"  ⚠️ describe_function error: {e}")
    print()

def main():
    print("=" * 60)
    print("SRE 自我调控系统 - 单元测试")
    print("=" * 60)
    print()
    
    test_get_sagi_zone()
    test_get_sagi_params()
    test_classify()
    test_n_proxy_math()
    test_fuse_trigger_condition()
    test_launch_enter_condition()
    test_launch_exit_condition()
    test_describing_function()
    
    print("=" * 60)
    print("测试完成")
    print("=" * 60)

if __name__ == "__main__":
    main()
