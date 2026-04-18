# OpenClaw Hooks 架构文档

> 生成时间：2026-04-18
> 路径：`~/.openclaw/hooks/`

---

## 1. 概述

OpenClaw Hooks 是事件驱动的扩展系统，嵌入 agent 生命周期关键节点，支持自动化路由、会话摘要、意图分类、上下文监控、自我改进等功能。

**核心设计原则：**
- 事件驱动：每个 hook 声明监听的事件类型，事件触发时自动执行
- 异步优先：耗操作（LLM 调用、文件 I/O）均为后台执行，不阻塞主流程
- 静默降级：依赖不可用时 hook 不报错，确保核心流程不受影响
- 虚拟文件注入：部分 hook 向 bootstrap 注入内存中的虚拟文件，不落盘

---

## 2. Hook 注册与加载机制

### 2.1 Hook 发现路径

```
~/.openclaw/hooks/
├── HOOK.md                          # 根级说明文档
├── handler.js                       # 根级 JS handler（多 hook 聚合）
├── handler.ts                       # TypeScript 版本（与 handler.js 内容相同）
├── context-hook.js                  # 独立 context hook
├── self-improvement.js              # 空占位文件（0 字节）
├── on-command-error.sh              # Shell hook（命令错误时）
├── on-message.sh                    # Shell hook（消息接收时）
│
├── auto-score-classify/             # 目录 hook #1
│   ├── HOOK.md
│   └── handler.js
│
├── session-summary/                 # 目录 hook #2
│   ├── HOOK.md
│   └── handler.js
│
├── auto-router/                     # 目录 hook #3
│   └── HOOK.md                      # ⚠️ 只有文档，无 handler 实现
│
└── context-monitor/                 # 目录 hook #4
    ├── HOOK.md
    └── handler.js
```

### 2.2 Hook 类型

| 类型 | 格式 | 示例 |
|------|------|------|
| **根级单文件** | `*.js` / `*.sh` 位于 `hooks/` 根目录 | `context-hook.js`, `on-message.sh` |
| **目录 bundle** | `HOOK.md` + `handler.js` 在同名子目录 | `session-summary/`, `auto-score-classify/` |

### 2.3 HOOK.md 元数据格式

每个目录 hook 必须包含 `HOOK.md`，格式如下：

```yaml
---
name: hook-name
description: "一句话描述 hook 功能"
metadata:
  openclaw:
    emoji: "🎯"
    events: ["message:preprocessed", "agent:bootstrap"]
    requires:
      bins: ["node"]          # 需要的系统命令
      config: ["workspace.dir"]  # 需要的配置项
    always: true               # 是否常驻（always hooks 在每次事件必执行）
---
```

---

## 3. 事件类型参考

| 事件名 | 触发时机 | 涉及 Hook |
|--------|----------|-----------|
| `agent:bootstrap` | Agent 启动初始化阶段，workspace 文件注入前 | `self-improvement` |
| `agent:preparing` | Agent 准备响应阶段 | `auto-router` |
| `agent:response` | Agent 回复发送后 | `context-monitor`, `context-hook` |
| `message` | 通用消息事件 | `auto-score-classify`, `context-monitor` |
| `message:receive` | 用户消息到达 | `context-hook`, `on-message.sh` |
| `message:send` | AI 消息发送 | `context-hook` |
| `message:preprocessed` | 消息预处理后、正式处理前 | `auto-score-classify`, `context-monitor` |
| `command:new` | 用户执行 `/new` | `session-summary` |
| `command:reset` | 用户执行 `/reset` | `session-summary` |

---

## 4. Hook 详细规格

---

### 4.1 `self-improvement` (根级 + 目录两种形式)

**文件位置：**
- 根级（实际生效）：`~/.openclaw/hooks/handler.js`（包含完整实现）
- 根级副本：`handler.ts`（内容相同，TypeScript 格式）
- 空占位：`self-improvement.js`（0 字节，无效）

**监听事件：** `agent:bootstrap`

**元数据：**
```yaml
emoji: "🧠"
events: ["agent:bootstrap"]
```

