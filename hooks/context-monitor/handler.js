/**
 * Context Monitor Hook - OpenClaw
 * 事件: message:preprocessed, agent:response
 * 功能: 监控 session context token 数量，超限时自动压缩
 */
import fs from 'node:fs';
import path from 'node:path';

const CONFIG_PATH = '/home/ai/.openclaw/openclaw.json';

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const config = JSON.parse(raw);
    const ctx = config.context || {};
    return {
      maxTokens:          ctx.maxContextTokens      || 160000,
      threshold:          ctx.summarizeThreshold    || 0.75,
      preserveRecent:     ctx.preserveRecentTurns   || 10,
      enabled:            ctx.monitoringEnabled !== false,
    };
  } catch {
    // Config unreadable — default to disabled
    return null;
  }
}

function countTokensForText(text) {
  if (!text) return 0;
  const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const other   = text.length - chinese;
  return Math.ceil(chinese / 1.5 + other / 4);
}

function countSessionTokens(messages) {
  return messages.reduce((sum, m) => {
    return sum
      + countTokensForText(m.content || '')
      + countTokensForText(m.name    || '')
      + 20; // overhead per message
  }, 0);
}

function getContextPath(sessionKey) {
  const base = process.env.OPENCLAW_STATE_DIR || '/home/ai/.openclaw';
  // sessionKey format: agent:main:main  →  agent:main:main
  // or agent:main:subagent:uuid
  const safe = sessionKey.replace(/:/g, '_');
  return path.join(base, 'sessions', safe, 'context.json');
}

async function compress(messages, preserveRecent) {
  const systemMsgs = messages.filter(m => m.role === 'system');
  const recentMsgs = messages.slice(-preserveRecent);
  const oldMsgs    = messages.slice(0, -preserveRecent);

  // Build a single summary message from the old batch
  const summaryContent = oldMsgs
    .map(m => `${m.role}: ${(m.content || '').slice(0, 150)}`)
    .join('\n');

  return [
    ...systemMsgs,
    {
      role: 'system',
      content: `[Compacted ${oldMsgs.length} previous messages]: ${summaryContent.slice(0, 2000)}`,
    },
    ...recentMsgs,
  ];
}

async function handleEvent(event) {
  const config = loadConfig();
  if (!config || !config.enabled) return;

  const sessionKey = event.sessionKey;
  if (!sessionKey) return;

  const ctxPath = getContextPath(sessionKey);

  let sessionData;
  try {
    sessionData = JSON.parse(fs.readFileSync(ctxPath, 'utf8'));
  } catch {
    // No context file yet — skip
    return;
  }

  const messages = sessionData.messages || [];
  if (messages.length < 6) return; // Nothing to compress

  const tokens   = countSessionTokens(messages);
  const limit    = config.maxTokens * config.threshold;

  // Log each check (throttle by only logging when > 60%)
  if (tokens > limit * 0.6) {
    console.log(`[context-monitor] session=${sessionKey} tokens=${tokens}/${limit} (${Math.round(tokens/limit*100)}%)`);
  }

  if (tokens > limit) {
    console.log(`[context-monitor] COMPACTING ${messages.length} messages...`);
    const compacted = await compress(messages, config.preserveRecent);
    sessionData.messages = compacted;
    fs.writeFileSync(ctxPath, JSON.stringify(sessionData, null, 2));
    console.log(`[context-monitor] Done: ${messages.length} → ${compacted.length} messages`);
  }
}

export default async function handler(event) {
  if (event.type !== 'message' && event.type !== 'agent') return;
  if (event.action !== 'preprocessed' && event.action !== 'response') return;

  try {
    await handleEvent(event);
  } catch (err) {
    console.error(`[context-monitor] ERROR: ${err.message}`);
  }
}
