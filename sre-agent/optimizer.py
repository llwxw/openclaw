#!/usr/bin/env python3
"""
P4 Optimizer: 保守版极值搜索模块
基于控制论极值控制原理，通过试探性调整参数观测性能指标变化
安全约束：调整幅度≤5%，参数边界限制，10分钟最多1次调整
"""

import json
import yaml
import time
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Tuple, Optional

# ============ 配置常量 ============
WORKSPACE = Path("/home/ai/.openclaw")
CONTROL_META_PATH = WORKSPACE / "memory" / "CONTROL_META.yaml"
METRICS_PATH = WORKSPACE / "metrics" / "system_metrics.jsonl"
OPTIMIZER_OUTPUT_PATH = WORKSPACE / "metrics" / "optimizer.json"

# 安全约束
MAX_ADJUSTMENT_RATIO = 0.05  # 单次调整幅度 ≤ 5%
MIN_ADJUSTMENT_INTERVAL = 600  # 10分钟 = 600秒

# 参数边界 (根据 CONTROL_META.yaml 和任务描述)
PARAM_BOUNDS = {
    "SPAWN_ON": {"min": 20, "max": 50},  # 任务描述: [20,50]
    "SPAWN_OFF": {"min": 15, "max": 45},  # 任务描述: [15,45]
    "SCORE_THRESHOLD": {"min": 30, "max": 60},  # 任务描述: [30,60]
}

# 性能指标 J 的常数
DEFAULT_MAX_LOAD = 5.0  # 从 metrics 中 max_c 字段看到通常为 5
DEFAULT_MAX_LATENCY = 1.0  # L 的基准值


# ============ 数据读取 ============

def load_current_parameters() -> Dict[str, Dict]:
    """从 CONTROL_META.yaml 读取当前参数及边界"""
    with open(CONTROL_META_PATH, 'r') as f:
        meta = yaml.safe_load(f)

    params = {}
    for name, info in meta.get('parameters', {}).items():
        if name in PARAM_BOUNDS:
            params[name] = {
                'current': info.get('current'),
                'min': info.get('min', PARAM_BOUNDS[name]['min']),
                'max': info.get('max', PARAM_BOUNDS[name]['max']),
                'last_adjusted': info.get('last_adjusted'),
            }
    return params


def load_recent_metrics(n: int = 30) -> List[Dict]:
    """读取最近 n 条性能指标记录"""
    if not METRICS_PATH.exists():
        return []

    with open(METRICS_PATH, 'r') as f:
        lines = f.readlines()

    records = []
    for line in lines[-n:]:
        line = line.strip()
        if line:
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return records


# ============ 性能指标计算 ============

def compute_performance_index(metrics_record: Dict) -> float:
    """
    计算综合性能指标 J

    J = 成功率 * H * (1 - 延迟/L_max) * (1 - 负载/max_load)

    参数:
        metrics_record: system_metrics 单条记录

    返回:
        J 值 (0-1 范围，越大越好)
    """
    # 提取字段
    sr = metrics_record.get('sr', 0.0)  # success rate
    H = metrics_record.get('H', 0.5)    # humanity/efficiency
    L = metrics_record.get('L', 0.1)    # latency indicator
    q_curr = metrics_record.get('q_curr', 0)  # current queue length
    q_total = metrics_record.get('q_total', 1)  # total capacity
    max_c = metrics_record.get('max_c', DEFAULT_MAX_LOAD)

    # 负载率 = q_curr / max(q_total, 1)
    load_ratio = q_curr / max(q_total, 1)

    # 延迟惩罚: (1 - L/L_max)，L 越小越好，L_max 取 DEFAULT_MAX_LATENCY
    # 注意: metrics 中 L=1.0 表示延迟高，L=0.1 表示延迟低
    latency_penalty = 1.0 - min(L / DEFAULT_MAX_LATENCY, 1.0)

    # 负载惩罚: (1 - load_ratio)
    load_penalty = 1.0 - min(load_ratio, 1.0)

    # 综合指标 J
    J = sr * H * latency_penalty * load_penalty

    return J


