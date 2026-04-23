/**
 * Cron Status Detector
 * 检测 cron job 执行状态（直接读 job state，不过渡到 delivery 层）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CRON_JOBS_FILE = path.join(__dirname, '../../cron/jobs.json');

async function detect() {
  const alerts = [];

  try {
    const content = fs.readFileSync(CRON_JOBS_FILE, 'utf8');
    const data = JSON.parse(content);
    const jobs = Array.isArray(data) ? data : (data.jobs || []);

    // Check for failed jobs
    const failedJobs = jobs.filter(j => j.state?.lastRunStatus === 'error');
    const errorCounts = {};
    for (const job of failedJobs) {
      const name = job.name || job.id;
      errorCounts[name] = job.state.consecutiveErrors || 0;
    }

    for (const job of failedJobs) {
      const name = job.name || job.id;
      const errors = job.state.consecutiveErrors || 0;
      const lastError = job.state.lastError || 'unknown';

      let severity = 'medium';
      if (errors >= 20) severity = 'high';
      if (errors >= 50) severity = 'critical';

      // Parse error for fix hint
      let fix = '手动检查 cron job 配置';
      if (lastError.includes('Feishu') || lastError.includes('delivery')) {
        fix = '在 cron job 配置中添加 delivery.to (飞书 chatId)，或将 mode 改为 "none"';
      } else if (lastError.includes('timeout')) {
        fix = '增加 timeoutSeconds 或优化 job 执行时间';
      } else if (lastError.includes('ENOENT') || lastError.includes('not found')) {
        fix = '检查 job 配置的 payload.message 中的路径/文件是否存在';
      }

      alerts.push({
        type: 'cron_job_error',
        severity,
        component: 'Cron',
        message: `${name}: ${errors}次连续error (最后错误: ${lastError})`,
        detail: `最后运行: ${new Date(job.state.lastRunAtMs).toISOString()}`,
        fix,
        jobId: job.id
      });
    }

    // Check disabled jobs
    const disabledJobs = jobs.filter(j => !j.enabled);
    if (disabledJobs.length > 0) {
      alerts.push({
        type: 'cron_job_disabled',
        severity: 'low',
        component: 'Cron',
        message: `${disabledJobs.length} 个 cron job 已禁用`,
        detail: disabledJobs.map(j => j.name || j.id).join(', ')
      });
    }

    // Summary
    const total = jobs.length;
    const ok = jobs.filter(j => j.state?.lastRunStatus === 'ok').length;
    if (total > 0 && ok < total) {
      // Already captured above, no need to duplicate
    }

  } catch (e) {
    if (e.message.includes('JSON.parse')) {
      alerts.push({
        type: 'cron_rpc_invalid',
        severity: 'high',
        component: 'Cron',
        message: `Cron RPC 返回了无效 JSON: ${e.message}`,
        fix: '检查 Gateway 日志，cron 可能处于异常状态'
      });
    } else {
      alerts.push({
        type: 'cron_check_failed',
        severity: 'medium',
        component: 'Cron',
        message: `Cron 检查失败: ${e.message}`,
        fix: '手动执行: curl http://127.0.0.1:18789/api/cron/list'
      });
    }
  }

  return alerts;
}

export { detect };