/**
 * auto-score-classify hook v10
 * 事件: message:preprocessed
 * 功能:
 *   1. 调用 3103 scorer，基于评分决定是否注入 [AUTO_ROUTE]
 *   2. 将评分结果写入 ephemeral/*.jsonl（供 session-summary 和调试用）
 * 降级: Scorer 不可用时静默跳过，让主 agent 正常处理
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const SCORE_THRESHOLD = 40;
const SCORER_URL = "http://127.0.0.1:3103/api/score";
const TIMEOUT_MS = 5000;
const EPHEMERAL_DIR = "/home/ai/.openclaw/workspace/memory/ephemeral";

function log(...args) {
  console.log(`[hook] ${new Date().toISOString()} ${args.join(" ")}`);
}

function httpPost(url, body, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve) => {
    const postData = JSON.stringify(body);
    const timers = [];
    const done = (val, err) => { timers.forEach(clearTimeout); resolve([val, err]); };

    const req = http.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { done({ ok: true, body: JSON.parse(data) }, null); }
          catch { done({ ok: false, body: data }, new Error("non-json")); }
        });
      }
    );
    req.on("timeout", () => { req.destroy(); done({ ok: false }, new Error("timeout")); });
    req.on("error", (e) => done({ ok: false }, e));
    timers.push(setTimeout(() => { req.destroy(); done({ ok: false }, new Error("timeout")); }, timeoutMs));
    req.write(postData);
    req.end();
  });
}

function writeEphemeral(sessionKey, text, score, strategy, factors) {
  try {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const hour = String(new Date().getHours()).padStart(2, "0");
    const filePath = path.join(EPHEMERAL_DIR, `${today}-${hour}.jsonl`);

    const entry = {
      timestamp: new Date().toISOString(),
      sessionKey,
      scene: "task",
      score,
      strategy,
      factors,
      preview: text.slice(0, 100),
    };

    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(filePath, line, "utf8");
    log(`EPHEMERAL written: ${filePath}`);
  } catch (err) {
    log(`EPHEMERAL_WRITE_ERROR: ${err.message}`);
  }
}

export default async function handler(event) {
  if (event.type !== "message" || event.action !== "preprocessed") return;

  const text = String(event.context?.bodyForAgent || "");
  if (!text.trim()) return;
  if (text.startsWith("[AUTO_ROUTE]")) return;

  // 跳过 HEARTBEAT 轮询，不评分，不派发
  if (text === "HEARTBEAT_OK" || text.startsWith("Read HEARTBEAT.md")) {
    log(`HEARTBEAT skip`);
    return;
  }

  const sessionKey = event.sessionKey || "unknown";

  // 调用 scorer
  const [result, err] = await httpPost(SCORER_URL, { text });
  if (!err && result.ok) {
    const { score, recommendedStrategy, factors } = result.body;
    log(`SCORE: ${score} (threshold=${SCORE_THRESHOLD}) strategy=${recommendedStrategy}`);

    // 写入 ephemeral
    writeEphemeral(sessionKey, text, score, recommendedStrategy, factors);

    if (score >= SCORE_THRESHOLD) {
      event.context.bodyForAgent = `[AUTO_ROUTE] ${text}`;
      log(`INJECTED [AUTO_ROUTE] score=${score}`);

      // 兜底：直接通过 gateway API spawn 子 agent
      // sessions_spawn 是工具，正常情况由 LLM 调用；这里通过 HTTP API 兜底
      spawnViaApi(text).catch(err => log(`SPAWN_VIA_API_ERR: ${err.message}`));
    } else {
      log(`SKIP: score ${score} < ${SCORE_THRESHOLD}`);
    }
  } else {
    log(`SCORER_ERROR: ${err?.message || "unknown"}, falling back to normal`);
  }
}