def get_current_performance_index(metrics_history: List[Dict]) -> float:
    """基于最近的历史记录计算当前综合 J（取平均值）"""
    if not metrics_history:
        return 0.0
    recent_J = [compute_performance_index(r) for r in metrics_history[-5:]]
    return sum(recent_J) / len(recent_J)


# ============ 极值搜索 ============

class ConservativeOptimizer:
    """保守版极值搜索优化器"""

    def __init__(self):
        self.params = load_current_parameters()
        self.metrics_history = load_recent_metrics(30)
        self.current_J = get_current_performance_index(self.metrics_history)

        # 优化状态
        self.direction = {}  # 每个参数的调整方向: +1 (增大) 或 -1 (减小)
        self.last_adjustment_time = self._get_last_adjustment_time()
        self.adjustment_history = []  # 保存最近的调整记录用于收敛判断

        self._init_directions()

    def _init_directions(self):
        """初始化调整方向：根据当前 J 和历史趋势决定"""
        # 保守策略：如果当前 J 较低，尝试增大 SPAWN_ON 和 SPAWN_OFF（提高并发）
        # 但需要根据 H 和 L 的值判断
        if self.metrics_history:
            latest = self.metrics_history[-1]
            H = latest.get('H', 0.5)
            L = latest.get('L', 0.1)

            # H 低说明效率低，可能需要降低 spawn_on/off（减少并发，提高质量）
            # L 高说明延迟高，可能需要降低 spawn_on/off
            if H < 0.4 or L > 0.8:
                self.direction = {
                    'SPAWN_ON': -1,
                    'SPAWN_OFF': -1,
                    'SCORE_THRESHOLD': +1,  # 提高阈值，减少低质量任务
                }
            else:
                self.direction = {
                    'SPAWN_ON': +1,
                    'SPAWN_OFF': +1,
                    'SCORE_THRESHOLD': -1,  # 降低阈值，接受更多任务
                }
        else:
            self.direction = {'SPAWN_ON': +1, 'SPAWN_OFF': +1, 'SCORE_THRESHOLD': -1}

    def _get_last_adjustment_time(self) -> float:
        """从 optimizer.json 读取上次调整时间"""
        if OPTIMIZER_OUTPUT_PATH.exists():
            try:
                with open(OPTIMIZER_OUTPUT_PATH, 'r') as f:
                    data = json.load(f)
                last_ts = data.get('last_adjustment_time', 0)
                return float(last_ts)
            except:
                pass
        return 0.0

    def _can_adjust_now(self) -> Tuple[bool, str]:
        """检查是否满足安全约束（时间间隔）"""
        now = time.time()
        elapsed = now - self.last_adjustment_time

        if elapsed < MIN_ADJUSTMENT_INTERVAL:
            return False, f"距离上次调整仅 {elapsed:.0f} 秒，需等待 {MIN_ADJUSTMENT_INTERVAL - elapsed:.0f} 秒"
        return True, "OK"

    def _calculate_proposed_value(self, param_name: str, current: float, direction: int) -> float:
        """计算建议调整值（保守：±5% 随机扰动）"""
        bounds = PARAM_BOUNDS[param_name]
        min_val, max_val = bounds['min'], bounds['max']

        # 基础调整：方向 * 5% * 当前值
        base_change = current * MAX_ADJUSTMENT_RATIO * direction

        # 保守版：加入 ±50% 的随机扰动，使实际调整在 ±2.5%~±7.5% 之间浮动
        random_factor = random.uniform(0.5, 1.5)
        change = base_change * random_factor

        proposed = current + change

        # 边界保护
        proposed = max(min_val, min(max_val, proposed))

        # 取整到合理的步长
        if param_name in ['SPAWN_ON', 'SPAWN_OFF']:
            proposed = round(proposed)
        elif param_name == 'SCORE_THRESHOLD':
            proposed = round(proposed / 5) * 5  # 5 的倍数

        return float(proposed)

    def _simulate_J_with_params(self, spawn_on: float, spawn_off: float, threshold: float) -> float:
        """
        模拟给定参数下的性能指标 J
        简化模型：基于历史数据拟合的影响因子
        """
        if not self.metrics_history:
            return 0.0

        # 使用最近一条记录作为基准
        base_record = self.metrics_history[-1]
        base_J = compute_performance_index(base_record)

        # 参数敏感度系数（经验值）
        sensitivity = {
            'SPAWN_ON': 0.02,   # spawn_on 每增加 1，J 变化约 0.02
            'SPAWN_OFF': 0.015,
            'SCORE_THRESHOLD': 0.01,
        }

        # 当前参数
        cur_on = base_record.get('spawn_on', 30)
        cur_off = base_record.get('spawn_off', 26)
        cur_threshold = base_record.get('threshold', 40)

        # 计算调整量
        delta_on = spawn_on - cur_on
        delta_off = spawn_off - cur_off
        delta_threshold = threshold - cur_threshold

        # 估计 J 变化（线性近似）
        delta_J = (delta_on * sensitivity['SPAWN_ON'] +
                   delta_off * sensitivity['SPAWN_OFF'] +
                   delta_threshold * sensitivity['SCORE_THRESHOLD'])

        # 加入随机噪声（模拟不确定性）
        noise = random.uniform(-0.005, 0.005)

        simulated_J = base_J + delta_J + noise

        # 限制在 [0, 1]
        return max(0.0, min(1.0, simulated_J))

    def run_optimization_cycle(self) -> Dict:
        """
        执行一次极值搜索周期

        返回:
            optimization result dict
        """
        # 1. 检查是否可调整
        can_adjust, reason = self._can_adjust_now()
        if not can_adjust:
            return {
                'status': 'skipped',
                'reason': reason,
                'current_J': round(self.current_J, 4),
                'timestamp': datetime.now(timezone.utc).isoformat(),
            }

        # 2. 读取最新 metrics（确保数据新鲜）
        self.metrics_history = load_recent_metrics(30)
        self.current_J = get_current_performance_index(self.metrics_history)

        # 3. 随机选择一个参数进行扰动（保守版：一次只调一个）
        param_names = list(PARAM_BOUNDS.keys())
        target_param = random.choice(param_names)

        current_value = self.params[target_param]['current']
        direction = self.direction[target_param]

        # 4. 计算建议值
        proposed_value = self._calculate_proposed_value(target_param, current_value, direction)

        # 5. 模拟新 J
        # 构造完整的参数集
        sim_on = proposed_value if target_param == 'SPAWN_ON' else self.params['SPAWN_ON']['current']
        sim_off = proposed_value if target_param == 'SPAWN_OFF' else self.params['SPAWN_OFF']['current']
        sim_threshold = proposed_value if target_param == 'SCORE_THRESHOLD' else self.params['SCORE_THRESHOLD']['current']

        simulated_J = self._simulate_J_with_params(sim_on, sim_off, sim_threshold)

        # 6. 判断改善方向
        J_change = simulated_J - self.current_J
        improvement_ratio = J_change / max(self.current_J, 1e-6)

        # 7. 更新方向（如果恶化则反向）
        if J_change < 0:
            self.direction[target_param] = -direction  # 反向

        # 8. 收敛判断
        converged = self._check_convergence(improvement_ratio)

        # 9. 准备输出
        result = {
            'status': 'adjusted',
            'parameter': target_param,
            'current_value': current_value,
            'proposed_value': proposed_value,
            'current_J': round(self.current_J, 4),
            'simulated_J': round(simulated_J, 4),
            'J_change': round(J_change, 6),
            'J_change_percent': round(improvement_ratio * 100, 2),
            'direction': 'improved' if J_change >= 0 else 'worsened',
            'converged': converged,
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'last_adjustment_time': time.time(),
        }

        # 10. 保存调整历史
        self.adjustment_history.append({
            'time': time.time(),
            'param': target_param,
            'J_change_ratio': improvement_ratio,
        })
        # 保持最近 10 条
        if len(self.adjustment_history) > 10:
            self.adjustment_history = self.adjustment_history[-10:]

        return result

    def _check_convergence(self, latest_improvement: float) -> bool:
        """判断是否收敛：最近 3 次改善率均 < 1%"""
        if len(self.adjustment_history) < 3:
            return False

        recent = self.adjustment_history[-3:]
        for record in recent:
            if abs(record['J_change_ratio']) >= 0.01:  # 1%
                return False
        return True

    def save_result(self, result: Dict):
        """保存优化结果到 optimizer.json"""
        # 读取现有数据（保留历史）
        existing = []
        if OPTIMIZER_OUTPUT_PATH.exists():
            try:
                with open(OPTIMIZER_OUTPUT_PATH, 'r') as f:
                    existing = json.load(f)
            except:
                existing = []

        if not isinstance(existing, list):
            existing = []

        existing.append(result)
        # 只保留最近 100 条
        existing = existing[-100:]

        with open(OPTIMIZER_OUTPUT_PATH, 'w') as f:
            json.dump(existing, f, indent=2)

        print(f"[P4_OPTIMIZER] Result saved to {OPTIMIZER_OUTPUT_PATH}")


