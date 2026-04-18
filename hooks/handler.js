/**
 * Self-Improvement + Session-Summary Bootstrap Hook for OpenClaw
 *
 * Injects:
 * 1. Self-Improvement reminder during agent bootstrap
 * 2. Previous session's summary (memory/*-session-summary.md) as bootstrap context
 *
 * Fires on agent:bootstrap event before workspace files are injected.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SELF_IMPROVEMENT_REMINDER = `## Self-Improvement Reminder

After completing tasks, evaluate if any learnings should be captured:

**Log when:**
- User corrects you → \`.learnings/LEARNINGS.md\`
- Command/operation fails → \`.learnings/ERRORS.md\`
- User wants missing capability → \`.learnings/FEATURE_REQUESTS.md\`
- You discover your knowledge was wrong → \`.learnings/LEARNINGS.md\`
- You find a better approach → \`.learnings/LEARNINGS.md\`

**Promote when pattern is proven:**
- Behavioral patterns → \`SOUL.md\`
- Workflow improvements → \`AGENTS.md\`
- Tool gotchas → \`TOOLS.md\`

Keep entries simple: date, title, what happened, what to do differently.`;

/**
 * Find and read the most recent session-summary file.
 * Looks in memory/ for *-session-summary.md files, returns most recent by mtime.
 */
async function getLatestSessionSummary() {
  try {
    const memoryDir = path.join(
      process.env.OPENCLAW_WORKSPACE_DIR || path.join(os.homedir(), '.openclaw', 'workspace', 'main'),
      'memory'
    );

    const files = await fs.promises.readdir(memoryDir);
    const summaryFiles = files.filter(f => f.includes('-session-summary-') && f.endsWith('.md'));

    if (summaryFiles.length === 0) return null;

    // Sort by mtime descending
    const withMtime = await Promise.all(
      summaryFiles.map(async (f) => ({
        file: f,
        mtime: (await fs.promises.stat(path.join(memoryDir, f))).mtimeMs,
      }))
    );
    withMtime.sort((a, b) => b.mtime - a.mtime);

    const latest = withMtime[0].file;
    const content = await fs.promises.readFile(path.join(memoryDir, latest), 'utf-8');

    // Strip <!-- summary-only --> and <!-- source: ... --> tags for clean injection
    const cleaned = content
      .replace(/<!-- summary-only -->/g, '')
      .replace(/<!-- source:[^>]*>/g, '')
      .trim();

    return `## 上一页会话摘要 (from ${latest})

${cleaned}`;
  } catch {
    return null;
  }
}

async function handler(event) {
  // Safety checks for event structure
  if (!event || typeof event !== 'object') {
    return;
  }

  // Only handle agent:bootstrap events
  if (event.type !== 'agent' || event.action !== 'bootstrap') {
    return;
  }

  // Safety check for context
  if (!event.context || typeof event.context !== 'object') {
    return;
  }

  // Skip sub-agent sessions to avoid bootstrap issues
  const sessionKey = event.sessionKey || '';
  if (sessionKey.includes(':subagent:')) {
    return;
  }

  if (!Array.isArray(event.context.bootstrapFiles)) {
    return;
  }

  // 1. Inject self-improvement reminder
  event.context.bootstrapFiles.push({
    path: 'SELF_IMPROVEMENT_REMINDER.md',
    content: SELF_IMPROVEMENT_REMINDER,
    virtual: true,
  });

  // 2. Inject previous session summary (memory chain key step)
  const summary = await getLatestSessionSummary();
  if (summary) {
    event.context.bootstrapFiles.push({
      path: 'PREVIOUS_SESSION_SUMMARY.md',
      content: summary,
      virtual: true,
    });
  }
}

export default handler;
