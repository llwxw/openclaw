require('dotenv').config();
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const pino = require('pino');

const app = express();
app.use(express.json());

// 配置
const PORT = process.env.PORT || 3101;
const LLM_API_URL = process.env.LLM_API_URL || 'http://localhost:11434/api/generate';
const LLM_MODEL = process.env.LLM_MODEL || 'qwen2.5:7b';
const LLM_TIMEOUT = parseInt(process.env.LLM_TIMEOUT) || 30000;
const MAX_TOKENS = parseInt(process.env.MAX_CONTEXT_TOKENS) || 128000;
const THRESHOLD = parseFloat(process.env.COMPRESSION_THRESHOLD) || 0.8;
const MIN_MESSAGES = parseInt(process.env.MIN_MESSAGES_BEFORE_COMPRESS) || 6;
const KEEP_RECENT = parseInt(process.env.KEEP_RECENT_MESSAGES) || 5;
const MEMORY_DIR = process.env.MEMORY_DIR || './memory';

// 日志
const logger = pino({
 level: process.env.LOG_LEVEL || 'info'
 
});

// 运行时状态
let sessionMessages = [];
let sessionId = 'default';
let lastSummary = '';
let compressionCount = 0;
const metrics = { requests: 0, compressions: 0, llmFailures: 0 };

// 确保存储目录存在
fs.mkdir(MEMORY_DIR, { recursive: true }).catch(e => logger.error(e, 'Failed to create memory dir'));

// 加载最近一次会话快照（可选）
async function loadLatestSnapshot() {
 try {
 const files = await fs.readdir(MEMORY_DIR);
 const snapshots = files.filter(f => f.endsWith('.json')).sort().reverse();
 if (snapshots.length > 0) {
 const data = await fs.readFile(path.join(MEMORY_DIR, snapshots[0]), 'utf-8');
 const snapshot = JSON.parse(data);
 sessionMessages = snapshot.messages || [];
 lastSummary = snapshot.summary || '';
 sessionId = snapshot.sessionId || 'default';
 logger.info({ sessionId, messageCount: sessionMessages.length }, 'Loaded latest snapshot');
 }
 } catch (err) {
 logger.warn(err, 'No snapshot loaded, starting fresh');
 }
}

// Token 估算 (1 token ≈ 4 chars)
function estimateTokens(text) {
 return Math.ceil(text.length / 4);
}

function getCurrentTokenCount() {
 const fullText = sessionMessages.map(m => `${m.role}: ${m.content}`).join('\n');
 return estimateTokens(fullText);
}

// 降级摘要：直接截断
function fallbackSummary(messages) {
 const text = messages.map(m => `${m.role}: ${m.content}`).join('\n');
 return text.slice(0, 1500) + (text.length > 1500 ? '...[已截断]' : '');
}

// 调用 LLM 生成摘要
async function generateSummary(messages) {
 const text = messages.map(m => `${m.role}: ${m.content}`).join('\n');
 const prompt = `请将以下对话历史压缩为一段简洁的摘要，保留关键信息（用户目标、重要决策、未完成任务），去除冗余寒暄和重复内容。\n\n${text}\n\n摘要：`;

 try {
 const response = await axios.post(LLM_API_URL, {
 model: LLM_MODEL,
 prompt: prompt,
 stream: false,
 options: { temperature: 0.3, max_tokens: 800 }
 }, { timeout: LLM_TIMEOUT });

 const summary = response.data.response || response.data.message?.content;
 if (!summary) throw new Error('Empty LLM response');
 logger.debug({ length: summary.length }, 'LLM summary generated');
 return summary;
 } catch (err) {
 metrics.llmFailures++;
 logger.warn(err.message, 'LLM summary failed, using fallback');
 return fallbackSummary(messages);
 }
}

