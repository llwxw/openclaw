/**
 * auto-score-classify hook v11
 * 事件: message:preprocessed
 * 功能:
 *   1. 调用 3103 scorer，基于双阈值滞环决定是否注入 [AUTO_ROUTE]
 *   2. 追踪每个 session 的派发状态，防止重复派发
 *   3. 将评分结果写入 ephemeral/*.jsonl
 *
 * 双阈值滞环逻辑（钱学森第10章描述函数工程实现）:
 *   - SPAWN_ON = 45: score >= 此值 → 派发
 *   - SPAWN_OFF = 38: score < 此值 → 取消/不派发
 *   - 38 <= score < 45: 保持当前状态不变（滞环带，消除颤震）
 *
 *   从 ~/.openclaw/memory/CONTROL_META.yaml 动态读取阈值
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "os";

const SCORER_URL = "http://127.0.0.1:3103/api/score";
const TIMEOUT_MS = 5000;
const EPHEMERAL_DIR = "/home/ai/.openclaw/workspace/memory/ephemeral";
const CONFIG_FILE = "/home/ai/.openclaw/memory/CONTROL_META.yaml";

// 默认阈值（SPAWN_ON > SPAWN_OFF，形成滞环）
let SPAWN_ON = 45;
let SPAWN_OFF = 38;
let CURRENT_MODE = "normal";  // normal / conservative / exploration / launch

// 内存缓存：sessionKey -> { spawned: bool, last_score: int }
const sessionState = new Map();

function log(...args) {
  console.log(`[hook-v11] ${new Date().toISOString()} ${args.join(" ")}`);
}

// 从 CONTROL_META.yaml 读取当前阈值和模式
function loadConfig() {
  try {
    const content = fs.readFileSync(CONFIG_FILE, "utf8");
    // 状态机解析 YAML（支持多行嵌套结构）
    let section = null;
    let subKey = null;
    for (const line of content.split("\n")) {
      // 检测顶级字段行（缩进0/2空格，key:形式，value可空）
      const topMatch = line.match(/^\s*([A-Za-z_]+):\s*$/);
      if (topMatch) { section = topMatch[1]; subKey = null; continue; }
      // 检测子字段行（4空格缩进，key:value）
      const subMatch = line.match(/^\s{4}(\w+):\s*(.*)/);
      if (subMatch && section) {
        subKey = subMatch[1];
        const val = subMatch[2].trim();
        if (section === 'SPAWN_ON' && subKey === 'current') SPAWN_ON = parseInt(val) || SPAWN_ON;
        else if (section === 'SPAWN_OFF' && subKey === 'current') SPAWN_OFF = parseInt(val) || SPAWN_OFF;
        else if (subKey === 'current_mode') CURRENT_MODE = val || CURRENT_MODE;
      }
    }
  } catch (e) {
    // 使用默认值
  }
  // 保守模式下阈值提高
  if (CURRENT_MODE === "conservative") {
    SPAWN_ON = Math.min(60, SPAWN_ON + 10);
    SPAWN_OFF = Math.max(30, SPAWN_OFF - 5);
  }
}

function httpPost(url, body, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve) => {
    const postData = JSON.stringify(body);
    const timers = [];
    const done = (val, err) => { timers.forEach(clearTimeout); resolve([val, err]); };
    const req = http.request(
      url,
      { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(postData) }, timeout: timeoutMs },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => { try { done({ ok: true, body: JSON.parse(data) }, null); } catch { done({ ok: false }, new Error("non-json")); } });
      }
    );
    req.on("timeout", () => { req.destroy(); done({ ok: false }, new Error("timeout")); });
    req.on("error", (e) => done({ ok: false }, e));
    timers.push(setTimeout(() => { req.destroy(); done({ ok: false }, new Error("timeout")); }, timeoutMs));
    req.write(postData);
    req.end();
  });
}

// 检查当前小时 ephemeral 文件中该 session 是否已被派发过
function checkSessionSpawned(sessionKey) {
  const today = new Date().toISOString().slice(0, 10);
  const hour = String(new Date().getHours()).padStart(2, "0");
  const filePath = path.join(EPHEMERAL_DIR, `${today}-${hour}.jsonl`);
  try {
    if (!fs.existsSync(filePath)) return false;
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        // 找同一 session 的最新记录
        if (obj.sessionKey === sessionKey) {
          if (obj._spawned === true) return true;
          if (obj._spawned === false) return false;
        }
      } catch {}
    }
  } catch {}
  return false;
}

// 写入 ephemeral，带 _spawned 标记
function writeEphemeral(sessionKey, text, score, strategy, factors, spawned) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const hour = String(new Date().getHours()).padStart(2, "0");
    const filePath = path.join(EPHEMERAL_DIR, `${today}-${hour}.jsonl`);
    const entry = {
      timestamp: new Date().toISOString(),
      sessionKey,
      scene: "task",
      score,
      strategy,
      factors,
      _spawned: spawned,
      preview: text.slice(0, 100),
    };
    fs.appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf8");
  } catch (err) {
    log(`EPHEMERAL_WRITE_ERROR: ${err.message}`);
  }
}

export default async function handler(event) {
  if (event.type !== "message" || event.action !== "preprocessed") return;
  const text = String(event.context?.bodyForAgent || "");
  if (!text.trim()) return;
  if (text.startsWith("[AUTO_ROUTE]")) return;
  if (text === "HEARTBEAT_OK" || text.startsWith("Read HEARTBEAT.md")) {
    log(`HEARTBEAT skip`);
    return;
  }

  // 每次加载最新配置
  loadConfig();

  const sessionKey = event.sessionKey || "unknown";

  // 调用评分器
  const [result, err] = await httpPost(SCORER_URL, { text });
  if (!err && result.ok) {
    const { score, recommendedStrategy, factors } = result.body;
    
    // 获取该 session 当前状态（ephemeral中是否已派发）
    const alreadySpawned = checkSessionSpawned(sessionKey);
    
    // 查缓存（ephemeral可能不完整）
    const cached = sessionState.get(sessionKey);
    const wasSpawned = alreadySpawned || (cached ? cached.spawned : false);
    const lastScore = cached ? cached.last_score : null;

    // 双阈值滞环决策
    let shouldSpawn = false;
    let shouldSuppress = false;

    if (wasSpawned) {
      // 已派发过：只在 score >= SPAWN_ON 时继续派发（保持）
      // score 降到 SPAWN_OFF 以下才取消
      if (score >= SPAWN_ON) {
        shouldSpawn = true;
      } else if (score < SPAWN_OFF) {
        shouldSuppress = true;
      }
      // 38 <= score < 45：保持当前状态，不操作
    } else {
      // 未派发过：只在 score >= SPAWN_ON 时派发
      if (score >= SPAWN_ON) {
        shouldSpawn = true;
      }
    }

    // 写入 ephemeral（无论是否派发都记录）
    if (shouldSpawn) {
      writeEphemeral(sessionKey, text, score, recommendedStrategy, factors, true);
      sessionState.set(sessionKey, { spawned: true, last_score: score });
    } else {
      writeEphemeral(sessionKey, text, score, recommendedStrategy, factors, false);
      sessionState.set(sessionKey, { spawned: false, last_score: score });
    }

    if (shouldSpawn) {
      event.context.bodyForAgent = `[AUTO_ROUTE] ${text}`;
      log(`SPAWN: score=${score} ON=${SPAWN_ON} OFF=${SPAWN_OFF} mode=${CURRENT_MODE} [AUTO_ROUTE] injected`);
    } else if (shouldSuppress) {
      log(`SUPPRESS: score=${score} < SPAWN_OFF=${SPAWN_OFF} - keeping spawned session suppressed`);
    } else {
      log(`SKIP: score=${score} (wasSpawned=${wasSpawned}, hysteresis band 38-45)`);
    }
  } else {
    log(`SCORER_ERROR: ${err?.message || "unknown"}, falling back to normal`);
  }
}
