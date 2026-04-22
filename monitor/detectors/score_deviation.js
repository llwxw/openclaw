/**
 * Score Deviation Detector
 * 检测任务评分异常（突然变高或变低）
 */

import fs from 'fs';
import path from 'path';

const EPHEMERAL_DIR = '/home/ai/.openclaw/workspace/memory/ephemeral';

export function detect(context = {}) {
  const alerts = [];
  
  try {
    // 读取近2小时数据
    const files = fs.readdirSync(EPHEMERAL_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .sort()
      .slice(-3);
    
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const entries = [];
    
    for (const file of files) {
      const content = fs.readFileSync(path.join(EPHEMERAL_DIR, file), 'utf8');
      const lines = content.split('\n').filter(l => l.trim());
      
      for (const line of lines.slice(-100)) {
        try {
          const entry = JSON.parse(line);
          if (new Date(entry.timestamp).getTime() > twoHoursAgo && entry.score > 0) {
            entries.push(entry);
          }
        } catch {}
      }
    }
    
    if (entries.length < 3) return alerts;
    
    // 计算均值和标准差
    const scores = entries.map(e => e.score);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length;
    const stdDev = Math.sqrt(variance);
    
    // 异常：高评分 (> mean + 2σ) 或 低评分 (< mean - 2σ)
    const threshold_high = mean + 2 * stdDev;
    const threshold_low = mean - 2 * stdDev;
    
    const highScoreEntries = entries.filter(e => e.score > threshold_high);
    const lowScoreEntries = entries.filter(e => e.score < threshold_low && e.score > 0);
    
    if (highScoreEntries.length > 0) {
      alerts.push({
        type: 'high_score_anomaly',
        severity: highScoreEntries.length > 3 ? 'high' : 'medium',
        value: Math.max(...highScoreEntries.map(e => e.score)),
        baseline: `${mean.toFixed(0)} ± ${stdDev.toFixed(0)}`,
        count: highScoreEntries.length,
        message: `高复杂度任务突增: score ${Math.max(...highScoreEntries.map(e => e.score))} (基线 ${mean.toFixed(0)} ± ${stdDev.toFixed(0)})`,
        detail: '可能存在提示词注入或异常任务'
      });
    }
    
    // 异常：连续多次 score > 60
    let consecutiveHigh = 0;
    let maxConsecutiveHigh = 0;
    for (const e of entries) {
      if (e.score >= 60) {
        consecutiveHigh++;
        maxConsecutiveHigh = Math.max(maxConsecutiveHigh, consecutiveHigh);
      } else {
        consecutiveHigh = 0;
      }
    }
    
    if (maxConsecutiveHigh >= 3) {
      alerts.push({
        type: 'consecutive_high_score',
        severity: 'medium',
        value: maxConsecutiveHigh,
        message: `连续 ${maxConsecutiveHigh} 次高风险任务 (score ≥ 60)`,
        detail: '建议检查任务来源'
      });
    }
    
  } catch (e) {
    // 目录不存在，不告警
  }
  
  return alerts;
}
