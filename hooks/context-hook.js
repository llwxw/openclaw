/**
 * Context Hook for OpenClaw
 * 
 * 监听消息事件，自动调用保护层context模块
 * 
 * 支持的事件:
 * - message:receive: 用户发送消息
 * - message:send: AI 发送消息
 * - agent:response: Agent 回复
 */

const handler = async (event) => {
  try {
    // 检查是否有全局上下文接口
    if (!global.openclaw || !global.openclaw.addContextMessage) {
      // 尝试加载保护层
      try {
        const protection = await import(process.env.HOME + '/.openclaw/protection/index.js');
        await protection.default.init();
      } catch (e) {
        console.log('[ContextHook] 保护层未加载，跳过');
        return;
      }
    }

    // 处理用户消息
    if (event.type === 'message' || event.type === 'message:receive') {
      const content = event.message?.content || event.content || '';
      if (content) {
        global.openclaw?.addContextMessage('user', content, event.taskId);
        console.log('[ContextHook] 用户消息已记录:', content.slice(0, 30));
      }
    }

    // 处理 Agent 回复
    if (event.type === 'message:send' || event.type === 'agent:response') {
      const content = event.response?.content || event.content || '';
      if (content) {
        global.openclaw?.addContextMessage('assistant', content, event.taskId);
        console.log('[ContextHook] AI回复已记录:', content.slice(0, 30));
      }
    }

  } catch (error) {
    console.error('[ContextHook] 错误:', error.message);
  }
};

module.exports = handler;
module.exports.default = handler;