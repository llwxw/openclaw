#!/usr/bin/env node
/**
 * v8 Router - Minimal HTTP router on port 3102
 * Proxies /api/score → 3103 (scorer)
 * Proxies /classify  → 3105 (classifier)
 * Health check on /health
 */
const http = require('http');

const SCORER_URL = 'http://127.0.0.1:3103';
const CLASSIFIER_URL = 'http://127.0.0.1:3105';
const PORT = 3102;
const HOST = '127.0.0.1'; // 本地监听

function proxy(req, res, target, path) {
  const headers = { ...req.headers };
  delete headers['host'];
  delete headers['connection'];
  const proxyReq = http.request(target + path, {
    method: req.method,
    headers,
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', (e) => {
    res.writeHead(502);
    res.end(JSON.stringify({ error: e.message }));
  });
  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'v8-router', port: PORT }));
    return;
  }

  if (url.pathname === '/api/score' || url.pathname === '/score') {
    proxy(req, res, SCORER_URL, url.pathname);
    return;
  }

  if (url.pathname === '/classify') {
    proxy(req, res, CLASSIFIER_URL, url.pathname);
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found', pathname: url.pathname }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[v8-router] Listening on ${PORT}`);
  console.log(`  /health      → 200 OK`);
  console.log(`  /api/score   → proxy to ${SCORER_URL}`);
  console.log(`  /classify    → proxy to ${CLASSIFIER_URL}`);
});
