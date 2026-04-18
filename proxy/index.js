require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const axios = require('axios');
const WebSocket = require('ws');
const { createProxyMiddleware } = require('http-proxy-middleware');
const NodeCache = require('node-cache');
const { classify, score } = require('./clients/v8Client');
const { AIRouter } = require('@isaced/ai-router');

// ==================== 配置加载 ====================
const HOME = process.env.HOME || '/home/ai';
const MODELS_CONFIG = JSON.parse(fs.readFileSync(path.join(HOME, '.openclaw/config/models.json')));
const RULES_CONFIG = JSON.parse(fs.readFileSync(path.join(HOME, '.openclaw/config/routing_rules.json')));
const OPENCLAW_CONFIG = JSON.parse(fs.readFileSync(path.join(HOME, '.openclaw/openclaw.json')));
const PROVIDERS_CONFIG = JSON.parse(fs.readFileSync(path.join(HOME, '.openclaw/config/providers.json')));

// 初始化 ai-router
const aiRouter = new AIRouter({
  providers: PROVIDERS_CONFIG.providers,
  strategy: 'rate-limit-aware'
});

// 分类器缓存
const classifyCache = new NodeCache({ stdTTL: parseInt(process.env.CLASSIFIER_CACHE_TTL) || 300 });

// ==================== 日志工具 ====================
const log = (level, msg, data = {}) => {
  console.log(JSON.stringify({ level, ts: new Date().toISOString(), msg, ...data }));
};

// ==================== 路由决策 ====================
function getModelConfig(agentId) {
  const agent = (OPENCLAW_CONFIG.agents?.list || []).find(a => a.id === agentId);
  const modelRef = agent?.modelRef || 'fast';
  const modelConfig = MODELS_CONFIG.models[modelRef];
  if (!modelConfig) throw new Error(`Model ref '${modelRef}' not found`);
  return { modelRef, modelConfig };
}

function routeAgent(userMessage, classifierResult = null) {
  const rules = [...RULES_CONFIG.rules].sort((a, b) => b.priority - a.priority);
  
  // 阶段1：关键词（优先级 ≥ 100）
  for (const rule of rules) {
    if (rule.priority < 100) continue;
    if (rule.condition.always) continue;
    if (rule.condition.contains) {
      const matched = rule.condition.contains.some(kw => userMessage.includes(kw));
      if (matched) {
        const { modelConfig } = getModelConfig(rule.target_agent);
        log('info', 'Route by keyword', { rule: rule.id, agent: rule.target_agent, model: modelConfig.modelId });
        return { agentId: rule.target_agent, by: 'keyword' };
      }
    }
  }
  
  // 阶段2：分类器标签
  if (classifierResult) {
    for (const rule of rules) {
      if (rule.condition.always) continue;
      if (!rule.condition.classifier_label) continue;
      const matched = rule.condition.classifier_label.includes(classifierResult.scene);
      if (matched) {
        const { modelConfig } = getModelConfig(rule.target_agent);
        log('info', 'Route by classifier', { rule: rule.id, agent: rule.target_agent, model: modelConfig.modelId });
        return { agentId: rule.target_agent, by: 'classifier' };
      }
    }
  }
  
  // Fallback
  const fallback = rules.find(r => r.condition.always);
  const target = fallback ? fallback.target_agent : 'fast_agent';
  const { modelConfig } = getModelConfig(target);
  log('info', 'Route fallback', { agent: target, model: modelConfig.modelId });
  return { agentId: target, by: 'fallback' };
}

// ==================== 上下文 API ====================
const CONTEXT_API = process.env.CONTEXT_API || 'http://localhost:3106';
async function getContextHistory() {
  try {
    const res = await axios.get(`${CONTEXT_API}/api/context/full`, { timeout: 2000 });
    return res.data.messages || [];
  } catch { return []; }
}
async function addContextMessage(role, content) {
  try {
    await axios.post(`${CONTEXT_API}/api/context`, { role, content }, { timeout: 2000 });
  } catch (e) { log('warn', 'Context add failed', { error: e.message }); }
}

// ==================== 任务提交 ====================
const V8_TASK_API = process.env.V8_TASK_API || 'http://localhost:3103/api/task';
async function submitV8Task(message, scoring) {
  const payload = {
    type: 'command',
    command: message.trim().split(/\s+/)[0] || 'echo',
    args: message.trim().split(/\s+/).slice(1),
    timeout: scoring.timeout,
    priority: Math.floor(scoring.score / 20),
    metadata: { prompt: message, strategy: scoring.recommendedStrategy }
  };
  const res = await axios.post(V8_TASK_API, payload, { timeout: 5000 });
  return res.data.id;
}

// ==================== Express App ====================
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PROXY_PORT || 3102;
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3108';
const GATEWAY_WS = process.env.GATEWAY_WS || 'ws://localhost:3108';
const BYPASS_MODE = process.env.BYPASS_MODE === 'true';
let bypass = BYPASS_MODE;

