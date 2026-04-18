#!/usr/bin/env node
/**
 * ephemeral-analyze — AI 决策数据可视化
 * 分析 ~/.openclaw/ephemeral/*.jsonl 中的 scene/score/strategy 分布
 *
 * 用法: node ephemeral-analyze.js [--days 7] [--output text|json]
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const WORKSPACE_DIR = path.join(os.homedir(), '.openclaw', 'workspace');
const EPHEMERAL_DIR = path.join(WORKSPACE_DIR, 'memory', 'ephemeral');
const DEFAULT_DAYS = 7;
const MAX_ENTRIES = 5000;

// ─── CLI ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const daysIdx = args.indexOf('--days');
const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1]) || DEFAULT_DAYS : DEFAULT_DAYS;
const outputMode = args.includes('--json') ? 'json' : 'text';

// ─── Core ─────────────────────────────────────────────────────────────────

async function main() {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const allEntries = [];

  let files;
  try {
    files = await fs.promises.readdir(EPHEMERAL_DIR);
  } catch {
    console.error(`[ephemeral-analyze] 无法读取目录: ${EPHEMERAL_DIR}`);
    process.exit(1);
  }

  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue;
    const filePath = path.join(EPHEMERAL_DIR, file);
    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch { continue; }
    if (stat.mtimeMs < cutoff) continue;

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (new Date(entry.timestamp).getTime() >= cutoff) {
            allEntries.push(entry);
          }
        } catch { /* skip */ }
      }
    } catch { continue; }
  }

  // 去重（按 text slice）
  const seen = new Set();
  const entries = allEntries.filter(e => {
    const key = `${e.sessionKey || ''}-${(e.text || '').slice(0, 80)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(-MAX_ENTRIES);

  if (entries.length === 0) {
    const empty = { summary: '无数据', days, entries: 0, scenes: {}, scores: [], strategies: {}, avgScore: 0 };
    console.log(outputMode === 'json' ? JSON.stringify(empty, null, 2) : formatText(empty));
    return;
  }

  // ─── 统计 ───────────────────────────────────────────────────────────────

  /** @type {Record<string, number>} */
  const scenes = {};
  /** @type {number[]} */
  const scores = [];
  /** @type {Record<string, number>} */
  const strategies = {};
  /** @type {Record<string, number>} */
  const riskByScene = {};
  let totalRisk = 0;

  for (const e of entries) {
    const scene = e.classification?.scene || 'unknown';
    scenes[scene] = (scenes[scene] || 0) + 1;

    const score = e.scoring?.score ?? 0;
    scores.push(score);

    const strategy = e.scoring?.recommendedStrategy || 'unknown';
    strategies[strategy] = (strategies[strategy] || 0) + 1;

    const risk = e.scoring?.factors?.risk || 0;
    if (risk > 0) {
      riskByScene[scene] = riskByScene[scene] || [];
      riskByScene[scene].push(risk);
      totalRisk += risk;
    }
  }

  scores.sort((a, b) => a - b);
  const avgScore = scores.length > 0 ? scores.reduce((s, v) => s + v, 0) / scores.length : 0;
  const p50 = scores[Math.floor(scores.length * 0.5)] || 0;
  const p90 = scores[Math.floor(scores.length * 0.9)] || 0;
  const maxScore = scores[scores.length - 1] || 0;

  const topScenes = Object.entries(scenes).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topStrategies = Object.entries(strategies).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const sceneRiskAvg = {};
  for (const [scene, vals] of Object.entries(riskByScene)) {
    sceneRiskAvg[scene] = vals.reduce((s, v) => s + v, 0) / vals.length;
  }
  const highestRiskScene = Object.entries(sceneRiskAvg).sort((a, b) => b[1] - a[1])[0];

  // ─── 输出 ───────────────────────────────────────────────────────────────

  const result = {
    summary: `${days} 天内共 ${entries.length} 条有效碎片`,
    days,
    entries: entries.length,
    scenes: Object.fromEntries(topScenes),
    strategies: Object.fromEntries(topStrategies),
    score: {
      avg: Math.round(avgScore * 10) / 10,
      p50,
      p90,
      max: maxScore,
    },
    highestRiskScene: highestRiskScene
      ? { scene: highestRiskScene[0], avgRisk: Math.round(highestRiskScene[1] * 10) / 10 }
      : null,
    sessionCount: new Set(entries.map(e => e.sessionKey)).size,
  };

  if (outputMode === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatText(result));
  }
}

function formatText(r) {
  const lines = [
    `📊 ephemeral 决策数据（近 ${r.days} 天）`,
    `─────────────────────────────────`,
    `有效碎片: ${r.entries} 条`,
    `涉及 session: ${r.sessionCount} 个`,
    ``,
    `🏷️  场景分布（Top5）:`,
    ...Object.entries(r.scenes).map(([s, c]) => `   ${s}: ${c} (${Math.round(c / r.entries * 100)}%)`),
    ``,
    `🎯 推荐策略分布（Top5）:`,
    ...Object.entries(r.strategies).map(([s, c]) => `   ${s}: ${c}`),
    ``,
    `📈 复杂度评分:`,
    `   平均: ${r.score.avg}  |  P50: ${r.score.p50}  |  P90: ${r.score.p90}  |  MAX: ${r.score.max}`,
    ``,
    r.highestRiskScene
      ? `⚠️  最高风险场景: ${r.highestRiskScene.scene}（均分 ${r.highestRiskScene.avgRisk}）`
      : `⚠️  无风险数据`,
  ];
  return lines.join('\n');
}

main().catch(err => {
  console.error('[ephemeral-analyze] 错误:', err.message);
  process.exit(1);
});
