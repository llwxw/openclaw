#!/usr/bin/env node
// ~/.openclaw/v8/src/observability/strategy-analyzer.js

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/tasks.db');

function parsePayload(payloadStr) {
 try {
 return JSON.parse(payloadStr);
 } catch {
 return {};
 }
}

async function analyze(days = 7) {
 const db = new sqlite3.Database(DB_PATH);
 const since = Date.now() - days * 24 * 60 * 60 * 1000;

 const query = `
 SELECT id, payload, status, created_at, updated_at, error_message
 FROM tasks
 WHERE created_at > ?
 ORDER BY created_at DESC
 `;

 db.all(query, [since], (err, rows) => {
 if (err) {
 console.error('查询失败:', err.message);
 process.exit(1);
 }

 const strategies = ['DIRECT', 'STEP_ARCHIVE', 'SPAWN_SUBAGENT', 'PARALLEL_SHARDS', 'MEGA_TASK'];
 const report = {
 total: rows.length,
 byStrategy: Object.fromEntries(strategies.map(s => [s, { total: 0, failed: 0, timeouts: 0, oom: 0 }])),
 failureReasons: {},
 };

 for (const row of rows) {
 const payload = parsePayload(row.payload);
 const strategy = payload.metadata?.strategy ||
 payload.strategy ||
 payload.recommendedStrategy ||
 'DIRECT';
 if (!report.byStrategy[strategy]) continue;

 report.byStrategy[strategy].total++;

 if (row.status === 'failed') {
 report.byStrategy[strategy].failed++;
 const reason = row.error_message || '未知错误';
 report.failureReasons[reason] = (report.failureReasons[reason] || 0) + 1;

 if (/timeout|超时|timed out/i.test(reason)) {
 report.byStrategy[strategy].timeouts++;
 }
 if (/memory|内存|OOM/i.test(reason)) {
 report.byStrategy[strategy].oom++;
 }
 }
 }

 console.log(`\n=== 失败模式分析 (最近 ${days} 天) ===\n`);
 console.log(`总任务数: ${report.total}`);

 let totalTimeouts = 0, totalOOM = 0;
 for (const [strategy, stats] of Object.entries(report.byStrategy)) {
 if (stats.total === 0) continue;
 const failRate = (stats.failed / stats.total) * 100;
 console.log(`\n[${strategy}] 总数: ${stats.total}, 失败: ${stats.failed} (${failRate.toFixed(1)}%)`);
 if (stats.timeouts > 0) console.log(` 超时次数: ${stats.timeouts}`);
 if (stats.oom > 0) console.log(` 内存溢出次数: ${stats.oom}`);
 totalTimeouts += stats.timeouts;
 totalOOM += stats.oom;
 }

 if (Object.keys(report.failureReasons).length > 0) {
 console.log('\n高频失败原因:');
 Object.entries(report.failureReasons)
 .sort((a, b) => b[1] - a[1])
 .slice(0, 5)
 .forEach(([reason, count]) => console.log(` ${count}次: ${reason.substring(0, 70)}`));
 }

 console.log('\n=== 优化建议 ===');
 if (totalTimeouts > report.total * 0.1) {
 console.log(`• 超时任务占比过高 (${(totalTimeouts/report.total*100).toFixed(1)}%)，建议增加各策略超时或优化任务粒度`);
 }
 if (totalOOM > 0) {
 console.log(`• 发现 ${totalOOM} 次内存溢出，建议提高 executor.memoryLimitMB`);
 }

 db.close();
 });
}

const args = process.argv.slice(2);
const days = parseInt(args.find(arg => arg.startsWith('--days='))?.split('=')[1]) || 7;

if (require.main === module) {
 analyze(days);
}

module.exports = { analyze };