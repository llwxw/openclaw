#!/usr/bin/env node
/**
 * weight-learner.js - 评分权重自适应学习
 * 基于用户反馈动态调整各因子权重
 * 
 * 使用: node weight-learner.js --db ./data/tasks.db --output config/weights.json
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DEFAULT_WEIGHTS = {
  logic: 1.0,
  risk: 1.5,
  duration: 1.2,
  resource: 1.0,
  uncertainty: 0.8,
  dependency: 1.0
};

const LEARNING_RATE = 0.1;

// 反馈类型到因子的映射
const FEEDBACK_MAPPINGS = {
  'too_slow': ['duration', 'uncertainty'],
  'too_fast': ['duration'],
  'unexpected_failure': ['risk', 'uncertainty'],
  'resource_exhausted': ['resource'],
  'too_complex': ['dependency', 'uncertainty'],
  'under_utilized': ['duration', 'resource']
};

function parseArgs() {
  const args = process.argv.slice(2);
  let dbPath = './data/tasks.db';
  let outputFile = 'weights.json';
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db' && args[i + 1]) {
      dbPath = args[i + 1];
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      outputFile = args[i + 1];
      i++;
    }
  }
  
  return { dbPath, outputFile };
}

function loadExistingWeights(configPath) {
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
  return { ...DEFAULT_WEIGHTS };
}

function collectFeedbackData(db) {
  const stmt = db.prepare(`
    SELECT 
      id,
      metadata,
      status,
      exit_code,
      actual_duration_ms
    FROM tasks 
    WHERE metadata->>'user_feedback' IS NOT NULL
      AND created_at > datetime('now', '-30 days')
    ORDER BY created_at DESC
    LIMIT 1000
  `);
  
  return stmt.all();
}

function updateWeights(weights, feedbackData) {
  const newWeights = { ...weights };
  const adjustments = {};
  
  // 初始化调整记录
  for (const factor in weights) {
    adjustments[factor] = 0;
  }
  
  for (const task of feedbackData) {
    const feedback = task.metadata?.user_feedback;
    if (!feedback || !FEEDBACK_MAPPINGS[feedback]) continue;
    
    const affectedFactors = FEEDBACK_MAPPINGS[feedback];
    const direction = feedback.includes('too_') ? 1 : -1;
    
    for (const factor of affectedFactors) {
      if (newWeights[factor] !== undefined) {
        adjustments[factor] += direction * LEARNING_RATE;
      }
    }
  }
  
  // 应用调整并确保权重在有效范围内
  for (const factor in newWeights) {
    newWeights[factor] = Math.max(0.1, Math.min(3.0, newWeights[factor] + adjustments[factor]));
    newWeights[factor] = Math.round(newWeights[factor] * 100) / 100;
  }
  
  return { newWeights, adjustments };
}

function analyzeStrategyAccuracy(db, weights) {
  const strategies = ['DIRECT', 'STEP_ARCHIVE', 'SPAWN_SUBAGENT', 'PARALLEL_SHARDS'];
  const results = {};
  
  for (const strategy of strategies) {
    const stmt = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as success,
        AVG(actual_duration_ms) as avg_duration
      FROM tasks 
      WHERE metadata->>'strategy' = ?
        AND metadata->>'score' IS NOT NULL
        AND created_at > datetime('now', '-30 days')
    `);
    
    const data = stmt.get(strategy);
    if (data && data.total > 0) {
      // 计算评分与实际执行时间的相关性
      const scoreStmt = db.prepare(`
        SELECT 
          AVG(CAST(metadata->>'score' AS REAL)) as avg_score,
          AVG(actual_duration_ms) as avg_duration
        FROM tasks
        WHERE metadata->>'strategy' = ?
          AND created_at > datetime('now', '-30 days')
        GROUP BY ROUND(CAST(metadata->>'score' AS REAL) / 10)
      `);
      
      const scoreData = scoreStmt.all(strategy);
      results[strategy] = {
        total: data.total,
        success_rate: data.success / data.total,
        avg_duration: data.avg_duration
      };
    }
  }
  
  return results;
}

async function main() {
  const { dbPath, outputFile } = parseArgs();
  
  console.log('=== Weight Learner 开始学习 ===');
  console.log(`数据库: ${dbPath}`);
  
  const absDbPath = path.resolve(dbPath);
  
  if (!fs.existsSync(absDbPath)) {
    console.log('数据库不存在，跳过学习');
    process.exit(0);
  }
  
  const db = new Database(absDbPath, { readonly: true });
  
  // 加载现有权重
  const configPath = path.join(path.dirname(absDbPath), '..', 'scoring', 'config', 'weights.json');
  const currentWeights = loadExistingWeights(configPath);
  console.log('当前权重:', currentWeights);
  
  // 收集反馈数据
  const feedbackData = collectFeedbackData(db);
  console.log(`收集到 ${feedbackData.length} 条反馈数据`);
  
  db.close();
  
  if (feedbackData.length === 0) {
    console.log('无反馈数据，跳过权重调整');
    process.exit(0);
  }
  
  // 更新权重
  const { newWeights, adjustments } = updateWeights(currentWeights, feedbackData);
  
  console.log('\n权重调整:');
  for (const factor in adjustments) {
    if (adjustments[factor] !== 0) {
      console.log(`  ${factor}: ${currentWeights[factor]} → ${newWeights[factor]} (${adjustments[factor] > 0 ? '+' : ''}${adjustments[factor].toFixed(2)})`);
    }
  }
  
  // 保存新权重
  fs.writeFileSync(outputFile, JSON.stringify(newWeights, null, 2));
  console.log(`\n新权重已保存: ${outputFile}`);
}

main().catch(console.error);