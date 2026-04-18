/**
 * OpenClaw Context HTTP Server
 * 接收来自 Hook 的消息，调用保护层
 */

import { createServer } from 'http';
import { contextProtector } from './context_protector.js';
import { securityGate } from './security_gate.js';

const PORT = process.env.CONTEXT_SERVER_PORT || 18790;

const server = createServer(async (req, res) => {
  // 设置 CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // 路由
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', port: PORT }));
    return;
  }

  if (req.url === '/api/context/add' && req.method === 'POST') {
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
      }
      
      const data = JSON.parse(body);
      const { role, content, user, channel } = data;
      
      // 安全检查 - 简单限流
      const clientIp = req.socket.remoteAddress;
      try {
        securityGate.rateLimit(clientIp);
      } catch (e) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'rate limit exceeded' }));
        return;
      }
      
      // 调用保护层
      const result = contextProtector.onNewMessage({
        role: role || 'user',
        content: content || '',
        timestamp: new Date().toISOString()
      });
      
      console.log(`[ContextServer] 记录消息: ${role} - ${String(content).slice(0, 30)}`);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, result }));
      
    } catch (error) {
      console.error('[ContextServer] 错误:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (req.url === '/api/context/status' && req.method === 'GET') {
    const status = contextProtector.getStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
    return;
  }

  // 404
  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`[ContextServer] HTTP 服务已启动: http://127.0.0.1:${PORT}`);
  console.log('[ContextServer] 可用端点:');
  console.log('  GET  /health - 健康检查');
  console.log('  POST /api/context/add - 添加消息');
  console.log('  GET  /api/context/status - 获取状态');
});

export default server;