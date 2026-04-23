/**
 * Monitor Server - 18790
 * 诊断型健康检查页面
 * 端口: 18790
 * 路由:
 *   GET /          - HTML 诊断面板
 *   GET /status    - JSON 诊断数据
 *   GET /health    - 简单健康检查 (用于负载均衡探针)
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18790;

// Import aggregator
const DETECTORS_DIR = path.join(__dirname, 'detectors');

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

async function aggregate() {
  const result = {
    ts: new Date().toISOString(),
    alerts: [],
    summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, ok: 0 },
    components: {}
  };

  try {
    const files = fs.readdirSync(DETECTORS_DIR).filter(f => f.endsWith('.js'));

    for (const file of files) {
      try {
        const detectorPath = path.join(DETECTORS_DIR, file);
        const mod = await import(`file://${detectorPath}`);
        const detectFn = mod.detect || mod.default?.detect;
        if (!detectFn) continue;

        const alerts = await detectFn();
        for (const alert of alerts) {
          alert.source = file.replace('.js', '');
          result.alerts.push(alert);
          const sev = alert.severity || 'low';
          result.summary[sev]++;
          result.summary.total++;

          // Group by component
          const comp = alert.component || 'Unknown';
          if (!result.components[comp]) result.components[comp] = [];
          result.components[comp].push(alert);
        }
      } catch (e) {
        // skip
      }
    }

    // Sort by severity
    result.alerts.sort((a, b) => {
      const ao = SEVERITY_ORDER[a.severity] ?? 9;
      const bo = SEVERITY_ORDER[b.severity] ?? 9;
      return ao - bo;
    });

    // Count OK components
    const knownComponents = ['Gateway', 'ws-proxy', 'listener', 'scorer', 'router', 'Cron', 'Log'];
    for (const c of knownComponents) {
      if (!result.components[c] || result.components[c].length === 0) {
        result.summary.ok++;
      }
    }

  } catch (e) {
    result.error = e.message;
  }

  return result;
}

function renderHTML(data) {
  const { alerts, summary, components, ts, error } = data;

  const statusIcon = summary.total === 0 ? '✅' : summary.critical > 0 ? '🔴' : summary.high > 0 ? '🔴' : '⚠️';
  const statusText = summary.total === 0 ? '系统正常' : summary.critical > 0 ? `严重问题 (${summary.critical}个)` : `有问题 (${summary.total}个)`;
  const statusClass = summary.total === 0 ? 'status-ok' : summary.critical > 0 ? 'status-error' : 'status-warn';

  const alertRows = alerts.map(a => {
    const sevColor = { critical: '#ff4444', high: '#ff6644', medium: '#ffaa00', low: '#888' }[a.severity] || '#888';
    return `
    <div class="alert-item ${a.severity}">
      <div class="alert-header">
        <span class="sev-dot" style="background:${sevColor}"></span>
        <span class="alert-type">${a.type}</span>
        <span class="alert-comp">${a.component}</span>
        <span class="alert-sev">${a.severity}</span>
      </div>
      <div class="alert-msg">${a.message}</div>
      ${a.detail ? `<div class="alert-detail">${a.detail}</div>` : ''}
      ${a.fix ? `<div class="alert-fix">🔧 ${a.fix}</div>` : ''}
    </div>`;
  }).join('');

  const lastCheck = new Date(ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><title>OpenClaw 诊断面板</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#0f0f1a;color:#ddd;min-height:100vh;padding:24px}
.status-bar{display:flex;align-items:center;gap:16px;padding:24px;background:#1a1a2e;border-radius:12px;margin-bottom:24px}
.status-icon{font-size:56px}
.status-text h1{margin:0;font-size:22px;color:#fff}
.status-text p{margin:4px 0 0;color:#888;font-size:14px}
.status-ok{background:#0f2a1a}
.status-warn{background:#2a2000}
.status-error{background:#2a0f0f}
.sum-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:24px}
.sum-card{background:#1a1a2e;padding:16px;border-radius:8px;text-align:center}
.sum-card.ok{background:#0f2a1a;border:1px solid #1a4a2a}
.sum-card .num{font-size:28px;font-weight:700;color:#fff}
.sum-card .lab{font-size:12px;color:#888;margin-top:4px}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:24px}
.panel{background:#1a1a2e;border-radius:8px;padding:16px}
.panel h2{font-size:16px;color:#888;margin:0 0 12px;border-bottom:1px solid #2a2a3e;padding-bottom:8px}
.alert-item{background:#12121f;border-radius:6px;padding:12px;margin-bottom:8px;border-left:3px solid}
.alert-item.critical{border-color:#ff4444}
.alert-item.high{border-color:#ff6644}
.alert-item.medium{border-color:#ffaa00}
.alert-item.low{border-color:#555}
.alert-header{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.sev-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.alert-type{font-weight:600;color:#fff;font-size:13px}
.alert-comp{color:#888;font-size:12px;margin-left:auto}
.alert-sev{font-size:11px;padding:2px 6px;border-radius:4px;background:#2a2a3e;color:#888}
.alert-msg{font-size:14px;color:#ddd}
.alert-detail{font-size:12px;color:#666;margin-top:4px}
.alert-fix{font-size:12px;color:#4a9;margin-top:6px;padding:6px;background:#0f2a1a;border-radius:4px}
.comp-list{list-style:none}
.comp-list li{padding:8px 0;border-bottom:1px solid #2a2a3e;display:flex;justify-content:space-between}
.comp-list li:last-child{border:none}
.comp-name{color:#ddd}
.comp-count{font-size:13px;padding:2px 8px;border-radius:10px;background:#2a2a3e;color:#888}
.footer{text-align:center;color:#555;font-size:12px;margin-top:24px}
.no-alerts{color:#4a9;font-size:15px;text-align:center;padding:32px}
</style></head><body>
<div class="status-bar ${statusClass}">
  <span class="status-icon">${statusIcon}</span>
  <div class="status-text">
    <h1>${statusText}</h1>
    <p>最后检查: ${lastCheck}</p>
  </div>
</div>

<div class="sum-grid">
  <div class="sum-card ${summary.ok === 5 && summary.total === 0 ? 'ok' : ''}">
    <div class="num">${summary.ok}</div>
    <div class="lab">正常组件</div>
  </div>
  <div class="sum-card">
    <div class="num" style="color:#ff4444">${summary.critical}</div>
    <div class="lab">严重</div>
  </div>
  <div class="sum-card">
    <div class="num" style="color:#ff6644">${summary.high}</div>
    <div class="lab">高</div>
  </div>
  <div class="sum-card">
    <div class="num" style="color:#ffaa00">${summary.medium}</div>
    <div class="lab">中</div>
  </div>
  <div class="sum-card">
    <div class="num">${summary.low}</div>
    <div class="lab">低</div>
  </div>
</div>

<div class="grid-2">
  <div class="panel">
    <h2>告警详情</h2>
    ${alertRows || '<div class="no-alerts">✅ 暂无告警</div>'}
  </div>
  <div class="panel">
    <h2>组件状态</h2>
    <ul class="comp-list">
      ${['Gateway', 'ws-proxy', 'listener', 'scorer', 'router', 'Cron', 'Log'].map(c => {
        const comp = components[c] || [];
        const ok = comp.length === 0;
        return `<li>
          <span class="comp-name">${c}</span>
          <span class="comp-count" style="background:${ok ? '#0f2a1a' : '#2a1a0f'};color:${ok ? '#4a9' : '#f88'}">
            ${ok ? '✅ 正常' : comp.length + ' 告警'}
          </span>
        </li>`;
      }).join('')}
    </ul>
  </div>
</div>

<div class="footer">
  OpenClaw Monitor · <a href="/status" style="color:#666">JSON</a> · <a href="/health" style="color:#666">Health</a>
</div>
</body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const data = await aggregate();
    res.end(JSON.stringify(data, null, 2));
    return;
  }

  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const data = await aggregate();
    res.end(renderHTML(data));
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Monitor server running at http://127.0.0.1:${PORT}/`);
});

process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT', () => { server.close(); process.exit(0); });