app.get('/health', async (req, res) => {
  const status = { proxy: 'ok', bypass, aiRouter: 'ok' };
  try { await axios.get('http://localhost:3104/health', { timeout: 1000 }); status.classifier = 'ok'; } catch { status.classifier = 'down'; }
  try { await axios.get('http://localhost:3103/health', { timeout: 1000 }); status.v8 = 'ok'; } catch { status.v8 = 'down'; }
  try { await axios.get(`${CONTEXT_API}/health`, { timeout: 1000 }); status.context = 'ok'; } catch { status.context = 'down'; }
  res.json(status);
});

app.post('/admin/bypass', (req, res) => {
  bypass = req.body.enabled === true;
  log('info', 'Bypass toggled', { bypass });
  res.json({ bypass });
});

// ==================== 核心消息处理 ====================
app.post('/api/chat/send', async (req, res) => {
  const { message, context = {} } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  await addContextMessage('user', message);

  // Bypass 模式
  if (bypass) {
    try {
      const gwRes = await axios.post(`${GATEWAY_URL}/api/chat/send`, req.body, { timeout: 60000 });
      await addContextMessage('assistant', gwRes.data.reply || '');
      return res.json(gwRes.data);
    } catch (err) {
      return res.status(502).json({ error: 'Gateway unavailable' });
    }
  }

  try {
    // 1. 获取分类结果（带缓存）
    let classifierResult = classifyCache.get(message);
    if (!classifierResult) {
      try {
        classifierResult = await classify(message);
        classifyCache.set(message, classifierResult);
      } catch (e) {
        log('warn', 'Classifier unavailable', { error: e.message });
        classifierResult = null;
      }
    }

    // 2. 路由决策
    const routing = routeAgent(message, classifierResult);
    const { modelConfig } = getModelConfig(routing.agentId);
    log('info', 'Routed', { agent: routing.agentId, model: modelConfig.modelId, by: routing.by });

    // 3. 非任务快速回复
    if (classifierResult && !classifierResult.isTask) {
      const replies = {
        chitchat: '你好！有什么技术问题需要帮助？',
        fault_recovery: '请描述具体的故障现象和已尝试的操作，我将协助恢复。',
        vague_request: '我不太确定你的具体需求。请具体说明。'
      };
      const reply = replies[classifierResult.scene] || '收到消息。';
      await addContextMessage('assistant', reply);
      return res.json({ reply, scene: classifierResult.scene, agent: routing.agentId });
    }

    // 4. 任务评分
    const scoring = await score(message, context);
    log('info', 'Scored', { score: scoring.score, strategy: scoring.recommendedStrategy });

    // 5. 策略路由
    if (scoring.recommendedStrategy === 'DIRECT') {
      const taskId = await submitV8Task(message, scoring);
      const reply = `✅ 任务已提交 (ID: ${taskId})，预计 ${scoring.timeout}s 完成。`;
      await addContextMessage('assistant', reply);
      return res.json({ reply, taskId, strategy: 'DIRECT', agent: routing.agentId });
    }

    // 6. 非 DIRECT：用 ai-router 调用 LLM
    const history = await getContextHistory();
    const messages = [...history, { role: 'user', content: message }];

    const llmReply = await aiRouter.chat({
      model: modelConfig.modelId,
      messages: messages,
      temperature: 0.7,
      max_tokens: 4096
    });

    await addContextMessage('assistant', llmReply);
    
    res.json({
      reply: llmReply,
      agent: routing.agentId,
      model: modelConfig.modelId,
      strategy: scoring.recommendedStrategy
    });

  } catch (err) {
    log('error', 'Processing failed', { error: err.message });
    // 终极兜底：转发 Gateway
    try {
      const gwRes = await axios.post(`${GATEWAY_URL}/api/chat/send`, req.body, { timeout: 60000 });
      await addContextMessage('assistant', gwRes.data.reply || '');
      return res.json({ ...gwRes.data, fallback: true });
    } catch {
      return res.status(502).json({ error: 'All services unavailable' });
    }
  }
});

// ==================== 转发中间件 ====================
const server = http.createServer(app);
const gatewayProxy = createProxyMiddleware({
  target: GATEWAY_URL,
  changeOrigin: true,
  ws: true,
  logLevel: 'silent',
  onError: (err, req, res) => {
    log('error', 'Gateway proxy error', { error: err.message });
    if (res && !res.headersSent) res.status(502).send('Gateway unavailable');
  }
});

app.use('/', gatewayProxy);

server.on('upgrade', (req, socket, head) => {
  log('info', 'WebSocket upgrade', { url: req.url });
  gatewayProxy.upgrade(req, socket, head);
});

server.listen(PORT, () => {
  log('info', `Proxy started on ${PORT}`, { gateway: GATEWAY_URL });
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
