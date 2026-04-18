---
name: auto-router
description: "在 auto-score-classify 注入 [AUTO_ROUTE] 后，触发 sessions_spawn 派发子 agent。依赖 ephemeral 评分结果（score >= 40）。"
metadata:
  {
    "openclaw": {
      "emoji": "🔀",
      "events": ["message:preprocessed"],
      "requires": {"bins": ["node"]},
      "always": true
    }
  }
---
