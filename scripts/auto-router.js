#!/usr/bin/env node
/**
 * Auto-Router Hook
 * 监听 agent:preparing 事件，检查评分，超阈值自动 fork 子 agent
 * 
 * 触发时机：auto-score-classify 写入 ephemeral 之后
 * 阈值：score >= 40 → SPAWN_SUBAGENT
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const EPHEMERAL_DIR = '/home/ai/.openclaw/workspace/memory/ephemeral';
const SCORE_THRESHOLD = 40;
const GW_URL = 'http://127.0.0.1:18789';
const GW_TOKEN = '5e7ab299281fb2ffbdbb922f9939d9abbe5e15321f6cb901';

// 找最新的 ephemeral
function getLatestEphemeral() {
  const files = fs.readdirSync(EPHEMERAL_DIR)
    .filter(f => f.endsWith('.jsonl') && f.startsWith('2026'))
    .map(f => ({
      name: f,
      mtime: fs.statSync(path.join(EPHEMERAL_DIR, f)).mtime
    }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0]?.name;
}

// 读最新 ephemeral 最后一行
function getLatestScore() {
  const latest = getLatestEphemeral();
  if (!latest) return null;
  
  const lines = fs.readFileSync(path.join(EPHEMERAL_DIR, latest), 'utf8')
    .trim().split('\n');
  
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.score !== undefined) {
        return entry.score;
      }
    } catch {}
  }
  return null;
}

// 通过 ACP 协议 spawn 子 agent
function spawnSubagent(message, score) {
  const args = [
    '/home/ai/.nvm/versions/node/v22.22.1/bin/node',
    '/home/ai/.nvm/versions/node/v22.22.1/lib/node_modules/openclaw/openclaw.mjs',
    'agent',
    '--session', `agent:main:subagent:${Date.now()}`,
    '--message', message,
    '--score', String(score),
    '--deliver'
  ];
  
  const proc = spawn(args[0], args.slice(1), {
    detached: true,
    stdio: 'ignore'
  });
  proc.unref();
  console.log(`[auto-router] Spawned subagent for score=${score}`);
}

async function main() {
  const event = process.env.OPENCLAW_EVENT || '';
  
  // 等待 auto-score-classify 完成
  await new Promise(r => setTimeout(r, 500));
  
  const score = getLatestScore();
  if (score === null) {
    console.log('[auto-router] No score found');
    return;
  }
  
  console.log(`[auto-router] Latest score: ${score}`);
  
  if (score >= SCORE_THRESHOLD) {
    const message = process.env.OPENCLAW_MESSAGE || '';
    if (message) {
      spawnSubagent(message, score);
    }
  }
}

main().catch(console.error);
