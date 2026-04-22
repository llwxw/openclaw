/**
 * OpenClaw Context HTTP Server + Monitor v2
 * 架构：detector → aggregator → renderer
 */

import { createServer } from 'http';
import { aggregate } from '../monitor/aggregator.js';
import { render } from '../monitor/renderer.js';

const PORT = process.env.CONTEXT_SERVER_PORT || 18790;

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // === 路由 ===
  
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', port: PORT }));
    return;
  }

  // 监控面板 v2
  if (req.url === '/status' && req.method === 'GET') {
    try {
      const data = await aggregate();
      const html = render(data);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Monitor error: ' + e.message);
    }
    return;
  }

  // 原有 API 保持兼容
  if (req.url === '/api/truncate' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'use protection service' }));
    return;
  }

  // 404
  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`[Monitor] HTTP 服务已启动: http://127.0.0.1:${PORT}`);
  console.log('[Monitor] 可用端点:');
  console.log('  GET  /status - 监控面板 (v2)');
  console.log('  GET  /health - 健康检查');
});

export default server;
