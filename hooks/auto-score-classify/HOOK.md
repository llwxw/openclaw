---
name: auto-score-classify
description: "每条消息自动调用 v8_classifier(3105) 和 v8_scorer(3103)，结果写入 session 状态文件供 agent 读取"
metadata:
  {
    "openclaw":
      {
        "emoji": "🎯",
        "events": ["message:preprocessed"],
        "requires": { "bins": ["node"], "config": [] },
        "always": true
      }
  }
---

# auto-score-classify

每条入站消息自动经过意图分类 + 复杂度评分，结果写入 session 目录。

## 结果文件

`~/.openclaw/sessions/{sessionKey}/context.json`

```json
{
  "classification": {
    "response": "[LLM响应] 基于你的输入，建议操作如下：...",
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

## 行为

- 并发调用 3105 和 3103，不阻塞
- API 不可用时静默降级，不影响消息处理
- 结果覆盖写入，每次只保留最新一条
- session 目录不存在则自动创建
