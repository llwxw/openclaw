#!/usr/bin/env python3
"""
K(n) 标定实验设计

目标：收集干净数据，用于拟合 K(n)

设计：
- 负载等级: q = 5, 10, 15, 20, 25, 30
- 每个等级: 重复 10 次
- 指标: sr (成功率)
- 总数据点: 60 个

问题：需要实际注入任务到 OpenClaw
当前状态：无法从外部注入任务
替代方案：使用 cron 定时触发任务
"""

EXPERIMENT_DESIGN = {
    "name": "K(n) 标定实验",
    "objective": "测量不同负载率 n 下的成功率 sr",
    "design": {
        "max_c": 50,  # 固定容量
        "q_levels": [5, 10, 15, 20, 25, 30],  # 6 个负载等级
        "repeats_per_level": 10,  # 每个等级重复 10 次
        "total_samples": 60  # 6 * 10 = 60
    },
    "metrics": ["sr", "n", "H", "L", "q"],
    "estimated_duration": "数小时到数天（取决于任务完成速度）",
    "requirements": [
        "能够注入任务到 OpenClaw",
        "能够控制注入的任务数量",
        "能够等待任务完成后读取 sr"
    ],
    "current_status": "无法自动执行（需要任务注入接口）",
    "替代方案": [
        "方案A: 手动触发不同数量的任务",
        "方案B: 等待自然负载变化",
        "方案C: 修改 OpenClaw 添加负载注入接口"
    ]
}

def design_control_experiment():
    """
    设计受控实验的统计考虑
    """
    print("=" * 60)
    print("K(n) 标定实验设计")
    print("=" * 60)
    print()
    
    print("实验设计:")
    print(f"  负载等级: {EXPERIMENT_DESIGN['design']['q_levels']}")
    print(f"  每等级重复: {EXPERIMENT_DESIGN['design']['repeats_per_level']}")
    print(f"  总样本数: {EXPERIMENT_DESIGN['design']['total_samples']}")
    print()
    
    print("统计功效分析:")
    print("  要检测的最小差异: Δsr = 0.1")
    print("  期望的功效: 1 - β = 0.8")
    print("  显著性水平: α = 0.05")
    print("  每组所需样本: n ≈ 10")
    print("  结论: 每等级 10 次重复是合理的")
    print()
    
    print("数据质量要求:")
    print("  1. 每个 n 至少 10 个独立样本")
    print("  2. 样本间方差已知或可估计")
    print("  3. 数据来自相近时间段（系统状态稳定）")
    print("  4. 异常值处理：剔除超过 3σ 的点")
    print()
    
    print("当前限制:")
    print("  - 无法自动注入任务到 OpenClaw")
    print("  - 依赖自然负载变化")
    print("  - 历史数据不适合拟合（样本不足+异质）")
    print()
    
    print("推荐做法:")
    print("  1. 短期: 接受当前经验参数")
    print("  2. 中期: 开发任务注入接口")
    print("  3. 长期: 运行完整标定实验")
    print()
    
    print("=" * 60)
    print("当前 K(n) 参数状态")
    print("=" * 60)
    print()
    print("参数来源: 经验估计")
    print("  K_max = 0.95")
    print("  n_max = 8.0")
    print("  p = 2.0")
    print()
    print("用途: 仅作为状态显示/预警")
    print("控制决策: 依赖 n < 0.5 条件（理论保证）")
    print()
    
    print("=" * 60)
    print("下一步行动建议")
    print("=" * 60)
    print()
    print("1. 不再尝试用历史数据拟合 K(n)")
    print("   原因: 数据不满足拟合条件")
    print()
    print("2. K(n) 保持当前经验参数")
    print("   K_max = 0.95, n_max = 8.0, p = 2.0")
    print()
    print("3. 关注系统稳定性")
    print("   - 监控 n 是否 < 0.5")
    print("   - 监控 fuse 是否触发")
    print("   - 监控系统健康度 H")
    print()
    print("4. 如果未来有机会做标定实验")
    print("   - 使用本脚本的设计")
    print("   - 确保每组 10 个重复")
    print("   - 分离正常和危机数据")

if __name__ == "__main__":
    design_control_experiment()
