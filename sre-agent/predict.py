#!/usr/bin/env python3
"""
P3 预测模块：功率谱分析 + 维纳滤波

理论依据：
- 功率谱 Φ(ω) 描述随机信号的频率分布
- 维纳滤波：基于历史数据预测未来值
- 相关函数 R(τ) 与功率谱互为傅里叶变换

数据源：/home/ai/.openclaw/metrics/system_metrics.jsonl
"""

import json
import numpy as np
from pathlib import Path
from datetime import datetime
from typing import Tuple, List, Dict


def load_metrics(limit: int = 120) -> List[Dict]:
    """读取最新 N 条指标记录"""
    metrics_path = Path("/home/ai/.openclaw/metrics/system_metrics.jsonl")
    records = []

    with open(metrics_path, 'r') as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    continue

    # 返回最新 limit 条
    return records[-limit:]


def extract_q_total(records: List[Dict]) -> np.ndarray:
    """提取 q_total 时间序列"""
    q_values = []
    for rec in records:
        # 优先使用 q_total，如果不存在则使用 q
        if 'q_total' in rec:
            q_values.append(float(rec['q_total']))
        elif 'q' in rec:
            q_values.append(float(rec['q']))
        else:
            q_values.append(0.0)

    return np.array(q_values)


def power_spectrum(signal: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """
    计算功率谱密度

    返回：(频率数组, 功率谱密度)
    """
    # 去均值
    signal_centered = signal - np.mean(signal)

    # 计算 FFT
    fft = np.fft.fft(signal_centered)

    # 功率谱密度 (|FFT|^2 / N)
    psd = np.abs(fft) ** 2 / len(signal)

    # 频率轴
    freqs = np.fft.fftfreq(len(signal))

    return freqs, psd


def dominant_frequencies(freqs: np.ndarray, psd: np.ndarray, top_k: int = 3) -> List[Tuple[float, float]]:
    """识别主要频率成分"""
    # 只取正频率部分
    positive_mask = freqs > 0
    pos_freqs = freqs[positive_mask]
    pos_psd = psd[positive_mask]

    # 排序找峰值
    indices = np.argsort(pos_psd)[-top_k:][::-1]
    return [(float(pos_freqs[i]), float(pos_psd[i])) for i in indices]


def wiener_filter_predict(history: np.ndarray, alpha: float = 0.3) -> Tuple[float, float, float]:
    """
    维纳滤波预测（使用指数移动平均作为简化实现）

    参数：
    - history: 历史数据（最近 N 个点）
    - alpha: 平滑系数 (0-1)

    返回：
    - next_value: 下一时刻预测值
    - error: 预测误差（历史残差标准差）
    - trend: 趋势估计
    """
    if len(history) < 2:
        return float(history[0]) if len(history) > 0 else 0.0, 0.0, 0.0

    # 指数移动平均 (Exponential Moving Average)
    ema = np.zeros_like(history, dtype=float)
    ema[0] = history[0]

    for i in range(1, len(history)):
        ema[i] = alpha * history[i] + (1 - alpha) * ema[i-1]

    # 预测下一时刻 = 最新 EMA 值
    next_pred = ema[-1]

    # 计算历史残差
    residuals = history - ema
    error = np.std(residuals)

    # 简单趋势估计（最近 3 个点的斜率）
    if len(history) >= 3:
        trend = np.mean(history[-3:]) - np.mean(history[-6:-3]) if len(history) >= 6 else history[-1] - history[-2]
    else:
        trend = history[-1] - history[0] if len(history) > 1 else 0.0

    return float(next_pred), float(error), float(trend)


def detect_peaks(q_history: np.ndarray, threshold: float = None, std_mult: float = 1.5) -> Tuple[List[int], List[float]]:
    """
    检测高峰时段

    参数：
    - q_history: 负载历史序列
    - threshold: 固定阈值（若提供则使用）
    - std_mult: 标准差倍数（用于自适应阈值）

    返回：(高峰索引列表, 高峰值列表)
    """
    if threshold is None:
        # 自适应阈值：均值 + std_mult * 标准差
        mean_val = np.mean(q_history)
        std_val = np.std(q_history)
        threshold = mean_val + std_mult * std_val
        print(f"[P3_PREDICT] 自适应高峰阈值: {threshold:.2f} (mean={mean_val:.2f}, std={std_val:.2f})")

    peaks_idx = []
    peaks_val = []

    for i, q in enumerate(q_history):
        if q > threshold:
            peaks_idx.append(i)
            peaks_val.append(float(q))

    return peaks_idx, peaks_val


def calculate_accuracy(history: np.ndarray, window: int = 10) -> float:
    """
    计算预测准确率（基于回测）

    使用滚动预测，计算预测值与实际值的吻合程度
    """
    if len(history) < window + 1:
        return 0.0

    errors = []
    for i in range(window, len(history)):
        pred = np.mean(history[i-window:i])  # 简单前 N 个点的平均值作为预测
        actual = history[i]
        errors.append(abs(pred - actual))

    if not errors:
        return 0.0

    # 准确率 = 1 - (平均误差 / 数据范围)
    mean_error = np.mean(errors)
    data_range = np.max(history) - np.min(history) if np.ptp(history) > 0 else 1.0
    accuracy = max(0.0, 1.0 - mean_error / data_range)

    return accuracy


def main():
    """主函数"""
    print("[P3_PREDICT] 启动预测模块...")

    # 1. 读取历史数据
    records = load_metrics(120)
    print(f"[P3_PREDICT] 加载记录数: {len(records)}")

    if len(records) < 10:
        print("[P3_PREDICT] 警告：数据不足，需要至少 10 条记录")
        return

    # 2. 提取 q_total 序列
    q_history = extract_q_total(records)
    print(f"[P3_PREDICT] q_total 序列长度: {len(q_history)}")

    # 基本统计
    q_mean = np.mean(q_history)
    q_std = np.std(q_history)
    print(f"[P3_PREDICT] q_mean={q_mean:.2f} q_std={q_std:.2f}")

    # 3. 功率谱分析
    freqs, psd = power_spectrum(q_history)
    dominant_freqs = dominant_frequencies(freqs, psd, top_k=3)
    print(f"[P3_PREDICT] 功率谱分析完成，主要频率成分:")
    for freq, power in dominant_freqs:
        print(f"[P3_PREDICT]   频率={freq:.4f} 功率={power:.2f}")

    # 4. 维纳滤波预测
    recent_10 = q_history[-10:]  # 最近 10 个点
    next_q, error, trend = wiener_filter_predict(recent_10, alpha=0.3)
    print(f"[P3_PREDICT] 维纳滤波预测:")
    print(f"[P3_PREDICT]   next_q_prediction={next_q:.2f}")
    print(f"[P3_PREDICT]   prediction_error(std)={error:.2f}")
    print(f"[P3_PREDICT]   trend={trend:.2f}")

    # 5. 高峰检测（使用自适应阈值）
    peaks_idx, peaks_val = detect_peaks(q_history)
    peak_threshold = np.mean(q_history) + 1.5 * np.std(q_history)  # 记录实际使用的阈值
    print(f"[P3_PREDICT] 高峰检测: 自适应阈值={peak_threshold:.2f} 高峰数量={len(peaks_idx)}")

    # 6. 计算预测准确率（基于回测）
    accuracy = calculate_accuracy(q_history, window=10)
    print(f"[P3_PREDICT] prediction_accuracy={accuracy:.1%}")

    # 7. 生成报告
    print("\n=== P3 预测模块报告 ===")
    print(f"[P3_PREDICT] records={len(q_history)}")
    print(f"[P3_PREDICT] q_mean={q_mean:.2f} q_std={q_std:.2f}")
    print(f"[P3_PREDICT] peak_threshold={peak_threshold:.2f} peaks_detected={len(peaks_idx)}")
    print(f"[P3_PREDICT] prediction_accuracy={accuracy:.1%}")
    print(f"[P3_PREDICT] next_q_prediction={next_q:.2f}")

    # 8. 保存结果
    result = {
        "timestamp": datetime.now().isoformat(),
        "records": len(q_history),
        "q_mean": float(q_mean),
        "q_std": float(q_std),
        "peak_threshold": float(peak_threshold),
        "peaks_detected": len(peaks_idx),
        "prediction_accuracy": float(accuracy),
        "next_q_prediction": float(next_q),
        "prediction_error": float(error),
        "trend": float(trend),
        "dominant_frequencies": [
            {"freq": float(f), "power": float(p)}
            for f, p in dominant_freqs
        ],
        "recent_10_q": recent_10.tolist()
    }

    output_path = Path("/home/ai/.openclaw/metrics/prediction.json")
    with open(output_path, 'w') as f:
        json.dump(result, f, indent=2)

    print(f"[P3_PREDICT] 结果已保存到: {output_path}")

    # 9. 距离方案要求评估
    required_accuracy = 0.70  # 70%
    gap = required_accuracy - accuracy
    print(f"\n=== 方案要求评估 ===")
    print(f"要求准确率: {required_accuracy:.1%}")
    print(f"当前准确率: {accuracy:.1%}")
    print(f"差距: {gap:.1%}")

    if accuracy >= required_accuracy:
        print("✅ 已达到方案要求 (>70%)")
    else:
        print(f"⚠️  距离方案要求还有 {gap:.1%} 的差距")


if __name__ == "__main__":
    main()
