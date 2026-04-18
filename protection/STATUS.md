# OpenClaw 保护层 v5 最终状态

## 版本历史
- v4.0: 基础框架
- v4.1: 增加伪代码实现指南  
- v4.2: 增加上下文保护、日志、健康检查
- v4.3: 新增安全网关、任务验证
- v5:   新增4维评分系统、负载降级、用户覆盖

## 当前版本: v5

## 文件统计
- 总文件数: 18个
- 总代码行数: 3185行

## 模块清单

| # | 模块 | 功能 | 版本 |
|---|------|------|------|
| 1 | index.js | 主入口 | v5 |
| 2 | task_scorer.js | 4维评分+路由决策 | v5 新增 |
| 3 | limiter.js | 并发限制+队列 | v4 |
| 4 | timeout.js | 超时+无产出检测 | v4 |
| 5 | truncation.js | 输出截断存储 | v4 |
| 6 | memory.js | 内存限制+OOM | v4 |
| 7 | checkpoint.js | 检查点+恢复 | v4 |
| 8 | summarize.js | 会话压缩 | v4 |
| 9 | context_protector.js | 多维度上下文 | v4 |
| 10 | context_inject.js | 上下文注入 | v4.3 |
| 11 | context_server.js | HTTP服务(18790) | v4.3 |
| 12 | queue_processor.js | 消息队列处理 | v4.3 |
| 13 | circuit_breaker.js | 熔断+限流 | v4 |
| 14 | logger.js | 结构化日志 | v4 |
| 15 | health_checker.js | 健康检查 | v4 |
| 16 | security_gate.js | 安全网关 | v4.3 |
| 17 | task_validator.js | 任务验证 | v4.3 |
| 18 | loader.js | 加载器 | v4 |

## v5 评分系统

### 4维评分
- logic: 逻辑复杂度 (0-3)
- risk: 风险度 (0-3)  
- duration: 预估时长 (0-3)
- resource: 资源消耗 (0-3)

### 路由模式
- 0-2分: DIRECT (直接执行, 30秒超时)
- 3-5分: STEP_ARCHIVE (拆步骤+检查点, 60秒/步)
- 6-8分: SPAWN_SUBAGENT (子代理, 10分钟超时)
- 9-12分: MULTI_SUBAGENT (多子代理并行)

### 负载降级
- CPU > 80% 或 内存 > 80% → 自动降一级

## 上下文接入

- Hook: ~/.openclaw/hooks/on-message.sh → HTTP → 保护层
- HTTP服务: http://127.0.0.1:18790
- 消息队列: /tmp/openclaw/msg_queue/

## 配置
- 飞书连接: webhook模式
- Gateway: 运行中

---
*最后更新: 2026-04-05*