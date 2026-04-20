#!/usr/bin/env node
/**
 * v8 Scoring HTTP Server
 * Wraps scoring.js as an HTTP API on port 3103
 */

const http = require('http');
const scoring = require('../src/scoring/scoring');

const PORT = process.env.PORT || 3103;
const HOST = process.env.HOST || '127.0.0.1'; // 改为本地监听
const MAX_BODY_SIZE = 1_000_000; // 1MB 限制

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health' || url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'v8-scorer', port: PORT }));
    return;
  }

  if (req.method === 'POST' && (url.pathname === '/api/score' || url.pathname === '/score')) {
    try {
      const body = await parseBody(req);
      const prompt = body.prompt || body.text || body.messages?.[0]?.text || '';
      const context = body.context || {};

      const result = scoring.scoreTask(prompt, context);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('[scorer] Error:', err.message);
      const status = err.message.includes('too large') ? 413 : 500;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, HOST, () => {
  console.log(`[scorer] v8 scoring server running on http://${HOST}:${PORT}`);
  console.log(`[scorer] Endpoint: POST /api/score { prompt: "..." }`);
  console.log(`[scorer] Max body size: ${MAX_BODY_SIZE} bytes`);
});

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
