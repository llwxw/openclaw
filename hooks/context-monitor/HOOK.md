---
name: context-monitor
description: "监控 session context 大小，超过阈值时触发自动压缩。依赖 context.maxContextTokens 和 summarizeThreshold 配置。"
metadata:
  {
    "openclaw": {
      "emoji": "🧠",
      "events": ["message:preprocessed", "agent:response"],
      "requires": {"bins": ["node"], "config": ["context"]},
      "always": true
    }
  }
---
