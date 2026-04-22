/**
 * Monitor Aggregator
 * 收集所有 detector 的输出，聚合成统一格式
 */

import fs from 'fs';
import path from 'path';

const DETECTORS_DIR = '/home/ai/.openclaw/monitor/detectors';

export async function aggregate() {
  const result = {
    ts: new Date().toISOString(),
    alerts: [],
    summary: {
      total: 0,
      high: 0,
      medium: 0,
      low: 0
    }
  };
  
  try {
    // 动态加载所有 detector
    const files = fs.readdirSync(DETECTORS_DIR)
      .filter(f => f.endsWith('.js'));
    
    for (const file of files) {
      try {
        const detectorPath = path.join(DETECTORS_DIR, file);
        const { detect } = await import(`file://${detectorPath}`);
        const alerts = detect();
        
        for (const alert of alerts) {
          alert.source = file.replace('.js', '');
          result.alerts.push(alert);
          result.summary[alert.severity]++;
          result.summary.total++;
        }
      } catch (e) {
        // 单个 detector 失败不影响其他
      }
    }
    
    // 按 severity 排序
    result.alerts.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.severity] - order[b.severity];
    });
    
  } catch (e) {
    // 目录不存在
  }
  
  return result;
}
