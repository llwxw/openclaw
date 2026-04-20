---
name: self-improvement
description: "自动捕获错误和纠正，写入 .learnings/CORRECTIONS.md。检测 AI 回复中的否定/纠正模式，简单记录供后续分析。"
metadata:
  {
    "openclaw": {
      "emoji": "🛠️",
      "events": ["agent:response"],
      "requires": {"bins": ["node"], "config": []},
      "always": false
    }
  }
---

# self-improvement

自动捕获 AI 回复中的错误/纠正，写入 `.learnings/CORRECTIONS.md`。

## 触发条件

检测以下模式：
- `不对|不是这样|错了|incorrect|wrong|that's wrong`
- `实际上|actually|事实上`
- `等等|wait|hold on`

## 输出

`~/.openclaw/workspace/.learnings/CORRECTIONS.md`

详细分析由 `session-summary` hook 的 LLM 摘要处理。
