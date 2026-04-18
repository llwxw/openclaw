/**
 * session-summary hook
 *
 * 触发时机: /new 或 /reset
 * 行为: 
 *   1. 读取上一个 session 的内容
 *   2. 读取 ephemeral/ 中的记忆碎片
 *   3. 调 LLM 生成结构化摘要 + entity 升格决策
 *   4. 写入 memory/YYYY-MM-DD-summary.md
 *   5. 执行 entity 升格（创建/更新 memory/entities/*.md）
 * 降级: LLM 失败时写规则摘要，不报错
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";

// ─── Constants ────────────────────────────────────────────────────────────────

const MEMORY_DIR = path.join(
  process.env.OPENCLAW_WORKSPACE_DIR ||
    path.join(os.homedir(), ".openclaw", "workspace", "main"),
  "memory"
);
const EPHEMERAL_DIR = path.join(MEMORY_DIR, "ephemeral");
const ENTITIES_DIR = path.join(MEMORY_DIR, "entities");
const LLM_TIMEOUT_MS = 20_000;

// ─── Types (JSDoc) ─────────────────────────────────────────────────────────

/**
 * @typedef {Object} SessionEntry
 * @property {string} [sessionFile]
 * @property {string} [sessionId]
 */

/**
 * @typedef {Object} HookContext
 * @property {SessionEntry} [previousSessionEntry]
 * @property {SessionEntry} [sessionEntry]
 */

/**
 * @typedef {Object} EphemeralEntry
 * @property {string} timestamp
 * @property {string} sessionKey
 * @property {string} text
 * @property {string} textPreview
 * @property {object} classification
 * @property {object} scoring
 */

// ─── Session File Resolution ──────────────────────────────────────────────────

/**
 * 从 context 中提取 session 文件路径。
 * 优先使用 previousSessionEntry（旧 session，即刚结束的那个）。
 * @param {HookContext} context
  * @returns {string|Promise<string|null>}
 */
function resolveSessionFile(context, workspaceDir) {
  const prev = context?.previousSessionEntry;
  if (prev?.sessionFile) return prev.sessionFile;

  const curr = context?.sessionEntry;
  if (curr?.sessionFile) return curr.sessionFile;

  // Webchat sessions have no .jsonl files — search sessions directory
  // 实际 session 数据在 agents/main/sessions/，不是 sessions/
  let sessionsDir;
  if (workspaceDir) {
    sessionsDir = path.join(workspaceDir, 'agents', 'main', 'sessions');
  } else {
    sessionsDir = path.join(os.homedir(), '.openclaw', 'agents', 'main', 'sessions');
  }
  const sessionId = prev?.sessionId || curr?.sessionId;
  return findPreviousSessionFile(prev?.sessionFile || curr?.sessionFile, sessionId, sessionsDir);
}

// ─── Session File Search (bundled hook compatible) ─────────────────────────────

/**
 * 从 agents/main/sessions/ 目录搜索匹配当前 session 的 .jsonl 文件。
 * 来自 bundled session-memory hook 的 findPreviousSessionFile 逻辑。
 * @param {string|undefined} currentSessionFile
 * @param {string|undefined} sessionId
 * @param {string} sessionsDir
 * @returns {Promise<string|null>}
 */
