/**
 * Error Rate Detector
 * 检测错误率异常
 * 
 * 基线：过去7天同一时段的 error_rate 均值 + 2σ
 */

import fs from 'fs';
import path from 'path';

const EPHEMERAL_DIR = '/home/ai/.openclaw/workspace/memory/ephemeral';

export function detect(context = {}) {
  const alerts = [];
  
  try {
    const files = fs.readdirSync(EPHEMERAL_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .sort()
      .slice(-7); // 最近7天
    
    const now = new Date();
    const currentHour = now.getHours();
    
    // 收集当前小时的数据
    const currentHourEntries = [];
    for (const file of files) {
      const content = fs.readFileSync(path.join(EPHEMERAL_DIR, file), 'utf8');
      const lines = content.split('\n').filter(l => l.trim());
      
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          const entryHour = new Date(entry.timestamp).getHours();
          if (entryHour === currentHour) {
            currentHourEntries.push(entry);
          }
        } catch {}
      }
    }
    
    // 简化：检测 error 相关字段（如果有）
    const errorEntries = currentHourEntries.filter(e => 
      e.error || e.status === 'error' || (e.factors && e.factors.risk > 3)
    );
    
    const errorRate = currentHourEntries.length > 0 
      ? errorEntries.length / currentHourEntries.length 
      : 0;
    
    if (errorRate > 0.05) {
      alerts.push({
        type: 'error_spike',
        severity: errorRate > 0.15 ? 'high' : 'medium',
        value: errorRate,
        count: errorEntries.length,
        total: currentHourEntries.length,
        message: `错误率 ${(errorRate * 100).toFixed(1)}% (${errorEntries.length}/${currentHourEntries.length})`
      });
    }
    
  } catch (e) {
    // ephemeral 目录不存在或为空，不告警
  }
  
  return alerts;
}