**功能：**
1. **自省提醒注入**：在 bootstrap 阶段向 `bootstrapFiles` 数组注入 `SELF_IMPROVEMENT_REMINDER.md` 虚拟文件，内容为自我改进记录规范（学习、纠错、特性请求的记录路径）
2. **上轮会话摘要注入**：扫描 `memory/` 目录，查找最新的 `*-session-summary.md` 文件（按 mtime 排序），读取其内容（去除 `<!-- summary-only -->` 和 `<!-- source: -->` 标签）后以 `PREVIOUS_SESSION_SUMMARY.md` 虚拟文件注入

**关键逻辑：**
- 跳过 sub-agent session（`sessionKey` 包含 `:subagent:` 则直接返回）
- 要求 `event.context.bootstrapFiles` 为数组，否则跳过
- 摘要查找路径：`${OPENCLAW_WORKSPACE_DIR}/memory/` 或 `~/.openclaw/workspace/main/memory/`
- 查找文件名模式：`*-session-summary-*.md`

**依赖：** Node.js 内置模块 `fs`, `path`, `os`（无外部依赖）

**配置参数：** 无

**输出结果文件：** 无（纯内存虚拟文件注入）

---

### 4.2 `context-hook` (`context-hook.js`)

**文件位置：** `~/.openclaw/hooks/context-hook.js`

**监听事件：** `message:receive`（用户消息）, `message:send`（AI消息）, `agent:response`

**功能：**
1. 尝试加载 `~/.openclaw/protection/index.js` 保护层模块并初始化
2. 若 `global.openclaw.addContextMessage` 可用，将消息内容记录到全局上下文
3. 用户消息记录 role=`user`，AI 回复记录 role=`assistant`
4. 日志输出截取前 30 字符

**依赖：**
- Node.js
- `~/.openclaw/protection/index.js`（可选，不存在时静默跳过）

**配置参数：** 无

**已知问题：** 使用已废弃的 `module.exports` 导出方式（CommonJS），与 ESM 项目混用。

---

### 4.3 `on-command-error.sh`

**文件位置：** `~/.openclaw/hooks/on-command-error.sh`

**执行方式：** Shell 脚本，可执行权限 `rwxr-xr-x`

**触发条件：** 命令执行错误时

**功能：**
将错误信息追加写入 `~/.openclaw/workspace/.learnings/ERRORS.md`

**日志格式：**
```markdown
## 2026-04-18T12:08:00+08:00
- Command: <OPENCLAW_COMMAND 环境变量>
- Error: <OPENCLAW_ERROR 环境变量>
```

**依赖环境变量：**
| 变量名 | 说明 |
|--------|------|
| `OPENCLAW_COMMAND` | 执行的命令 |
| `OPENCLAW_ERROR` | 错误信息 |

**配置参数：** 无

**目录要求：** `~/.openclaw/workspace/.learnings/` 目录不存在时自动创建（`mkdir -p`）

---

### 4.4 `on-message.sh`

**文件位置：** `~/.openclaw/hooks/on-message.sh`

**执行方式：** Shell 脚本，可执行权限

**触发条件：** 消息到达时

**功能：**
将消息通过 HTTP POST 发送到 Context API（`http://127.0.0.1:3101/api/context`）

**请求格式：**
```bash
curl -X POST "http://127.0.0.1:3101/api/context" \
  -H "Content-Type: application/json" \
  -d '{"role":"user","content":"<MESSAGE>","user":"<SENDER>","channel":"<CHANNEL>"}'
```

**依赖环境变量：**
| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `OPENCLAW_MESSAGE` | 消息内容 | （空） |
| `OPENCLAW_SENDER` | 发送者 | `unknown` |
| `OPENCLAW_CHANNEL` | 频道 | `unknown` |

**依赖服务：** `http://127.0.0.1:3101`（Context API / openclaw-router）

**配置参数：** 无

**错误处理：** `|| true` 静默忽略所有错误

---

### 4.5 `auto-score-classify`

**文件位置：** `~/.openclaw/hooks/auto-score-classify/`

**监听事件：** `message:preprocessed`

**元数据：**
```yaml
emoji: "🎯"
events: ["message:preprocessed"]
requires:
  bins: ["node"]
always: true
```

**功能：**
每条消息自动调用 v8 分类和评分服务，结果写入 session `context.json`。

