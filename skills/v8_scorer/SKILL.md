---
name: v8_scorer
description: OpenClaw v8 任务复杂度评分引擎。调用 3103 API，评估任务复杂度并返回执行策略。用于判断用户任务应走 DIRECT/STEP/SUBAGENT/PARALLEL/MEGA 哪种执行路径。
version: 1.1.0
---

# v8_scorer

> OpenClaw v8 任务复杂度评分引擎（端口 3103）
>
> 基于 6 因子规则评分的生产级实现，非 ML 模型

---

## 一、评分原理

### 1.1 六因子体系

每个因子 0-3 分，总原始分 0-18 分。

| 因子 | 名称 | 含义 | 典型触发词 |
|------|------|------|-----------|
| `logic` | 逻辑复杂度 | 重构、算法、多文件、条件分支 | 重构、正则、状态机、多个文件 |
| `risk` | 风险度 | 删除、数据库、系统修改 | rm -rf、数据库、chmod、生产环境 |
| `duration` | 预估时长 | 编译、安装、测试等耗时操作 | 编译、npm install、测试、下载 |
| `resource` | 资源消耗 | GPU、视频、大数据等重载操作 | 训练、GPU、视频处理、大数据 |
| `uncertainty` | 不确定性 | API调用、网络、调试等不稳定因素 | API、curl、网络请求、调试 |
| `dependency` | 依赖复杂度 | monorepo、微服务、多依赖 | monorepo、微服务、多依赖 |

### 1.2 上下文增强规则

评分时可传入可选的 `context` 对象，触发以下增强：

| 条件 | 增强效果 |
|------|----------|
| `context.fileCount > 10` | `logic` +2（上限3） |
| `context.estimatedLines > 1000` | `duration` +2（上限3） |
| `context.isProduction === true` | `risk` +2（上限3） |

### 1.3 归一化公式

```
normalized = round(sqrt(rawScore / 18) * 100)
```

**含义**：平方根归一化，低分增长快、高分增长缓，更符合实际分布。归一化分范围 0-100，保留整数。

| 原始分 | 归一化分 |
|--------|----------|
| 0 | 0 |
| 2 | 33 |
| 3 | 41 |
| 6 | 57 |
| 9 | 70 |
| 12 | 81 |
| 18 | 100 |

### 1.4 策略选择规则

#### 特殊规则（按优先级依次判断，命中即停止）

| 优先级 | 条件 | 策略 | 超时(s) |
|--------|------|------|---------|
| 1 | `risk >= 3` | `SPAWN_SUBAGENT` | 180 |
| 2 | `resource >= 3` | `PARALLEL_SHARDS` | 300 |
| 3 | `uncertainty >= 3` | `SPAWN_SUBAGENT` | 180 |
| 4 | `duration >= 3 && dependency >= 2` | `MEGA_TASK` | 7200 |
| 5 | `logic >= 3 && duration >= 3` | `PARALLEL_SHARDS` | 300 |

#### 分数区间规则（无特殊规则命中时）

| 归一化分 | 策略 | 超时(s) |
|----------|------|---------|
| ≤20 | `DIRECT` | 30 |
| 21-40 | `STEP_ARCHIVE` | 60 |
| 41-60 | `SPAWN_SUBAGENT` | 120 |
| 61-80 | `PARALLEL_SHARDS` | 240 |
| >80 | `MEGA_TASK` | 7200 |

---

## 二、API 规范

### 2.1 评分接口

**端点**
```
POST http://127.0.0.1:3103/api/score
Content-Type: application/json
```

**请求**
```json
{
  "prompt": "<用户消息文本>",
  "context": {
    "fileCount": 5,
    "estimatedLines": 500,
    "isProduction": false
  }
}
```
`context` 字段可选，用于触发增强规则。

**响应**
```json
{
  "score": 57,
  "factors": {
    "logic": 1,
    "risk": 2,
    "duration": 0,
    "resource": 0,
    "uncertainty": 1,
    "dependency": 1
  },
  "recommendedStrategy": "SPAWN_SUBAGENT",
  "timeout": 120,
  "_raw": {
    "total": 5,
    "max": 18
  }
}
```
`_raw` 包含原始总分，用于调试和策略调优。

---

## 三、调用场景

### 必须调用的场景
- 用户请求执行多步骤任务（写代码、部署、分析、重构等）
- 需要判断任务复杂度以选择执行策略时
- 任务涉及文件操作、命令执行、API 调用时

### 可跳过的场景
- 纯闲聊（你好、天气、问候）
- 信息查询（概念解释、文档查找）
- 低风险简单问答（`v8_classifier` 已标记为 `chitchat`）

### 判断流程

```
用户消息
  ↓
调用 v8_classifier（场景识别）
  ↓
若非闲聊/模糊请求 → 调用 v8_scorer
  ↓
根据 recommendedStrategy 执行对应策略
```

---

## 四、响应示例

### 示例1：简单问答

**请求**：`"解释一下什么是闭包"`

```json
{
  "score": 0,
  "factors": {
    "logic": 0, "risk": 0, "duration": 0,
    "resource": 0, "uncertainty": 0, "dependency": 0
  },
  "recommendedStrategy": "DIRECT",
  "timeout": 30,
  "_raw": { "total": 0, "max": 18 }
}
```

### 示例2：代码重构

**请求**：`"重构这个项目的用户模块"`

```json
{
  "score": 57,
  "factors": {
    "logic": 2, "risk": 0, "duration": 2,
    "resource": 0, "uncertainty": 1, "dependency": 2
  },
  "recommendedStrategy": "SPAWN_SUBAGENT",
  "timeout": 120,
  "_raw": { "total": 7, "max": 18 }
}
```

### 示例3：危险操作

**请求**：`"rm -rf /var/log/*"`

```json
{
  "score": 70,
  "factors": {
    "logic": 0, "risk": 3, "duration": 1,
    "resource": 0, "uncertainty": 0, "dependency": 0
  },
  "recommendedStrategy": "SPAWN_SUBAGENT",
  "timeout": 180,
  "_raw": { "total": 4, "max": 18 }
}
```

### 示例4：巨型任务

**请求**：`"分析这个 monorepo 项目并重构核心模块，编写测试，部署到生产环境"`

```json
{
  "score": 91,
  "factors": {
    "logic": 3, "risk": 2, "duration": 3,
    "resource": 1, "uncertainty": 2, "dependency": 3
  },
  "recommendedStrategy": "MEGA_TASK",
  "timeout": 7200,
  "_raw": { "total": 14, "max": 18 }
}
```

---

## 五、故障处理与降级

| 故障场景 | 降级行为 |
|----------|----------|
| v8_scorer 服务不可达（超时/拒绝连接） | 默认返回 `score: 30, recommendedStrategy: STEP_ARCHIVE, timeout: 60`，确保任务不中断 |
| 评分计算异常 | 返回默认保守评分，同时记录错误日志 |
| context 字段缺失 | 忽略增强规则，仅基于 prompt 评分 |

---

## 六、代码位置

- 评分引擎：`/home/ai/.openclaw/v8/src/scoring/scoring.js`
- 适配器：`/home/ai/.openclaw/v8/src/scoring/adapter.js`
- 配置文件：`/home/ai/.openclaw/v8/src/scoring/config/`
- 调优模块：`rule-tuner.js`（评分规则自动调优）、`weight-learner.js`（权重自适应学习）

---

## 七、相关文档

- [[v8_classifier]] - 场景分类器（端口 3105）
- [[task_orchestrator]] - 任务编排器（整合评分+分类+路由）
- [[scene-classifier]] - workspace 版场景分类器
