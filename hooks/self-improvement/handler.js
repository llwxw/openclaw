/**
 * self-improvement hook - 自动捕获错误和纠正 + bootstrap reminder
 *
 * 触发时机:
 *   - agent:bootstrap (注入 self-improvement reminder)
 *   - agent:response (检测 AI 回复中的错误/纠正)
 *
 * 功能:
 *   - bootstrap: 注入 learnings 检查提醒
 *   - response: 检测纠正模式，写入 .learnings/
 *
 * 降级: 文件写入失败时静默跳过
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const LEARNINGS_DIR = path.join(
  process.env.OPENCLAW_WORKSPACE_DIR ||
    path.join(os.homedir(), ".openclaw", "workspace"),
  ".learnings"
);

const LIKELY_CORRECTION_PATTERNS = [
  /不对|不是这样|错了|incorrect|wrong|that's wrong/i,
  /实际上|actually|事实上/i,
  /等等|wait|hold on/i,
];

function ensureLearningsDir() {
  try {
    fs.mkdirSync(LEARNINGS_DIR, { recursive: true });
  } catch {}
}

function appendLearningsFile(filename, entry) {
  try {
    ensureLearningsDir();
    const filePath = path.join(LEARNINGS_DIR, filename);
    const timestamp = new Date().toISOString();
    const line = `\n## ${timestamp}\n${entry}\n`;
    fs.appendFileSync(filePath, line, "utf8");
  } catch {}
}

export default async function handler(event) {
  // ── agent:bootstrap ────────────────────────────────────────────────
  if (event.type === "agent" && event.action === "bootstrap") {
    // Inject self-improvement reminder for this session
    const reminder = `\n[SELF_IMPROVEMENT_REMINDER]\n在回复前，建议检查以下来源是否有相关内容：\n1. ~/.openclaw/workspace/.learnings/ERRORS.md - 历史错误记录\n2. ~/.openclaw/workspace/.learnings/CORRECTIONS.md - 历史纠正记录\n3. ~/.openclaw/workspace/.learnings/LEARNINGS.md - 通用经验\n如果有相关记录，请在回复中引用或应用。\n[/SELF_IMPROVEMENT_REMINDER]\n`;

    // Inject into bodyForAgent so the LLM sees it at session start
    if (event.context) {
      event.context.bodyForAgent = (event.context.bodyForAgent || "") + reminder;
    }
    return;
  }

  // ── agent:response ────────────────────────────────────────────────
  if (event.type !== "agent" || event.action !== "response") return;

  const content = String(event.response?.content || event.content || "");
  if (!content.trim()) return;

  // 检测纠正模式
  for (const pattern of LIKELY_CORRECTION_PATTERNS) {
    if (pattern.test(content)) {
      // 简单记录（详细分析由 session-summary hook 的 LLM 处理）
      appendLearningsFile("CORRECTIONS.md", `AI 回复可能包含纠正: ${content.slice(0, 100)}`);
      break;
    }
  }
}
