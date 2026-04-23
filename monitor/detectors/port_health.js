/**
 * Port Health Detector
 * 检测关键端口连通性
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execP = promisify(exec);

const PORTS = [
  { port: 18789, name: 'Gateway', expected: 'openclaw-gateway' },
  { port: 3101, name: 'Context-API', expected: '' },
  { port: 3102, name: 'Router', expected: 'router-server' },
  { port: 3103, name: 'Scorer', expected: 'scorer-server' },
  { port: 3105, name: 'Classifier', expected: '' },
];

async function checkPort(port) {
  try {
    const { stdout } = await execP(`ss -tlnp 2>/dev/null | grep ':${port}' || netstat -tlnp 2>/dev/null | grep ':${port}'`, { timeout: 3000 });
    if (stdout.trim()) {
      return { ok: true, detail: stdout.trim() };
    }
    return { ok: false, detail: 'not listening' };
  } catch {
    return { ok: false, detail: 'ss/netstat failed' };
  }
}

async function detect() {
  const alerts = [];

  for (const p of PORTS) {
    const result = await checkPort(p.port);
    if (!result.ok) {
      alerts.push({
        type: 'port_down',
        severity: 'high',
        component: p.name,
        message: `${p.name} 端口 ${p.port} 未监听`,
        detail: result.detail,
        fix: `检查 ${p.name} 进程是否存活，或重启相关服务`
      });
    } else {
      // Extract listening address
      const match = result.detail.match(/(\d+\.\d+\.\d+\.\d+|\[::\]):(\d+)/);
      if (match) {
        const addr = match[1] === '::' ? 'loopback' : match[1];
        if (addr !== '127.0.0.1' && addr !== 'loopback' && p.name === 'Gateway') {
          alerts.push({
            type: 'port_exposed',
            severity: 'medium',
            component: p.name,
            message: `${p.name} 监听在 ${addr}（非 loopback）`,
            detail: result.detail,
            fix: '如需限制访问，在 openclaw.json 中设置 gateway.bind=loopback'
          });
        }
      }
    }
  }

  return alerts;
}

export { detect };