#!/usr/bin/env node
// ~/.openclaw/v8/src/scoring/rule-tuner.js

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/tasks.db');
const MIN_SAMPLES = 50;

function parsePayload(payloadStr) {
 try {
 return JSON.parse(payloadStr);
 } catch {
 return {};
 }
}

function percentile(arr, p) {
 if (arr.length === 0) return 0;
 const sorted = [...arr].sort((a, b) => a - b);
 const idx = Math.floor(sorted.length * p);
 return sorted[idx] || sorted[sorted.length - 1];
}

async function analyze() {
 const db = new sqlite3.Database(DB_PATH);

 const query = `
 SELECT id, payload, status, created_at, updated_at
 FROM tasks
 WHERE status IN ('completed', 'failed')
 ORDER BY created_at DESC
 LIMIT 2000
 `;

 db.all(query, [], (err, rows) => {
 if (err) {
 console.error('查询失败:', err.message);
 process.exit(1);
 }

 if (rows.length < MIN_SAMPLES) {
 console.log(`样本数 ${rows.length} < ${MIN_SAMPLES}，跳过分析。`);
 db.close();
 return;
 }

 const strategies = ['DIRECT', 'STEP_ARCHIVE', 'SPAWN_SUBAGENT', 'PARALLEL_SHARDS', 'MEGA_TASK'];
 const stats = Object.fromEntries(strategies.map(s => [s, {
 durations: [],
 timeouts: [],
 scores: [],
 failures: 0,
 total: 0
 }]));

 for (const row of rows) {
 const payload = parsePayload(row.payload);
 // 从 payload 中提取策略（支持多种字段名）
 const strategy = payload.metadata?.strategy ||
 payload.strategy ||
 payload.recommendedStrategy ||
 'DIRECT';
 if (!stats[strategy]) continue;

 const duration = row.updated_at - row.created_at;
 const timeout = payload.timeout || 60;
 const score = payload.metadata?.score ?? payload.score ?? 0;

 stats[strategy].durations.push(duration);
 stats[strategy].timeouts.push(timeout);
 stats[strategy].scores.push(score);
 stats[strategy].total++;
 if (row.status === 'failed') stats[strategy].failures++;
 }

 const recommendations = [];
 console.log('\n=== 策略分析报告 ===\n');

 for (const [strategy, data] of Object.entries(stats)) {
 if (data.durations.length === 0) continue;

 const p95 = percentile(data.durations, 0.95);
 const avgTimeout = data.timeouts.reduce((a, b) => a + b, 0) / data.timeouts.length;
 const failureRate = data.failures / data.total;
 const avgDuration = data.durations.reduce((a, b) => a + b, 0) / data.durations.length;
 const avgScore = data.scores.reduce((a, b) => a + b, 0) / data.scores.length;

 console.log(`[${strategy}]`);
 console.log(` 样本数: ${data.total}, 失败率: ${(failureRate * 100).toFixed(1)}%`);
 console.log(` 平均耗时: ${(avgDuration / 1000).toFixed(1)}s, P95耗时: ${(p95 / 1000).toFixed(1)}s`);
 console.log(` 平均超时: ${avgTimeout}s, 平均评分: ${avgScore.toFixed(1)}`);

 // 推荐规则
 if (p95 > avgTimeout * 1000 * 1.2) {
 const newTimeout = Math.ceil(p95 / 1000 * 1.2);
 recommendations.push(`[${strategy}] P95耗时(${(p95/1000).toFixed(1)}s)超过超时20%，建议将超时提升至 ${newTimeout}s`);
 }
 if (failureRate > 0.15) {
 recommendations.push(`[${strategy}] 失败率过高(${(failureRate*100).toFixed(1)}%)，建议检查执行环境或降低该策略评分门槛`);
 }
 }

 console.log('\n=== 优化建议 ===');
 if (recommendations.length === 0) {
 console.log('当前策略配置合理，无需调整。');
 } else {
 recommendations.forEach(r => console.log('•', r));
 }

 db.close();
 });
}

if (require.main === module) {
 analyze();
}

module.exports = { analyze };