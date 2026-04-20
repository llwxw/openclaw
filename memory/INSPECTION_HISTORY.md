
---

## [巡检摘要 第1轮] - 2026-04-18T23:28:00+08:00

### 基础状态
- gateway: 运行中 (pid=87504, 内存708MB)
- 路由层: 3101✓ 3102✓ 3103✓ 3105✓ 全部健康
- 飞书: WebSocket已连接
- openclaw-listener: 重连风暴（每30秒循环，可忽略）

### 本轮检查项数量：5
### 发现的异常：2
### 已修复：1
### 未修复（需人工）：1

---

#### 🔴 异常1：handshake timeout 风暴
- **严重程度：** 中
- **日志：**
  ```
  [ws] handshake timeout conn=... peer=127.0.0.1:X->127.0.0.1:18789 remote=127.0.0.1
  [ws] closed before connect conn=... code=1000
  ```
- **频率：** 每40秒，23:13:42起已出现18+次
- **根因：** 来源不明（非openclaw-listener，listener日志显示连接成功）
- **状态：** ⚠️ 需人工排查来源

#### ✅ 异常2：plugins.allow 未配置
- **严重程度：** 低-中（安全最佳实践）
- **日志：** `[plugins] plugins.allow is empty; openclaw-weixin: loaded without install/load-path provenance`
- **修复动作：** 在 `plugins` 节点添加 `"allow": ["openclaw-weixin"]`
- **验证：** 已写入配置文件，下轮验证

---

### 本轮关键日志（Top5）
1. `[ws] handshake timeout ... closed before connect` — 持续每40秒
2. `[plugins] plugins.allow is empty` — 安全配置缺失
3. `[ws] ⇄ res ✗ chat.history unavailable during gateway startup` — 启动时临时，已恢复
4. `[agent/embedded] session file repair skipped: invalid session header` — 损坏session，跳过
5. `[feishu] feishu[default]: WebSocket client started` — 飞书正常

### 下一轮关注项
1. 验证 plugins.allow 修复是否生效（重启gateway后）
2. 深挖 handshake timeout 来源（建议开启 gateway debug日志）
3. openclaw-listener 重连风暴是否可优化（30秒周期是否合理）