**API 调用：**
- **v8_classifier** (`3105`): `POST http://127.0.0.1:3105/classify` — 意图分类
- **v8_scorer** (`3103`): `GET http://127.0.0.1:3103/api/score` — 复杂度评分

**并发策略：** 两个 API 并发调用，不阻塞主流程。

**输出文件：** `~/.openclaw/sessions/{sessionKey}/context.json`

**context.json 结构：**
```json
{
  "classification": {
    "response": "LLM 响应文本",
    "intercepted": false,
    "scene": "task_multi_step",
    "meta": "confident",
    "confidence": 0.81
  },
  "scoring": {
    "score": 57,
    "factors": { "logic": 2, "risk": 0, "duration": 2 },
    "recommendedStrategy": "SPAWN_SUBAGENT",
    "timeout": 120
  },
  "timestamp": "2026-04-13T01:40:00.000Z",
  "messagePreview": "重构这个项目..."
}
```

**AUTO_ROUTE 强制模式：**
当前 `handler.js` 实现了一个强制派发变体：
- 检测消息是否已包含 `[AUTO_ROUTE]` 前缀，若有则跳过
- 将所有任务消息强制加上 `[AUTO_ROUTE]` 前缀，触发 `sessions_spawn` 自动派发
- 评分阈值设置为 `0`（所有消息都派发）

**降级策略：** API 不可用时静默降级，不影响消息处理

**依赖：**
- Node.js
- HTTP 访问 `127.0.0.1:3103` 和 `127.0.0.1:3105`

**配置参数：** 无

---

### 4.6 `session-summary`

**文件位置：** `~/.openclaw/hooks/session-summary/`

**监听事件：** `command:new`, `command:reset`

**元数据：**
```yaml
emoji: "📝"
events: ["command:new", "command:reset"]
requires:
  bins: ["node"]
  config: ["workspace.dir"]
always: true
```

**功能：**
在用户执行 `/new` 或 `/reset` 时，自动生成上一轮 session 的结构化摘要，写入 `memory/` 目录。

**核心流程：**

```
1. 触发检测 (command:new | command:reset)
       ↓
2. 解析 session 文件路径
   - 优先: context.previousSessionEntry.sessionFile
   - 兜底: 搜索 agents/main/sessions/ 目录
       ↓
3. 从 .jsonl 提取最新 40 条 user/assistant 消息
       ↓
4. 读取 ephemeral/ 当天碎片（按 sessionKey 过滤，最多 20 条）
       ↓
5. 调用 LLM 生成结构化摘要 + entity 升格决策
       ↓
6. 异步写入 memory/YYYY-MM-DD-session-summary-{slug}.md
       ↓
7. 执行 entity 升格（创建/更新 memory/entities/*.md）
       ↓
8. 清理 30 天前旧摘要（后台）
```

**摘要文件格式：**
```markdown
# Session: 2026-04-18 12:08

<!-- summary-only -->
## 主题
一句话概括，少于20字

## AI 决策模式
基于 scene/score/strategy 数据分析，1-3句描述

## 关键决策
- 决策1
- 决策2

## 重要发现
- 发现1

## 待跟进
- 待办1

<!-- source: agent:main:main:xxx -->
```

**Ephemeral 记忆碎片预览格式：**
```
[scene] score=N "text preview..."
```

**Entity 升格规范：**
只有以下类型才升格为 entity 页：
- 系统组件状态变化（如：3104 修复了、3103 配置改了）
- 用户偏好发现（如：喜欢中文、务实风格）
- 项目进度更新（如：项目 X 现在做到哪了）
- 关键结论或教训（如：方案 A 比方案 B 好）

**Entity 文件格式：**
```markdown
# Entity: {entity-name}

## 基本信息
{内容}

## 更新
### YYYY-MM-DD
{更新内容}
```

**LLM 调用配置：**
- 端点：`https://zhenze-huhehaote.cmecloud.cn/api/coding/v1/chat/completions`
- 模型：`minimax-m2.5`
- Temperature: `0.3`
- Max tokens: `800`
- 超时：`20s`（单边超时强制销毁请求）