async function findPreviousSessionFile(currentSessionFile, sessionId, sessionsDir) {
  try {
    const files = await fs.promises.readdir(sessionsDir);
    const fileSet = new Set(files);

    // 1. currentSessionFile 本身是 reset 文件 → 直接使用（session 已结束，活跃文件被改名）
    if (currentSessionFile && path.basename(currentSessionFile).includes('.reset.')) {
      return currentSessionFile;
    }

    // 2. 有 base 名（reset 文件改名后的原始名）→ 优先找活跃文件，没有则找 reset 文件
    if (currentSessionFile) {
      const base = path.basename(currentSessionFile).replace(/\.reset\..+$/, '');
      if (fileSet.has(base)) return path.join(sessionsDir, base);
      // 原始文件不存在（reset 后），找对应的 reset 文件
      const resetVariant = files
        .filter(n => n.startsWith(base + '.jsonl.reset.'))
        .sort()
        .reverse()[0];
      if (resetVariant) return path.join(sessionsDir, resetVariant);
    }

    // 3. sessionId 精确匹配
    if (sessionId?.trim()) {
      const canonical = `${sessionId.trim()}.jsonl`;
      if (fileSet.has(canonical)) return path.join(sessionsDir, canonical);
      // 4. sessionId-topic-*.jsonl 变体
      const topicVariant = files
        .filter(n => n.startsWith(`${sessionId.trim()}-topic-`) && n.endsWith('.jsonl') && !n.includes('.reset.'))
        .sort()
        .reverse()[0];
      if (topicVariant) return path.join(sessionsDir, topicVariant);
      // 5. sessionId 的 reset 文件（webchat 无 currentSessionFile 时兜底）
      const idResetVariant = files
        .filter(n => n.startsWith(`${sessionId.trim()}.jsonl.reset.`))
        .sort()
        .reverse()[0];
      if (idResetVariant) return path.join(sessionsDir, idResetVariant);
    }

    // 6. 完全兜底：最新 reset 文件（webchat 可能 sessionId/currentSessionFile 均为空）
    if (!currentSessionFile && !sessionId?.trim()) {
      const latestReset = files
        .filter(n => n.includes('.reset.'))
        .sort()
        .reverse()[0];
      if (latestReset) return path.join(sessionsDir, latestReset);
    }

    // 7. fallback: 最新 .jsonl（非 reset，仅当前 session 自己）
    if (!currentSessionFile) {
      const latest = files
        .filter(n => n.endsWith('.jsonl') && !n.includes('.reset.'))
        .sort()
        .reverse()[0];
      if (latest) return path.join(sessionsDir, latest);
    }
  } catch {}
  return null;
}

/**
 * @param {unknown} content
 * @returns {string}
 */
function extractTextFromBlocks(content) {
  if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        block.type === "text" &&
        typeof block.text === "string"
      ) {
        return block.text;
      }
    }
  }
  return "";
}

/**
 * 从 .jsonl 文件中提取最新 N 条 user/assistant 消息。
 * @param {string} filePath
 * @param {number} [messageCount=40]
 * @returns {Promise<string>}
 */
async function extractMessages(filePath, messageCount = 40) {
  try {
    const content = await fs.promises.readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").slice(-messageCount * 2);
    /** @type {string[]} */
    const messages = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        /** @type {{ type: string, message?: { role: string, content: unknown } }} */
        const entry = JSON.parse(line);
        if (entry.type !== "message") continue;
        const msg = entry.message;
        if (!msg?.role || !msg?.content) continue;
        if (msg.role !== "user" && msg.role !== "assistant") continue;

        const text =
          typeof msg.content === "string"
            ? msg.content
            : extractTextFromBlocks(msg.content);

        if (!text || text.startsWith("/")) continue;
        messages.push(`${msg.role}: ${text}`);
      } catch {
        // skip malformed lines silently
      }
    }
    return messages.slice(-messageCount).join("\n");
  } catch {
    return "";
  }
}

// ─── Ephemeral Memory Reading ─────────────────────────────────────────────────

/**
 * 读取当天的 ephemeral 文件，按 sessionKey 过滤。
 * @param {string} sessionKey
 * @returns {Promise<{entries: EphemeralEntry[], preview: string}>}
 */
