#!/usr/bin/env node
/**
 * Context Monitor - 直接操作 session context 文件
 * 超过阈值时自动压缩
 */

const fs = require('fs');
const path = require('path');

const SESSION_PATH = '/home/ai/.openclaw/sessions/agent:main:main/context.json';
const MEMORY_DIR = '/home/ai/.openclaw/workspace/memory';
const MAX_TOKENS = 140000;        // 140K token 上限
const SUMMARIZE_AT = 120000;     // 120K 时触发摘要
const PRESERVE_RECENT = 15;      // 保留最近 15 轮

function countTokens(text) {
  if (!text) return 0;
  const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const other = text.length - chinese;
  return Math.ceil(chinese / 1.5 + other / 4);
}

function countSessionTokens(messages) {
  return messages.reduce((sum, m) => {
    return sum + countTokens(m.content || '') + countTokens(m.name || '') + 20;
  }, 0);
}

function generateSummary(messages) {
  const text = messages.map(m => `${m.role}: ${m.content || ''}`).join('\n');
  if (text.length < 100) return text;
  return text.slice(0, 3000) + (text.length > 3000 ? '\n...[内容已截断]...' : '');
}

async function compact(contextPath) {
  const data = JSON.parse(fs.readFileSync(contextPath, 'utf8'));
  const messages = data.messages || [];
  
  const systemMsgs = messages.filter(m => m.role === 'system');
  const recentMsgs = messages.slice(-PRESERVE_RECENT);
  const oldMessages = messages.slice(0, -PRESERVE_RECENT);
  
  if (oldMessages.length === 0) {
    console.log('[context-monitor] No old messages to compact');
    return false;
  }
  
  const summaryText = generateSummary(oldMessages);
  const summaryMsg = {
    role: 'system',
    content: `[会话历史摘要 - ${oldMessages.length} 条消息已压缩]: ${summaryText.slice(0, 2000)}`
  };
  
  const compacted = [summaryMsg, ...recentMsgs];
  
  data.messages = compacted;
  fs.writeFileSync(contextPath, JSON.stringify(data, null, 2));
  
  console.log(`[context-monitor] 压缩成功: ${messages.length} → ${compacted.length} 条消息`);
  return true;
}

async function main() {
  try {
    if (!fs.existsSync(SESSION_PATH)) {
      console.log('[context-monitor] Session file not found, skip');
      return;
    }
    
    const data = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
    const messages = data.messages || [];
    
    if (messages.length < 20) {
      console.log(`[context-monitor] Session has ${messages.length} messages, skip (under threshold)`);
      return;
    }
    
    const tokens = countSessionTokens(messages);
    console.log(`[context-monitor] Session: ${messages.length} messages, ~${tokens} tokens, limit=${SUMMARIZE_AT}`);
    
    if (tokens > SUMMARIZE_AT) {
      console.log(`[context-monitor] Threshold exceeded! Compacting...`);
      await compact(SESSION_PATH);
    } else {
      console.log(`[context-monitor] Context OK (${Math.round(tokens/SUMMARIZE_AT*100)}% of threshold)`);
    }
  } catch (err) {
    console.error(`[context-monitor] Error: ${err.message}`);
  }
}

main();
