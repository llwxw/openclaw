/**
 * Spawn Anomaly Detector
 * 检测子代理使用异常（突然大量使用或几乎不用）
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
          if (new Date(entry.timestamp).getTime() > twoHoursAgo) {
            entries.push(entry);
          }
        } catch {}
      }
    }
    
    if (entries.length === 0) return alerts;
    
    // 计算 spawn 率
    const spawnedCount = entries.filter(e => e._spawned === true).length;
    const spawnRate = spawnedCount / entries.length;
    
    // 计算策略分布
    const strategies = {};
    for (const e of entries) {
      strategies[e.strategy] = (strategies[e.strategy] || 0) + 1;
    }
    
    // 异常：spawn 率 > 50% 或连续多次 SPAWN_SUBAGENT
    if (spawnRate > 0.5) {
      alerts.push({
        type: 'high_spawn_rate',
        severity: spawnRate > 0.7 ? 'high' : 'medium',
        value: spawnRate,
        count: spawnedCount,
        total: entries.length,
        message: `子代理使用率 ${(spawnRate * 100).toFixed(0)}% (${spawnedCount}/${entries.length})`,
        detail: `主要策略: ${Object.entries(strategies).sort((a,b) => b[1]-a[1])[0]?.[0]}`
      });
    }
    
    // 异常：连续5次以上 SPAWN_SUBAGENT
    let consecutiveSpawn = 0;
    let maxConsecutive = 0;
    for (const e of entries) {
      if (e._spawned) {
        consecutiveSpawn++;
        maxConsecutive = Math.max(maxConsecutive, consecutiveSpawn);
      } else {
        consecutiveSpawn = 0;
      }
    }
    
    if (maxConsecutive >= 5) {
      alerts.push({
        type: 'consecutive_spawn',
        severity: 'medium',
        value: maxConsecutive,
        message: `连续 ${maxConsecutive} 次使用子代理`,
        detail: '可能存在任务分解过多'
      });
    }
    
  } catch (e) {
    // 目录不存在，不告警
  }
  
  return alerts;
}
