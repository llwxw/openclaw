/**
 * OpenClaw 上下文注入模块
 * 
 * 功能：
 * - 将保护层的 context 模块暴露给全局
 * - 供 OpenClaw 底层调用
 * - 接收消息并触发保护层检测
 */

import { contextProtector } from './context_protector.js';

class ContextInjector {
  constructor() {
    this.initialized = false;
  }

  /**
   * 初始化上下文注入
   */
  init() {
    if (this.initialized) return;

    // 1. 暴露给全局，供底层调用
    global.openclaw = global.openclaw || {};
    
    // 获取上下文状态（供底层使用）
    global.openclaw.getContextStats = () => {
      const status = contextProtector.getStatus();
      return {
        usedTokens: status.estimatedTokens,
        limit: status.tokenLimit,
        percent: parseFloat(status.tokenRatio)
      };
    };

    // 重置计数器（保护层压缩后调用）
    global.openclaw.resetContextCounter = () => {
      console.log('[Context] 底层调用: 重置计数器');
      // 通知保护层重置
      contextProtector.lastSummarize = 0;
    };

    // 添加消息的入口
    global.openclaw.addContextMessage = (role, content, taskId = null) => {
      try {
        const result = contextProtector.onNewMessage({
          role,
          content,
          timestamp: new Date().toISOString()
        });
        return result;
      } catch (err) {
        console.warn('[Context] 添加消息失败:', err.message);
        return { error: err.message };
      }
    };

    this.initialized = true;
    console.log('[Context] 上下文注入已初始化');
    console.log('[Context] 可用接口:');
    console.log('  - global.openclaw.getContextStats()');
    console.log('  - global.openclaw.resetContextCounter()');
    console.log('  - global.openclaw.addContextMessage(role, content, taskId)');
  }

  /**
   * 手动添加消息（供测试用）
   */
  addMessage(role, content, taskId = null) {
    return global.openclaw?.addContextMessage(role, content, taskId);
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      initialized: this.initialized,
      context: contextProtector.getStatus()
    };
  }
}

// 导出单例
export const contextInjector = new ContextInjector();

export default contextInjector;