#!/usr/bin/env node
/**
 * prune-old-summaries — 清理 30 天前的 session-summary 文件
 * 独立于 session-summary hook 运行，作为 cron 备份保障
 *
 * 建议 cron: 每周日凌晨 4:00 执行
 * 0 4 * * 0 node /home/ai/.openclaw/scripts/prune-old-summaries.js
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const MEMORY_DIR = path.join(
  process.env.OPENCLAW_WORKSPACE_DIR ||
    path.join(os.homedir(), '.openclaw', 'workspace'),
  'memory'
);
const MAX_AGE_DAYS = 30;
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(`[prune-old-summaries] 开始检查（${DRY_RUN ? 'DRY RUN' : 'LIVE'}）`);

  let files;
  try {
    files = await fs.promises.readdir(MEMORY_DIR);
  } catch (err) {
    console.error(`[prune-old-summaries] 无法读取目录: ${MEMORY_DIR}`, err.message);
    process.exit(1);
  }

  const now = Date.now();
  const maxAge = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  let total = 0, pruned = 0, errors = 0;

  for (const file of files) {
    if (!file.endsWith('-session-summary.md')) continue;
    total++;
    const filePath = path.join(MEMORY_DIR, file);
    try {
      const stat = await fs.promises.stat(filePath);
      const age = now - stat.mtimeMs;
      if (age > maxAge) {
        if (DRY_RUN) {
          console.log(`  [dry-run] 将删除: ${file}（${Math.round(age / 86400000)} 天前）`);
        } else {
          await fs.promises.unlink(filePath);
          console.log(`  删除: ${file}（${Math.round(age / 86400000)} 天前）`);
        }
        pruned++;
      }
    } catch (err) {
      console.error(`  错误 ${file}: ${err.message}`);
      errors++;
    }
  }

  console.log(`[prune-old-summaries] 完成: 检查 ${total} 个摘要文件，删除 ${pruned} 个，错误 ${errors} 个`);
}

main().catch(err => {
  console.error('[prune-old-summaries] 致命错误:', err.message);
  process.exit(1);
});