// 压缩上下文
async function compressContext() {
 if (sessionMessages.length < MIN_MESSAGES) {
 logger.debug({ count: sessionMessages.length }, 'Too few messages to compress');
 return false;
 }

 const systemMessages = sessionMessages.filter(m => m.role === 'system');
 const recentMessages = sessionMessages.slice(-KEEP_RECENT);
 const olderMessages = sessionMessages.slice(0, -KEEP_RECENT);

 if (olderMessages.length === 0) return false;

 logger.info({ older: olderMessages.length, recent: recentMessages.length }, 'Starting context compression');
 const summary = await generateSummary(olderMessages);
 lastSummary = summary;

 const compressed = [
 ...systemMessages,
 { role: 'assistant', content: `[对话历史摘要]: ${summary}` },
 ...recentMessages
 ];

 sessionMessages = compressed;
 compressionCount++;
 metrics.compressions++;

 // 保存快照
 const snapshot = {
 sessionId,
 summary,
 messages: compressed,
 compressedAt: new Date().toISOString(),
 tokenCount: getCurrentTokenCount()
 };
 const snapshotPath = path.join(MEMORY_DIR, `${sessionId}_${Date.now()}.json`);
 await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));

 logger.info({ newTokenCount: snapshot.tokenCount }, 'Context compressed');
 return true;
}

// 添加消息并触发检查
async function addMessage(role, content) {
 sessionMessages.push({ role, content, timestamp: new Date().toISOString() });

 const tokenCount = getCurrentTokenCount();
 const usageRatio = tokenCount / MAX_TOKENS;

 logger.debug({ tokenCount, max: MAX_TOKENS, ratio: usageRatio.toFixed(2) }, 'Message added');

 if (usageRatio > THRESHOLD) {
 await compressContext();
 }
}

// ----------------------------------------------------------------------------
// API 端点
// ----------------------------------------------------------------------------

app.use((req, res, next) => {
 metrics.requests++;
 next();
});

app.post('/api/context', async (req, res) => {
 const { role, content, session } = req.body;
 if (!role || !content) {
 return res.status(400).json({ error: 'role and content required' });
 }

 if (session) sessionId = session;
 await addMessage(role, content);

 const tokenCount = getCurrentTokenCount();
 res.json({
 status: 'stored',
 sessionId,
 tokenCount,
 maxTokens: MAX_TOKENS,
 usagePercent: (tokenCount / MAX_TOKENS * 100).toFixed(1),
 compressed: compressionCount > 0
 });
});

app.get('/api/context/status', (req, res) => {
 res.json({
 sessionId,
 messageCount: sessionMessages.length,
 tokenCount: getCurrentTokenCount(),
 maxTokens: MAX_TOKENS,
 threshold: THRESHOLD,
 lastSummaryPreview: lastSummary ? lastSummary.slice(0, 200) + '...' : null,
 compressionCount,
 metrics: { ...metrics }
 });
});

app.get('/api/context/full', (req, res) => {
 res.json({
 sessionId,
 messages: sessionMessages,
 tokenCount: getCurrentTokenCount()
 });
});

app.post('/api/context/compress', async (req, res) => {
 const before = sessionMessages.length;
 const success = await compressContext();
 res.json({
 compressed: success,
 beforeCount: before,
 afterCount: sessionMessages.length,
 tokenCount: getCurrentTokenCount()
 });
});

app.post('/api/context/clear', (req, res) => {
 const { session } = req.body;
 sessionMessages = [];
 lastSummary = '';
 compressionCount = 0;
 if (session) sessionId = session;
 logger.info({ sessionId }, 'Context cleared');
 res.json({ status: 'cleared', sessionId });
});

app.get('/health', (req, res) => {
 res.json({
 status: 'ok',
 sessionId,
 messageCount: sessionMessages.length,
 tokenCount: getCurrentTokenCount(),
 llmAvailable: metrics.llmFailures < 3 // 简单推断
 });
});

// 启动
loadLatestSnapshot().then(() => {
 app.listen(PORT, () => {
 logger.info(`Context API listening on ${PORT}, session: ${sessionId}`);
 });
});

// 优雅关闭
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));