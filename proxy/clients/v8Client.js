const axios = require('axios');

const CLASSIFIER_URL = process.env.CLASSIFIER_URL || 'http://localhost:3104/classify';
const SCORER_URL = process.env.SCORER_URL || 'http://localhost:3103/api/score';
const CLASSIFIER_TIMEOUT = parseInt(process.env.CLASSIFIER_TIMEOUT || '300');
const SCORER_TIMEOUT = parseInt(process.env.SCORER_TIMEOUT || '2000');

let circuitOpen = false;
let failureCount = 0;
const CIRCUIT_THRESHOLD = 3;

const TASK_SCENES = new Set(['task_multi_step', 'high_risk_automated', 'fault_recovery', 'task_status_query', 'cancel_task', 'clarify', 'vague_request']);

function fallbackClassify(text) {
  const lower = text.toLowerCase();
  const taskPatterns = [/运行|执行|构建|测试|部署|编译|安装|创建|删除|修改|重构|分析|检查|修复/, /帮我|请|做|写|生成|优化/];
  const isTask = taskPatterns.some(p => p.test(lower));
  let scene = 'default';
  if (/天气|你好|谢谢|笑话/.test(lower)) scene = 'chitchat';
  else if (/起不来|挂了|报错|失败|恢复/.test(lower)) scene = 'fault_recovery';
  else if (isTask) scene = 'task_multi_step';
  return { isTask, confidence: 0.6, scene, source: 'fallback' };
}

function fallbackScore(prompt) {
  const lower = prompt.toLowerCase();
  let score = 30, strategy = 'DIRECT', timeout = 60;
  if (/重构|编译|构建|测试|部署/.test(lower)) { score = 45; strategy = 'SPAWN_SUBAGENT'; timeout = 180; }
  return { score, factors: {}, recommendedStrategy: strategy, timeout, source: 'fallback' };
}

async function classify(text) {
  if (circuitOpen) return fallbackClassify(text);
  try {
    const response = await axios.post(CLASSIFIER_URL, { text }, { timeout: CLASSIFIER_TIMEOUT });
    const data = response.data;
    const scene = data.scene || 'default';
    failureCount = 0;
    return { isTask: TASK_SCENES.has(scene), confidence: data.confidence ?? 0.5, scene, meta: data.meta, source: 'classifier' };
  } catch (err) {
    failureCount++;
    if (failureCount >= CIRCUIT_THRESHOLD) circuitOpen = true;
    return fallbackClassify(text);
  }
}

async function score(prompt, context = {}) {
  try {
    const response = await axios.post(SCORER_URL, { prompt, context }, { timeout: SCORER_TIMEOUT });
    const data = response.data;
    return { score: data.score ?? 30, factors: data.factors ?? {}, recommendedStrategy: data.recommendedStrategy ?? 'DIRECT', timeout: data.timeout ?? 60, source: 'scorer' };
  } catch (err) {
    return fallbackScore(prompt);
  }
}

module.exports = { classify, score };