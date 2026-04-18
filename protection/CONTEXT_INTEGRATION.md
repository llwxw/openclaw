# OpenClaw 上下文保护接入指南

## 当前状态

保护层 context_protector 已实现，但**未接入消息流程**。

## 问题

- 保护层消息数始终为 0
- 底层 memory-flush 在 ≥95% 时才触发（已太晚）

## 需要接入的位置

根据源码分析，找到以下入口点：

### 1. 消息入口（用户发送消息）
- 文件: `session-Db9ql_Z9.js`
- 函数: `addRecentMessage()` (行 86542)

### 2. AI 回复入口
- 文件: `agent-runner.runtime`
- 函数: 在返回 response 时触发

### 3. 底层 memory-flush 入口
- 文件: `agent-runner.runtime-C-sR1PRP.js`
- 函数: `compactEmbeddedPiSession()` (行 852)

## 接入方案

### 方案A: 创建 Hook 集成（推荐）

创建 `~/.openclaw/hooks/context-inject.js`，在 OpenClaw 启动时加载。

### 方案B: 修改配置触发

在 `openclaw.json` 中配置相关选项。

### 方案C: 直接源码修改

找到 npm 包源码位置进行修改（不推荐，会被覆盖）

---

## 具体接入步骤

### 步骤1: 创建上下文注入模块

在 `~/.openclaw/protection/` 创建 `context_inject.js`:

```javascript
// 上下文注入模块
import { contextProtector } from './context_protector.js';

export function initContextInjection() {
  // 1. 注入到全局，供底层调用
  global.openclaw = global.openclaw || {};
  global.openclaw.getContextStats = () => contextProtector.getStatus();
  global.openclaw.resetContextCounter = () => {
    // 重置计数器
    contextProtector.messages = [];
    contextProtector.totalChars = 0;
    contextProtector.totalTokens = 0;
    console.log('[Context] Counter reset by底层');
  };
  
  // 2. 暴露添加消息的方法
  global.openclaw.addContextMessage = (role, content, taskId = null) => {
    contextProtector.addMessage({ role, content, timestamp: new Date().toISOString() }, taskId);
  };
  
  console.log('[Context] 上下文注入已初始化');
}
```

### 步骤2: 在保护层初始化时调用

在 `index.js` 的 `init()` 方法中添加:

```javascript
import { initContextInjection } from './context_inject.js';

// 在 init() 中添加
initContextInjection();
```

### 步骤3: 让 OpenClaw 调用保护层

这是最复杂的部分。需要在 OpenClaw 的消息处理流程中添加调用。

**选项1**: 修改 OpenClaw 配置或 hooks
**选项2**: 使用 OpenClaw 的插件系统（如果有）
**选项3**: 手动在每次对话时调用保护层

## 快速验证

当前可以手动调用保护层：

```javascript
// 在收到用户消息后
global.openclaw?.addContextMessage('user', '消息内容');

// 在 AI 回复后  
global.openclaw?.addContextMessage('assistant', '回复内容');
```

## 待完成

- [ ] 找到更简单的方式接入
- [ ] 测试手动调用是否生效
- [ ] 确认长期记忆存储对接

---

*创建时间: 2026-04-05*