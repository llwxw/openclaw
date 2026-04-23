/**
 * Process Health Detector
 * 检测关键进程存活 + 资源占用
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execP = promisify(exec);

const PROCESSES = [
  { name: 'Gateway', pid: 584, cmd: 'openclaw-gateway' },
  { name: 'ws-proxy', pid: 442, cmd: 'ws-proxy.js' },
  { name: 'listener', pid: 585, cmd: 'openclaw-listener' },
  { name: 'scorer', pid: 589, cmd: 'scorer-server.js' },
  { name: 'router', pid: 590, cmd: 'router-server.js' },
];

function parseMem(memStr) {
  // "70016" is KB, convert to MB
  const kb = parseInt(memStr);
  return (kb / 1024).toFixed(1) + 'MB';
}

export async function detect() {
  const alerts = [];

  // Check gateway directly via openclaw status
  try {
    const fs = require('fs');
    const logPath = '/tmp/openclaw/openclaw-2026-04-23.log';
    if (fs.existsSync(logPath)) {
      const stats = fs.statSync(logPath);
      const ageMin = (Date.now() - stats.mtimeMs) / 60000;
      if (ageMin > 10) {
        alerts.push({
          type: 'gateway_log_stale',
          severity: 'high',
          component: 'Gateway',
          message: `日志文件超过 ${Math.round(ageMin)} 分钟未更新`,
          detail: `最后修改: ${new Date(stats.mtimeMs).toISOString()}`,
          fix: '检查 gateway 进程是否僵死，考虑 restart'
        });
      }
    }
  } catch (e) {}

  // Check process list
  try {
    const { stdout } = await execP('ps aux | grep -E "openclaw|ws-proxy|scorer|listener|router" | grep -v grep | grep -v snap', { timeout: 5000 });
    const lines = stdout.trim().split('\n');

    // Gateway check
    const gatewayLine = lines.find(l => l.includes('openclaw-gateway') || l.includes('dist/index.js'));
    if (gatewayLine) {
      const parts = gatewayLine.trim().split(/\s+/);
      const cpu = parts[2];
      const mem = parseMem(parts[5]);
      const pid = parts[1];
      if (parseFloat(cpu) > 80) {
        alerts.push({
          type: 'high_cpu',
          severity: 'medium',
          component: 'Gateway',
          message: `CPU 使用率 ${cpu}%（偏高）`,
          pid,
          fix: '持续高 CPU 需关注，可能是任务积压或死循环'
        });
      }
    } else {
      alerts.push({
        type: 'process_dead',
        severity: 'critical',
        component: 'Gateway',
        message: 'Gateway 进程未运行',
        fix: '执行: openclaw gateway restart'
      });
    }

    // Check other critical processes
    for (const p of PROCESSES) {
      if (p.name === 'Gateway') continue;
      const found = lines.find(l => l.includes(p.cmd));
      if (!found) {
        alerts.push({
          type: 'process_dead',
          severity: 'high',
          component: p.name,
          message: `${p.name} (pid ${p.pid}) 进程未运行`,
          fix: `执行: openclaw gateway restart`
        });
      }
    }
  } catch (e) {
    alerts.push({
      type: 'ps_failed',
      severity: 'medium',
      component: 'System',
      message: `ps 命令执行失败: ${e.message}`,
      fix: '手动执行: ps aux | grep openclaw'
    });
  }

  return alerts;
}