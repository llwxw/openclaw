---
name: session-summary
description: "session 结束时（/new 或 /reset）生成结构化摘要，写入 memory/，供下次 bootstrap 读取。依赖 context.previousSessionEntry.sessionFile 读取刚结束的 session 内容。"
metadata:
  {
    "openclaw": {
      "emoji": "📝",
      "events": ["command:new", "command:reset"],
      "requires": {
        "bins": ["node"],
        "config": ["workspace.dir"]
      },
      "always": true
    }
  }
---

# session-summary

每次 `/new` 或 `/reset` 触发时，异步生成刚结束 session 的结构化摘要。

## 行为

- **异步执行**：hook 立即返回，摘要生成在后台，不阻塞命令响应
- **降级策略**：LLM 不可用或生成失败时，写入规则摘要，不报错不中断
- **文件格式**：`memory/YYYY-MM-DD-{slug}.md`，带 `<!-- summary-only -->` 标记

## 摘要格式

```markdown
# Session: {date} {time}

<!-- summary-only -->

## 摘要
## 主题
{一句话概括，少于20字}

## AI 决策模式
{基于 scene/score/strategy 数据分析，1-3句描述}

## 关键决策
{决策列表，没有则写"无明确决策"}

## 重要发现
{发现列表，没有则写"无"}

## 待跟进
{待办列表，没有则写"无"}

<!-- source: {sessionKey} -->
```

### AI 决策模式分析

摘要 prompt 新增决策模式分析，从 ephemeral 的 v8 决策数据（scene、score、recommendedStrategy、risk factor）提炼：
- 主要场景类型（clarify/task/troubleshoot/chat/...）
- 复杂度评分分布
- 推荐策略分布（DIRECT/STEP/SUBAGENT/PARALLEL/MEGA）
- 风险意识表现
- 互动风格（主动/被动/谨慎/大胆）

## LLM 调用

通过 v8 Router (3102) 调用 LLM 生成摘要，超时 20s。

## Bootstrap 读取

session 启动时，扫描 `memory/` 下最新摘要文件（按修改时间），读入作为上下文。
