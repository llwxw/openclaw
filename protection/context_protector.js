/**
 * OpenCLaw 保护层 - 上下文保护模块 (context_protector.js)
 * 
 * 功能：
 * - 多维度检测（消息数+字符数+Token使用率）
 * - 自动压缩（API优先，降级裁剪）
 * - 定期轮询底层检测
 * - 回滚机制
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

class ContextProtector {
  constructor(options = {}) {
    this.msgThreshold = parseInt(process.env.OPENCLAW_MSG_THRESHOLD || '50');
    this.charThreshold = parseInt(process.env.OPENCLAW_CHAR_THRESHOLD || '102400'); // 100KB
    this.tokenRatioThreshold = parseFloat(process.env.OPENCLAW_TOKEN_RATIO || '0.8');
    this.tokenLimit = parseInt(process.env.OPENCLAW_TOKEN_LIMIT || '131072'); // 128K
    this.checkIntervalMs = parseInt(process.env.OPENCLAW_CHECK_INTERVAL || '30000');
    this.cooldownSec = parseInt(process.env.OPENCLAW_COOLDOWN_SEC || '120');
    
    this.messages = [];
    this.totalChars = 0;
    this.lastSummarize = 0;
    this.backupDir = path.join(os.tmpdir(), 'openclaw', 'history_backup');
    this.periodicInterval = null; // 保存定时器ID
    this.ensureBackupDir();
    
    this.startPeriodicCheck();
  }

  ensureBackupDir() {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * 估算 token（轻量方法）
   */
  estimateTokens(text) {
    const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const other = text.length - chinese;
    return Math.ceil(chinese / 1.5 + other / 4);
  }

  /**
   * 从底层获取真实使用率
   */
  getRealContextUsage() {
    // TODO: 与 OpenClaw 底层联动
    // if (typeof openclaw !== 'undefined' && openclaw.getContextStats) {
    //   return openclaw.getContextStats();
    // }
    return null;
  }

  /**
   * 触发压缩
   */
  async autoSummarize(reason) {
    if (Date.now() - this.lastSummarize < this.cooldownSec * 1000) {
      return { skipped: true, reason: 'cooldown' };
    }

    // 备份
    await this.backupHistory();

    try {
      let summary = null;
      
      // 优先调用外部 API
      // if (typeof summarizeAPI === 'function') {
      //   summary = await summarizeAPI(this.messages.slice(0, -5));
      // }
      
      // 模拟摘要生成（实际应调用 API）
      if (!summary) {
        const recent = this.messages.slice(-10);
        summary = `[会话摘要] 共 ${this.messages.length} 条消息，关键内容: ${recent.map(m => m.content?.slice(0, 50)).join(' | ')}`;
      }

      this.messages = [
        { role: 'system', content: `[历史摘要] ${summary}` },
        ...this.messages.slice(-5)
      ];
      
      this.recalcChars();
      this.lastSummarize = Date.now();
      
      return { success: true, reason, oldCount: this.messages.length + 5, newCount: this.messages.length };
      
    } catch (err) {
      // 降级：保留最近20条 + 关键信息
      const critical = this.extractCriticalInfo();
      const kept = this.messages.slice(-20);
      kept.unshift({ role: 'system', content: `[关键信息] ${critical}` });
      this.messages = kept;
      this.recalcChars();
      this.lastSummarize = Date.now();
      
      return { fallback: true, reason, error: err.message };
    }
  }

  /**
   * 提取关键信息
   */
  extractCriticalInfo() {
    const critical = [];
    
    for (const msg of this.messages) {
      if (msg.role === 'system' && msg.content?.includes('任务')) {
        critical.push(msg.content.slice(0, 200));
      }
    }
    
    const recent = this.messages.slice(-5);
    for (const msg of recent) {
      if (msg.content?.length > 0) {
        critical.push(`[最近] ${msg.content.slice(0, 80)}`);
      }
    }
    
    return critical.join(' | ') || '无';
  }

  /**
   * 重新计算字符数
   */
  recalcChars() {
    this.totalChars = this.messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
  }

  /**
   * 备份历史
   */
  async backupHistory() {
    const backupPath = path.join(this.backupDir, `history_${Date.now()}.json`);
    try {
      fs.writeFileSync(backupPath, JSON.stringify(this.messages), 'utf8');
    } catch (err) {
      console.warn('[Context] 备份失败:', err.message);
    }
  }

  /**
   * 回滚
   */
  rollback() {
    try {
      const files = fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith('history_') && f.endsWith('.json'))
        .sort()
        .reverse();
      
      if (files.length === 0) return false;
      
      const latestBackup = path.join(this.backupDir, files[0]);
      this.messages = JSON.parse(fs.readFileSync(latestBackup, 'utf8'));
      this.recalcChars();
      return true;
    } catch (err) {
      console.warn('[Context] 回滚失败:', err.message);
      return false;
    }
  }

  /**
   * 新消息处理
   */
  onNewMessage(message) {
    this.messages.push({
      ...message,
      timestamp: message.timestamp || new Date().toISOString()
    });
    this.totalChars += message.content?.length || 0;

    // 检测是否需要压缩
    const result = this.shouldSummarize();
    if (result.should) {
      this.autoSummarize(result.reason);
    }
    
    return result;
  }

  /**
   * 判断是否需要压缩
   */
  shouldSummarize() {
    // 1. 消息条数
    if (this.messages.length >= this.msgThreshold) {
      return { should: true, reason: 'message_count' };
    }
    
    // 2. 字符数
    if (this.totalChars >= this.charThreshold) {
      return { should: true, reason: 'char_threshold' };
    }
    
    // 3. Token 估算
    const historyText = this.messages.map(m => m.content || '').join('\n');
    const estimatedTokens = this.estimateTokens(historyText);
    if (estimatedTokens / this.tokenLimit >= this.tokenRatioThreshold) {
      return { should: true, reason: 'token_estimated' };
    }
    
    // 4. 真实使用率（需底层支持）
    const real = this.getRealContextUsage();
    if (real && real.percent >= this.tokenRatioThreshold) {
      return { should: true, reason: 'token_real' };
    }
    
    return { should: false };
  }

  /**
   * 定期轮询（每30秒）
   */
  startPeriodicCheck() {
    if (this.checkIntervalMs > 0) {
      // 清理旧定时器
      if (this.periodicInterval) {
        clearInterval(this.periodicInterval);
      }
      this.periodicInterval = setInterval(() => {
        const real = this.getRealContextUsage();
        if (real && real.percent >= this.tokenRatioThreshold) {
          this.autoSummarize('periodic_poll');
        }
      }, this.checkIntervalMs);
    }
  }

  /**
   * 清理资源（定时器等）
   */
  destroy() {
    if (this.periodicInterval) {
      clearInterval(this.periodicInterval);
      this.periodicInterval = null;
    }
  }

  /**
   * 获取状态
   */
  getStatus() {
    const historyText = this.messages.map(m => m.content || '').join('\n');
    const estimatedTokens = this.estimateTokens(historyText);
    
    return {
      messageCount: this.messages.length,
      totalChars: this.totalChars,
      estimatedTokens,
      tokenRatio: (estimatedTokens / this.tokenLimit).toFixed(2),
      msgThreshold: this.msgThreshold,
      charThreshold: this.charThreshold,
      shouldSummarize: this.shouldSummarize(),
      lastSummarize: this.lastSummarize
    };
  }
}

// 导出单例
export const contextProtector = new ContextProtector();

export default contextProtector;