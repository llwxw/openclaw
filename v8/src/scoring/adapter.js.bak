/**
 * 适配层：直接使用 v7 评分模块 scoring.js
 */
const path = require('path');

// v7 模块的实际路径
const V7_BASE = '/home/ai/.openclaw/workspace/skills/task-orchestrator-v7';

let v7Scorer = null;
let v7Loaded = false;

try {
  const scoring = require(path.join(V7_BASE, 'scoring.js'));
  v7Scorer = scoring.default || scoring.taskScorerV7 || scoring;
  v7Loaded = true;
  console.log('v7 scoring module loaded successfully');
} catch (err) {
  console.warn('v7 scoring module not found, using built-in scorer:', err.message);
}

/**
 * 评分结果转换 - v7 转 v8 格式
 */
function convertV7Result(v7Result) {
  if (!v7Result) {
    return builtInScore('');
  }

  const total = v7Result.total || 0;
  
  // 根据分数映射到策略
  let strategy = 'DIRECT';
  let timeout = 30;
  
  if (total > 12) {
    strategy = 'MEGA_TASK';
    timeout = 7200;
  } else if (total > 8) {
    strategy = 'PARALLEL_SHARDS';
    timeout = 160;
  } else if (total > 5) {
    strategy = 'SPAWN_SUBAGENT';
    timeout = 120;
  } else if (total > 2) {
    strategy = 'STEP_ARCHIVE';
    timeout = 60;
  }

  return {
    score: total,
    factors: v7Result,
    recommendedStrategy: strategy,
    timeout
  };
}

/**
 * 统一的评分接口
 */
async function scoreTask(prompt, context = {}) {
  if (v7Loaded && v7Scorer && v7Scorer.score) {
    try {
      const v7Result = v7Scorer.score(prompt);
      return convertV7Result(v7Result);
    } catch (e) {
      console.warn('v7 scoring failed, using built-in:', e.message);
    }
  }
  
  return builtInScore(prompt, context);
}

/**
 * 内置简易评分器
 */
function builtInScore(prompt, context = {}) {
  let score = 0;
  const factors = {
    logicComplexity: 1, risk: 1, estimatedDuration: 1,
    resourceCost: 1, uncertainty: 1, dependencyComplexity: 1
  };
  
  const lower = prompt.toLowerCase();
  if (lower.includes('refactor')) { factors.logicComplexity = 3; score += 3; }
  if (lower.includes('delete') || lower.includes('rm ') || lower.includes('rm:')) { factors.risk = 3; score += 3; }
  if (lower.includes('build') || lower.includes('compile')) { factors.estimatedDuration = 3; score += 3; }
  if (lower.includes('test')) { factors.resourceCost = 2; score += 2; }
  if (lower.includes('api') || lower.includes('http')) { factors.uncertainty = 2; score += 2; }
  if (lower.includes('monorepo') || lower.includes('workspace')) { factors.dependencyComplexity = 3; score += 3; }
  
  if (prompt.length > 500) { score += 2; }
  else if (prompt.length > 200) { score += 1; }

  let strategy = 'DIRECT', timeout = 30;
  if (score > 80) { strategy = 'MEGA_TASK'; timeout = 7200; }
  else if (score > 60) { strategy = 'PARALLEL_SHARDS'; timeout = 160; }
  else if (score > 40) { strategy = 'SPAWN_SUBAGENT'; timeout = 120; }
  else if (score > 20) { strategy = 'STEP_ARCHIVE'; timeout = 60; }
 
  return { score, factors, recommendedStrategy: strategy, timeout };
}

module.exports = { scoreTask };
