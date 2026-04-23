/**
 * Log Analyzer Detector
 * 解析 Gateway 日志里的真实 ERROR
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = '/tmp/openclaw';

// Get today's log file
function getLogFile() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(LOG_DIR, `openclaw-${today}.log`);
}

function detect() {
  const alerts = [];

  const logFile = getLogFile();
  if (!fs.existsSync(logFile)) {
    alerts.push({
      type: 'log_file_missing',
      severity: 'low',
      component: 'Log',
      message: `日志文件不存在: ${logFile}`,
      fix: '检查 openclaw 日志配置'
    });
    return alerts;
  }

  try {
    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());

    // Find ERROR level entries
    const errors = [];
    const warnings = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry._meta?.logLevelName === 'ERROR') {
          errors.push(entry);
        } else if (entry._meta?.logLevelName === 'WARN') {
          warnings.push(entry);
        }
      } catch {}
    }

    // Recent errors (last 30)
    const recentErrors = errors.slice(-30);

    // Categorize errors
    const errorTypes = {};
    for (const e of recentErrors) {
      const msg = JSON.stringify(e['1'] || e['0'] || 'unknown');
      let category = 'unknown';
      if (msg.includes('handshake timeout')) category = 'ws_handshake_timeout';
      else if (msg.includes('Feishu') || msg.includes('feishu')) category = 'feishu';
      else if (msg.includes('delivery') && msg.includes('target')) category = 'feishu_delivery_target';
      else if (msg.includes('delivery')) category = 'delivery';
      else if (msg.includes('ECONNREFUSED')) category = 'connection_refused';
      else if (msg.includes('ENOENT')) category = 'file_not_found';
      else if (msg.includes('timeout')) category = 'timeout';
      else if (msg.includes('ECONNRESET')) category = 'conn_reset';
      errorTypes[category] = (errorTypes[category] || 0) + 1;
    }

    // High frequency handshake timeout (WS connections failing repeatedly)
    const wsTimeouts = errors.filter(e => {
      const msg = JSON.stringify(e['1'] || '');
      return msg.includes('handshake timeout');
    });
    if (wsTimeouts.length > 10) {
      const recentCount = wsTimeouts.filter(e => {
        const t = new Date(e.time).getTime();
        return Date.now() - t < 3600000; // last hour
      }).length;
      if (recentCount > 5) {
        alerts.push({
          type: 'ws_handshake_flood',
          severity: 'medium',
          component: 'Gateway',
          message: `WebSocket handshake timeout 频繁发生 (近1小时 ${recentCount} 次)`,
          detail: `总计 ${wsTimeouts.length} 次，分布在 ${errors.length} 条 ERROR 日志中`,
          fix: '检查外部客户端配置，可能存在错误的高频重连'
        });
      }
    }

    // Other error categories
    for (const [cat, count] of Object.entries(errorTypes)) {
      if (cat === 'ws_handshake_flood') continue;
      if (count < 3) continue;

      let severity = 'medium';
      if (count >= 10) severity = 'high';

      const catNames = {
        feishu: '飞书 delivery 错误',
        delivery: '消息投递错误',
        connection_refused: '连接被拒绝',
        file_not_found: '文件/路径不存在',
        timeout: '操作超时',
        unknown: '未知错误'
      };

      alerts.push({
        type: `log_error_${cat}`,
        severity,
        component: 'Gateway',
        message: `${catNames[cat] || cat}: ${count} 次`,
        detail: `来自 ${errors.length} 条 ERROR 日志`,
        fix: `检查 Gateway 日志: tail -100 ${logFile} | grep ERROR`
      });
    }

    // Log file health check
    const stats = fs.statSync(logFile);
    const ageMin = (Date.now() - stats.mtimeMs) / 60000;
    if (ageMin > 30) {
      alerts.push({
        type: 'log_stale',
        severity: 'high',
        component: 'Log',
        message: `日志文件 ${ageMin.toFixed(0)} 分钟未更新（Gateway 可能僵死）`,
        fix: '检查 Gateway 进程状态: ps aux | grep openclaw'
      });
    }

    // If no errors at all but we have many warnings, that's also interesting
    if (errors.length === 0 && warnings.length > 50) {
      alerts.push({
        type: 'high_warn_count',
        severity: 'low',
        component: 'Gateway',
        message: `日志中有 ${warnings.length} 条 WARN 但无 ERROR（可能存在潜在问题）`,
        fix: '检查 WARN 日志趋势'
      });
    }

  } catch (e) {
    alerts.push({
      type: 'log_read_failed',
      severity: 'medium',
      component: 'Log',
      message: `日志读取失败: ${e.message}`,
      fix: '手动检查: cat /tmp/openclaw/openclaw-*.log | tail -50'
    });
  }

  return alerts;
}

export { detect };