async function readEphemeralEntries(sessionKey) {
  /** @type {EphemeralEntry[]} */
  const allEntries = [];
  
  try {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const files = await fs.promises.readdir(EPHEMERAL_DIR);
    
    for (const file of files) {
      if (!file.endsWith('.jsonl') || !file.startsWith(today)) continue;
      const filePath = path.join(EPHEMERAL_DIR, file);
      try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const lines = content.trim().split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.sessionKey === sessionKey) {
              allEntries.push(entry);
            }
          } catch { /* skip */ }
        }
      } catch { /* skip file errors */ }
    }
  } catch { /* ephemeral dir may not exist */ }
  
  // 去重（相同 text 的条目只保留最新）
  const seen = new Set();
  const uniqueEntries = allEntries.filter(e => {
    const key = e.text.slice(0, 100);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  
  // 限制最多 20 条，防止 token 爆炸
  const entries = uniqueEntries.slice(-20);
  
  // 生成预览文本
  const preview = entries.length > 0
    ? entries.map(e => `[${e.classification?.scene || '?'}] score=${e.scoring?.score || 0} "${e.textPreview || e.text.slice(0, 80)}"`).join('\n')
    : '';
  
  return { entries, preview };
}

// ─── LLM Generation ────────────────────────────────────────────────────────────

/**
 * @param {string} sessionContent
 * @param {string} ephemeralPreview
 * @returns {string}
 */
function buildSummaryPrompt(sessionContent, ephemeralPreview) {
  return `你是一个会话摘要生成器，同时负责记忆升格决策。

给定以下对话记录和实时捕获的记忆碎片，生成：
1. 一个结构化摘要
2. 需要升格为 entity 页的记忆条目（只有真正重要的、涉及系统/项目/偏好的才升格）

## 对话记录：
${sessionContent || "(无会话内容)"}

## 记忆碎片（来自 ephemeral/，包含 v8 决策数据）：
${ephemeralPreview || "(无碎片)"}

## AI 决策模式分析（从碎片中的 classification/scoring 数据提炼）：
基于上述记忆碎片中的 scene（场景）、score（复杂度评分）、recommendedStrategy（推荐策略）数据，分析本 session 的 AI 决策模式：
- 主要场景类型是什么？（task/clarify/troubleshoot/chat/...）
- 复杂度评分分布如何？（低分=简单指令，高分=多步骤任务）
- 推荐策略分布？（DIRECT/STEP/SUBAGENT/PARALLEL/MEGA）
- 风险意识表现如何？（risk factor 是否有异常高值）
- 与用户互动的整体风格？（主动/被动/谨慎/大胆）

要求：
- 主题：一句话概括，少于20字
- 关键决策：列出所有决策，没有则写"无明确决策"
- 重要发现：列出有价值的结论/教训，没有则写"无"
- 待跟进：列出未完成事项，没有则写"无"
- AI 决策模式：基于上述分析给出简短描述（1-3句）

## entity 升格决策：
识别记忆碎片中值得创建或更新 entity 页的内容。只有以下类型才升格：
- 系统组件状态变化（如：3104修好了、3103配置改了）
- 用户偏好发现（如：喜欢中文、务实风格）
- 项目进度更新（如：项目X现在做到哪了）
- 关键结论或教训（如：方案A比方案B好，别再踩这个坑）

格式（严格按此格式，摘要和entity分开）：
---
## 摘要
## 主题
{主题}

## AI 决策模式
{基于 scene/score/strategy 数据的分析，1-3句描述}

## 关键决策
{决策列表}

## 重要发现
{发现列表}

## 待跟进
{待办列表}

## entities
{如果需要升格，格式：ENTITY|create|entity-name|文件路径|第1行标题|正文内容（多行）
如果没有entity需要升格，写：NONE
示例：ENTITY|create|scene-classifier|memory/entities/scene-classifier.md|# Entity: scene-classifier|## 基本信息\n- 状态: 已修复\n## 更新\n### 2026-04-13\n修复了...}
---`;
}

/**
 * @param {string} sessionContent
 * @returns {string}
 */
function buildFallbackPrompt(sessionContent) {
  return `你是一个会话摘要生成器。
给定以下对话记录，生成一个结构化摘要。

## 对话记录：
${sessionContent}

要求：
- 主题：一句话概括，少于20字
- AI 决策模式：基于可用信息推断 AI 在本 session 的决策风格（1-3句）
- 关键决策：列出所有决策，没有则写"无明确决策"
- 重要发现：列出有价值的结论/教训，没有则写"无"
- 待跟进：列出未完成事项，没有则写"无"

格式（严格按此格式）：
## 主题
{主题}

## AI 决策模式
{决策风格描述}

## 关键决策
{决策列表}

## 重要发现
{发现列表}

## 待跟进
{待办列表}`;
}

/**
 * 调用 gateway LLM 接口生成摘要。
 * 超时 20s 后自动销毁请求并降级。
 * @param {string} sessionContent
 * @param {string} ephemeralPreview
 * @returns {Promise<{summary: string, entities: Array<{action:string,name:string,file:string,content:string}>}>}
 */
async function generateSummaryWithEntities(sessionContent, ephemeralPreview) {
  const prompt = buildSummaryPrompt(sessionContent, ephemeralPreview);
  
  const postData = JSON.stringify({
    model: "minimax-m2.5",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 800,
  });

  return new Promise((resolve) => {
    let settled = false;
    const doResolve = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    const req = http.request(
      "https://zhenze-huhehaote.cmecloud.cn/api/coding/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
          "Authorization": "Bearer J99ouXWKXO8Zg5tLqv92YVsPNFhwuZc-z6z2ioeg7VE",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            const text = parsed.choices?.[0]?.message?.content || "";
            const result = parseLLMOutput(text.trim());
            doResolve(result);
          } catch {
            doResolve(generateFallbackResult(sessionContent));
          }
        });
      }
    );

    req.on("error", () => doResolve(generateFallbackResult(sessionContent)));

    // 20s 单边超时
    const timer = setTimeout(() => {
      try { req.destroy(); } catch { /* noop */ }
      doResolve(generateFallbackResult(sessionContent));
    }, LLM_TIMEOUT_MS);

    req.on("close", () => clearTimeout(timer));

    req.write(postData);
    req.end();
  });
}

