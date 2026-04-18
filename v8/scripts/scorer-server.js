#!/usr/bin/env node
/**
 * v8 Scoring HTTP Server
 * Wraps scoring.js as an HTTP API on port 3103
 */

const http = require('http');
const scoring = require('../src/scoring/scoring');

const PORT = process.env.PORT || 3103;
const HOST = process.env.HOST || '0.0.0.0';

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
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

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // Health check
  if (url.pathname === '/health' || url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'v8-scorer', port: PORT }));
    return;
  }

  // Score endpoint
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
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Not found
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, HOST, () => {
  console.log(`[scorer] v8 scoring server running on http://${HOST}:${PORT}`);
  console.log(`[scorer] Endpoint: POST /api/score { prompt: "..." }`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[scorer] SIGTERM, shutting down');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('[scorer] SIGINT, shutting down');
  server.close(() => process.exit(0));
});
