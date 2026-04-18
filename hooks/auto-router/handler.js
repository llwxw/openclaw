/**
 * auto-router hook
 * 事件: message:preprocessed
 * 功能: 在 auto-score-classify 注入 [AUTO_ROUTE] 后，触发 sessions_spawn 派发子 agent
 *
 * 工作流程:
 * 1. 监听 message:preprocessed（与 auto-score-classify 同节点）
 * 2. 检查 bodyForAgent 是否含 [AUTO_ROUTE] 前缀
 * 3. 若存在，从文本中提取任务，调用 sessions_spawn
 * 4. 将 bodyForAgent 置空，让主 agent 跳过（由子 agent 接管）
 */
import http from "node:http";

const SCORER_URL = "http://127.0.0.1:3103/api/score";
const SPAWN_THRESHOLD = 40;

function log(...args) {
  console.log(`[auto-router] ${new Date().toISOString()} ${args.join(" ")}`);
}

export default async function handler(event) {
  // 调试：所有事件都打日志
  console.log(`[auto-router] event received: type=${event.type} action=${event.action} bodyLen=${String(event.context?.bodyForAgent||" ").length}`);

  // 只监听 message:preprocessed
  if (event.type !== "message" || event.action !== "preprocessed") return;

  const text = String(event.context?.bodyForAgent || "");
  console.log(`[auto-router] bodyForAgent preview: ${text.slice(0,80)}`);

  // 检查 [AUTO_ROUTE] 前缀（由 auto-score-classify 注入）
  if (!text.startsWith("[AUTO_ROUTE]")) return;

  // 提取原始任务文本
  const taskText = text.replace(/^\[AUTO_ROUTE\]\s*/i, "").trim();
  if (!taskText) {
    log("AUTO_ROUTE but empty task, skipping");
    return;
  }

  log(`TRIGGER spawn for: ${taskText.slice(0, 60)}`);

  try {
    // 调用 sessions_spawn 派发子 agent
    // sessions_spawn 是平台级 API，这里通过 gateway 接口触发
    const spawnRes = await fetch("http://127.0.0.1:18789/__internal__/v1/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: taskText,
        runtime: "subagent",
        mode: "run",
      }),
    });

    if (spawnRes.ok) {
      log(`SPAWN triggered successfully`);
      // 清空 bodyForAgent，让主 agent 跳过，由子 agent 处理
      event.context.bodyForAgent = "";
    } else {
      log(`SPAWN failed: ${spawnRes.status}`);
    }
  } catch (err) {
    log(`SPAWN error: ${err.message}`);
  }
}
