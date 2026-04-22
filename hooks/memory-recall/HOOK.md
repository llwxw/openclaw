---
name: memory-recall
description: "主动回忆之前的学习，在 bootstrap 时注入 Memory Recall + Active Memory + Self-Improving 上下文"
metadata:
  {
    "openclaw":
      {
        "emoji": "🧠",
        "events": ["agent:bootstrap"],
        "requires": { "bins": ["node"], "config": [] },
        "always": true
      }
  }
---

# memory-recall Hook

在 AI bootstrap 时注入完整记忆上下文。

## 功能

- **Memory Recall**: 最近 24 小时任务摘要
- **Active Memory**: 重要实体和用户偏好
- **Self-Improving**: 历史错误和纠正
- **QMD**: 记忆搜索能力

## 注入内容

```
=== MEMORY SYSTEM ===

## Memory Recall
[最近任务]

## Active Memory
[重要实体]

## Self-Improving
[历史学习]

## QMD
[搜索能力]

=== END MEMORY ===
```

## 配置

无需配置，已通过 openclaw.json 启用。