/**
 * 解析 LLM 输出，提取摘要和 entity 升格指令。
 * @param {string} text
 * @returns {{summary: string, entities: Array<{action:string,name:string,file:string,content:string}>}}
 */
function parseLLMOutput(text) {
  const entities = [];
  
  // 提取 entity 块
  const entityMatch = text.match(/## entities\n([\s\S]*?)(?:---|$)/);
  const entityBlock = entityMatch ? entityMatch[1].trim() : '';
  
  if (entityBlock && entityBlock !== 'NONE') {
    const lines = entityBlock.split('\n');
    for (const line of lines) {
      const parts = line.split('|');
      if (parts.length >= 5 && parts[0] === 'ENTITY') {
        const action = parts[1].trim(); // create | update
        const name = parts[2].trim();
        const file = parts[3].trim();
        const content = parts.slice(4).join('|').trim();
        entities.push({ action, name, file, content });
      }
    }
  }
  
  // 提取摘要部分
  let summary = text.replace(/## entities\n[\s\S]*?(?:---|$)/, '').trim();
  // 去掉 ## 摘要 标记（如果LLM输出了）
  summary = summary.replace(/^## 摘要\s*/, '');
  
  return { summary: summary.trim(), entities };
}

/**
 * @param {string} sessionContent
 * @returns {{summary: string, entities: Array}}
 */
function generateFallbackResult(sessionContent) {
  const firstLine = (sessionContent.split("\n")[0] ?? "").slice(0, 60).replace(/[#*]/g, "").trim();
  const summary = `# Session 摘要

## 主题
${firstLine || "会话摘要"}

## AI 决策模式
未捕获到决策数据（ephemeral 缺失或 session 为 webchat 类型）

## 关键决策
无

## 重要发现
无

## 待跟进
见原始对话记录
`;
  return { summary, entities: [] };
}

// ─── Entity Writing ───────────────────────────────────────────────────────────

/**
 * @param {string} name
 * @param {string} content
 * @returns {Promise<void>}
 */
async function writeEntityFile(name, content) {
  try {
    await fs.promises.mkdir(ENTITIES_DIR, { recursive: true });
    const filePath = path.join(ENTITIES_DIR, `${name}.md`);
    const header = `# Entity: ${name}\n\n`;
    await fs.promises.writeFile(filePath, header + content + '\n', 'utf-8');
    console.log(`[session-summary] Entity written: ${name}.md`);
  } catch (e) {
    console.error(`[session-summary] Entity write failed: ${name}`, e);
  }
}

// ─── Fallback ────────────────────────────────────────────────────────────────

/**
 * @param {string} content
 * @param {string} date
 * @param {string} time
 * @returns {string}
 */
function buildFallbackSummary(content, date, time) {
  const firstLine = (content.split("\n")[0] ?? "").slice(0, 60).replace(/[#*]/g, "").trim();
  const preview = firstLine || "会话摘要";
  return `# Session: ${date} ${time}

## 主题
${preview}

## AI 决策模式
无决策数据（webchat 或 ephemeral 不可用）

## 关键决策
无

## 重要发现
无

## 待跟进
见原始对话记录
`;
}

// ─── File Writing ─────────────────────────────────────────────────────────────

/**
 * @param {string} summary
 * @param {string} date
 * @param {string} time
 * @param {string} sessionKey
 * @returns {Promise<void>}
 */
async function writeSummaryFile(summary, date, time, sessionKey) {
  const slug = slugFromSummary(summary, time);
  const filename = `${date}-session-summary-${slug}.md`;
  const filePath = path.join(MEMORY_DIR, filename);

  await fs.promises.mkdir(MEMORY_DIR, { recursive: true });

  const fullContent = [
    `# Session: ${date} ${time}`,
    "",
    "<!-- summary-only -->",
    summary,
    "",
    `<!-- source: ${sessionKey} -->`,
  ].join("\n");

  await fs.promises.writeFile(filePath, fullContent, "utf-8");
  console.log(`[session-summary] Written: ${filename}`);
}

/**
 * @param {string} summary
 * @param {string} time
 * @returns {string}
 */
function slugFromSummary(summary, time) {
  const match = summary.match(/^## 主题$\s*([^\n]+)/m);
  if (!match) return time.replace(/:/g, "");

  return match[1]
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || time.replace(/:/g, "");
}

// ─── Session Summary Pruning ────────────────────────────────────────────────────

const MAX_SUMMARY_AGE_DAYS = 30;

/**
 * 删除 30 天前的旧 session-summary 文件，防止累积。
 * @returns {Promise<void>}
 */
async function pruneOldSummaries() {
  try {
    const files = await fs.promises.readdir(MEMORY_DIR);
    const now = Date.now();
    const maxAge = MAX_SUMMARY_AGE_DAYS * 24 * 60 * 60 * 1000;
    let pruned = 0;

    for (const file of files) {
      if (!file.endsWith('-session-summary.md')) continue;
      const filePath = path.join(MEMORY_DIR, file);
      const stat = await fs.promises.stat(filePath);
      if (now - stat.mtimeMs > maxAge) {
        await fs.promises.unlink(filePath);
        pruned++;
      }
    }

    if (pruned > 0) {
      console.log(`[session-summary] 清理旧摘要: ${pruned} 个`);
    }
  } catch { /* ignore */ }
}

// ─── Core ─────────────────────────────────────────────────────────────────────

/**
 * @param {{ type: string, action: string, sessionKey: string, context: HookContext, messages: unknown[] }} event
 */
async function run(event) {
  const isTarget = event.type === "command" && (event.action === "new" || event.action === "reset");
  if (!isTarget) return;

  const now = new Date();
  const date = now.toISOString().split("T")[0];
  const time = now.toISOString().split("T")[1].split(".")[0].slice(0, 5);

  // 1. 解析 session 文件路径（搜索 sessions/ 目录作为兜底）
  const workspaceDir = event.context?.workspaceDir ||
    (event.context?.cfg ? path.join(os.homedir(), '.openclaw', 'workspace', 'main') : null);
  const sessionFile = await resolveSessionFile(event.context || {}, workspaceDir);

  // 2. 读取消息内容
  const content = sessionFile ? await extractMessages(sessionFile) : "";

  // 3. 读取 ephemeral 记忆碎片
  const prevSessionId = event.context?.previousSessionEntry?.sessionId || event.sessionKey;
  const { entries, preview: ephemeralPreview } = await readEphemeralEntries(prevSessionId);
  const hasEphemeral = entries.length > 0;

  // 4. 生成摘要 + entity 升格
  //    优先用 session 内容；session 空但有 ephemeral 时用 ephemeral 生成摘要
  const { summary, entities } = (content.trim().length > 50 || hasEphemeral)
    ? await generateSummaryWithEntities(
        content.trim().length > 50 ? content : `（会话内容存储在 gateway 数据库，无 .jsonl 文件。以下为实时记忆碎片：）\n${ephemeralPreview}`,
        ephemeralPreview
      )
    : { summary: buildFallbackSummary("(无会话内容)", date, time), entities: [] };

  // 5. 写入 memory/（后台，不等待）
  writeSummaryFile(summary, date, time, event.sessionKey).catch((err) => {
    console.error("[session-summary] Write error:", err);
  });

  // 6. 执行 entity 升格（后台，不等待）
  for (const entity of entities) {
    if (entity.action === 'create' || entity.action === 'update') {
      writeEntityFile(entity.name, entity.content).catch((err) => {
        console.error("[session-summary] Entity write error:", err);
      });
    }
  }

  // 7. 清理 30 天前的旧摘要文件（后台，不等待）
  pruneOldSummaries().catch((err) => {
    console.error("[session-summary] Prune error:", err);
  });
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

export default function handler(event) {
  run(event).catch((err) => {
    console.error("[session-summary] Uncaught error:", err);
  });
}
