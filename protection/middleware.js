/**
 * OpenClaw 上下文中间件 - 反向代理版本 v2.0
 * 
 * 拦截 Webhook 请求，转发给 Gateway，同时调用上下文保护层
 * 
 * 工作流程:
 * 用户 → POST /webhook → 中间件 → 转发 Gateway
 *                          ↓
 *                    异步调用保护层
 */

import { createServer } from 'http';
import { contextProtector } from './context_protector.js';
import { securityGate } from './security_gate.js';

const PORT = parseInt(process.env.MIDDLEWARE_PORT || '3002');
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const CONTEXT_TIMEOUT_MS = parseInt(process.env.CONTEXT_TIMEOUT_MS || '2000');

const server = createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // 健康检查
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: Date.now(), service: 'middleware' }));
    return;
  }

  // Webhook 拦截
  if (req.url === '/webhook' && req.method === 'POST') {
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
      }
      
      let data;
      try {
        data = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      // 提取消息内容（适配飞书格式）
      const content = data.message || data.text || data.content || data.msg || '';
      const userId = data.user_id || data.userId || data.sender || 'unknown';
      const taskId = data.task_id || data.taskId || null;

      // 异步调用上下文保护层（不阻塞）
      if (content) {
        this.callContextApi({
          role: 'user',
          content: content,
          taskId: taskId,
          userId: userId,
          timestamp: Date.now()
        }).catch(err => {
          console.log('[Middleware] 上下文记录失败:', err.message);
        });
      }

      // 转发到 Gateway
      const gatewayReq = require('http').request(GATEWAY_URL + '/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': req.socket.remoteAddress
        }
      }, (gatewayRes) => {
        let responseBody = '';
        gatewayRes.on('data', chunk => responseBody += chunk);
        gatewayRes.on('end', () => {
          res.writeHead(gatewayRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(responseBody);
        });
      });

      gatewayReq.on('error', (err) => {
        console.log('[Middleware] Gateway 转发失败:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Gateway unreachable' }));
      });

      gatewayReq.write(body);
      gatewayReq.end();

    } catch (error) {
      console.error('[Middleware] 处理错误:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // 其他路径也转发到 Gateway
  if (req.url.startsWith('/')) {
    const targetUrl = GATEWAY_URL + req.url;
    
    const options = {
      hostname: require('url').parse(targetUrl).hostname,
      port: require('url').parse(targetUrl).port,
      path: require('url').parse(targetUrl).path,
      method: req.method,
      headers: req.headers
    };

    const proxyReq = require('http').request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', (err) => {
      res.writeHead(502);
      res.end('Gateway error');
    });

    req.pipe(proxyReq, { end: true });
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

// 异步调用上下文保护层
server.callContextApi = async (msgData) => {
  try {
    const response = await fetch('http://127.0.0.1:18790/api/context/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msgData),
      signal: AbortSignal.timeout(CONTEXT_TIMEOUT_MS)
    });
    return await response.json();
  } catch (err) {
    throw err;
  }
};

server.listen(PORT, () => {
  console.log(`[Middleware] 反向代理中间件已启动: http://127.0.0.1:${PORT}`);
  console.log(`[Middleware] Gateway 地址: ${GATEWAY_URL}`);
  console.log(`[Middleware] 上下文API: http://127.0.0.1:18790`);
  console.log(`[Middleware] 上下文超时: ${CONTEXT_TIMEOUT_MS}ms`);
});

export default server;