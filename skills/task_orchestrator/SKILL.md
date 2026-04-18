# Task Orchestrator 技能

> 全自动任务编排：评分路由 + 上下文保护 + 子代理进度上报

## 功能

- **评分路由**: 根据任务复杂度自动选择执行模式 (DIRECT / STEP_ARCHIVE / SPAWN_SUBAGENT / MEGA_TASK)
- **上下文保护**: 自动压缩会话历史，避免上下文溢出
- **子代理进度**: 实时上报子代理执行进度

## 执行模式

| 分数 | 模式 | 超时 |
|------|------|------|
| ≤20 | DIRECT | 30s |
| 21-40 | STEP_ARCHIVE | 60s |
| 41-60 | SPAWN_SUBAGENT | 60-180s |
| 61-80 | PARALLEL_SHARDS | 120-160s |
| >80 | MEGA_TASK | 7200s |

## 评分因子

- 指令数量
- 代码行数
- 依赖复杂度
- CPU/IO/网络 强度
- 预估执行时间