**Session 文件搜索算法（7 级兜底）：**
1. `currentSessionFile` 本身是 `.reset.` 文件 → 直接使用
2. 有 base 名 → 优先找活跃文件，找不到则找 reset 变体
3. `sessionId` 精确匹配 `.jsonl`
4. `sessionId-topic-*.jsonl` 变体
5. `sessionId.jsonl.reset.*` 变体
6. 完全兜底：最新 reset 文件
7. Fallback：最新 `.jsonl`（非 reset）

**Ephemeral 去重规则：**
- 相同 text 前 100 字符的去重
- 最多保留 20 条

**旧摘要清理：**
- 保留期限：30 天
- 清理触发：每次 hook 执行时后台运行

**降级策略：**
- LLM 不可用或超时 → 使用规则摘要（第一行作为主题，其余为空）
- session 内容为空但有 ephemeral → 用 ephemeral 碎片生成摘要
- 完全无内容 → 生成占位摘要

**依赖：**
- Node.js
- LLM API（通过硬编码 endpoint 调用）
- `memory/` 目录可写

**配置参数：**
| 参数 | 说明 | 默认值 |
|------|------|--------|
| `workspace.dir` | 工作区根目录 | `~/.openclaw/workspace/main` |

**输出文件：**
- 主文件：`memory/YYYY-MM-DD-session-summary-{slug}.md`
- Entity 文件：`memory/entities/{name}.md`

---

### 4.7 `auto-router`

**文件位置：** `~/.openclaw/hooks/auto-router/`

**监听事件：** `agent:preparing`

**元数据：**
```yaml
emoji: "🔀"
events: ["agent:preparing"]
requires:
  bins: ["node"]
always: true
```

**⚠️ 状态：只有 HOOK.md，无 handler.js 实现**

**功能（设计意图）：**
- 读取 ephemeral 中的 v8 评分结果
- 超过阈值时自动 fork 子 agent 处理
- 主 agent 返回"任务已提交"

**依赖：** Node.js

**配置参数：** 无

---

### 4.8 `context-monitor`

**文件位置：** `~/.openclaw/hooks/context-monitor/`

**监听事件：** `message:preprocessed`, `agent:response`

**元数据：**
```yaml
emoji: "🧠"
events: ["message:preprocessed", "agent:response"]
requires:
  bins: ["node"]
  config: ["context"]
always: true
```

**功能：**
监控 session context 大小，当 token 数量超过阈值时触发自动压缩。

**Token 计算规则：**
```
token_count = ceil(chinese_chars / 1.5) + ceil(other_chars / 4)
```

**压缩算法：**
1. 分离 system 消息（保留全部）
2. 保留最近 N 条消息（N = `preserveRecentTurns`）
3. 其余消息替换为单条 system 摘要消息
4. 压缩后写入 session context 文件

**配置参数（来自 `~/.openclaw/openclaw.json`）：**
| 参数 | 说明 | 默认值 |
|------|------|--------|
| `context.maxContextTokens` | 最大 token 上限 | `160000` |
| `context.summarizeThreshold` | 触发压缩的阈值比例 | `0.75` |
| `context.preserveRecentTurns` | 压缩时保留的最近消息数 | `10` |
| `context.monitoringEnabled` | 是否启用监控 | `true` |

**触发条件：**
```
current_tokens > (maxContextTokens * summarizeThreshold)
```

**监控文件路径：**
```
${OPENCLAW_SESSION_CONTEXT_PATH}
或 ${OPENCLAW_STATE_DIR}/sessions/agent:main:main/context.json
或 /home/ai/.openclaw/sessions/agent:main:main/context.json
```