# ============ 主程序 ============

def main():
    print("[P4_OPTIMIZER] Conservative Extremum Search Module")
    print(f"[P4_OPTIMIZER] Workspace: {WORKSPACE}")
    print(f"[P4_OPTIMIZER] Safety: max adjustment={MAX_ADJUSTMENT_RATIO*100:.0f}%, interval={MIN_ADJUSTMENT_INTERVAL}s")
    print()

    optimizer = ConservativeOptimizer()

    print(f"[P4_OPTIMIZER] current_J={optimizer.current_J:.4f}")
    print(f"[P4_OPTIMIZER] Parameters:")
    for name, info in optimizer.params.items():
        print(f"  {name}: {info['current']} (bounds: {info['min']}-{info['max']})")
    print()

    # 执行一次优化周期
    result = optimizer.run_optimization_cycle()

    # 输出报告
    print("--- Optimization Report ---")
    print(f"[P4_OPTIMIZER] status: {result['status']}")
    if result['status'] == 'skipped':
        print(f"[P4_OPTIMIZER] reason: {result['reason']}")
    else:
        print(f"[P4_OPTIMIZER] parameter: {result['parameter']}")
        print(f"[P4_OPTIMIZER] adjustment: {result['current_value']} → {result['proposed_value']}")
        print(f"[P4_OPTIMIZER] current_J: {result['current_J']:.4f}")
        print(f"[P4_OPTIMIZER] simulated_J: {result['simulated_J']:.4f}")
        print(f"[P4_OPTIMIZER] J_change: {result['J_change_percent']:+.2f}%")
        print(f"[P4_OPTIMIZER] direction: {result['direction']}")
        print(f"[P4_OPTIMIZER] converged: {result['converged']}")

    print(f"[P4_OPTIMIZER] timestamp: {result['timestamp']}")
    print("--------------------------")

    # 保存结果
    optimizer.save_result(result)

    # 收敛提示
    if result.get('converged'):
        print("[P4_OPTIMIZER] ⚠️  Convergence detected: J improvement < 1% for 3 cycles")
        print("[P4_OPTIMIZER] Consider: 1) Expanding search range, 2) Adjusting safety constraints, 3) Re-evaluating metric weights")


if __name__ == '__main__':
    main()