**Session context.json 结构：**
```json
{
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

**依赖：**
- Node.js
- `~/.openclaw/openclaw.json`（含 context 配置）
- Session context.json 文件可读写

**配置参数：** 见上表

---

## 5. Hook 执行上下文（event 对象结构）

Hook handler 接收的 `event` 对象典型结构：

```typescript
interface HookEvent {
  type: string;          // 事件类型，如 "message", "command", "agent"
  action: string;        // 动作，如 "preprocessed", "new", "reset", "bootstrap"
  sessionKey: string;   // session 唯一标识，格式如 "agent:main:main:uuid"
  context: {
    // Hook-specific context
    bodyForAgent?: string;        // auto-score-classify 读写
    bootstrapFiles?: Array<{      // self-improvement 读写
      path: string;
      content: string;
      virtual: boolean;
    }>;
    previousSessionEntry?: {
      sessionFile?: string;
      sessionId?: string;
    };
    sessionEntry?: {
      sessionFile?: string;
      sessionId?: string;
    };
    workspaceDir?: string;
    cfg?: object;
  };
}
```

---

## 6. 依赖关系图

```
┌──────────────────────────────────────────────────────────────┐
│                      Hooks Layer                             │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  agent:bootstrap                                             │
│  └── self-improvement ──────► memory/*-session-summary.md    │
│                                (reads previous summaries)    │
│                                                              │
│  message:preprocessed                                        │
│  ├── auto-score-classify ────► 3105 (classifier)            │
│  │                               3103 (scorer)               │
│  │                               sessions/{key}/context.json  │
│  │                                                           │
│  ├── context-monitor ────────► openclaw.json (config)       │
│  │                               sessions/{key}/context.json  │
│  │                                                           │
│  └── context-hook ────────────► protection/index.js          │
│                                                              │
│  agent:preparing                                             │
│  └── auto-router ─────────────► (未实现)                    │
│                                                              │
│  agent:response                                              │
│  └── context-monitor ────────► (同 message:preprocessed)    │
│                                                              │
│  message:receive                                             │
│  ├── context-hook ────────────► protection/index.js          │
│  │                                                           │
│  └── on-message.sh ───────────► 3101 (Context API)          │
│                                                              │
│  message:send                                                │
│  └── context-hook ────────────► protection/index.js          │
│                                                              │
│  command:new / command:reset                                 │
│  └── session-summary ────────► LLM API (external)           │
│                                  memory/YYYY-MM-DD-*.md      │
│                                  memory/entities/*.md        │
│                                                              │
│  command:error                                               │
│  └── on-command-error.sh ─────► workspace/.learnings/        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 7. 配置文件依赖

| Hook | 配置文件 | 必选 |
|------|----------|------|
| `context-monitor` | `~/.openclaw/openclaw.json`（`context.*` 节点） | 是 |
| `session-summary` | `~/.openclaw/openclaw.json`（`workspace.dir`） | 间接 |
| `on-message.sh` | 无 | — |
| `on-command-error.sh` | 无 | — |
| `self-improvement` | 无 | — |
| `context-hook` | `~/.openclaw/protection/index.js`（可选） | 否 |
| `auto-score-classify` | 无 | — |
| `auto-router` | 无 | — |
| `context-monitor` | `~/.openclaw/openclaw.json` | 是 |

---

## 8. 已知问题

| # | 问题 | 严重程度 | 说明 |
|---|------|----------|------|
| 1 | `auto-router/` 只有 `HOOK.md`，无 `handler.js` | 中 | 设计功能未实现 |
| 2 | `self-improvement.js` 是 0 字节空文件 | 低 | 占位文件无实际作用 |
| 3 | `context-hook.js` 使用 `module.exports`（CommonJS） | 低 | 与 ESM 项目混用，可能在纯 ESM 环境下失败 |
| 4 | `session-summary` LLM 调用使用硬编码 API endpoint | 中 | 绑定特定供应商，缺乏抽象 |
| 5 | `on-message.sh` HTTP 请求无超时控制 | 低 | 可能被阻塞 |

---

## 9. 快速索引

| Hook 名称 | 事件 | 功能一句话 |
|----------|------|----------|
| `self-improvement` | `agent:bootstrap` | 注入自省提醒 + 上轮摘要 |
| `context-hook` | `message:receive/send` | 消息记录到保护层上下文 |
| `on-command-error.sh` | 命令错误 | 错误日志写入 learnings |
| `on-message.sh` | 消息到达 | 消息 POST 到 3101 API |
| `auto-score-classify` | `message:preprocessed` | 意图分类 + 复杂度评分 |
| `session-summary` | `command:new/reset` | 生成 session 摘要 + entity 升格 |
| `auto-router` | `agent:preparing` | 🔴 未实现 |
| `context-monitor` | `message:preprocessed`, `agent:response` | Context 大小监控 + 压缩 |
