/**
 * OpenCLaw 保护层 - 会话自动压缩
 * 
 * 功能：
 * - 消息数阈值自动触发 summarize
 * - API 优先，降级裁剪
 * - 保留关键信息
 * - 回滚机制
 * - 备份恢复
 * 
 * 配置：
 * - OPENCLAW_SUMMARIZE_THRESHOLD: 触发阈值（默认50条）
 * - OPENCLAW_SUMMARIZE_RESERVE: 保留最近消息数（默认5条）
 * - OPENCLAW_AUTO_SUMMARIZE: 是否自动执行（默认true）
 * - OPENCLAW_SUMMARIZE_COOLDOWN: 冷却时间（默认120秒）
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

class SessionSummarizer {
  constructor() {
    this.threshold = parseInt(process.env.OPENCLAW_SUMMARIZE_THRESHOLD || '50');
    this.reserveCount = parseInt(process.env.OPENCLAW_SUMMARIZE_RESERVE || '5');
    this.autoSummarize = process.env.OPENCLAW_AUTO_SUMMARIZE !== 'false';
    this.cooldown = parseInt(process.env.OPENCLAW_SUMMARIZE_COOLDOWN || '120000');
    
    this.messageHistory = [];
    this.lastSummarizeTime = 0;
    this.backupDir = path.join(os.tmpdir(), 'openclaw', 'history_backup');
    this.ensureBackupDir();
  }

  /**
   * 确保备份目录存在
   */
  ensureBackupDir() {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * 添加消息
   * @param {Object} message - 消息对象 { role, content, timestamp }
   */
  addMessage(message) {
    this.messageHistory.push({
      ...message,
      timestamp: message.timestamp || new Date().toISOString()
    });

    // 检查是否需要 summarize
    if (this.autoSummarize && this.shouldSummarize()) {
      this.summarize();
    }
  }

  /**
   * 判断是否应该触发 summarize
   * @returns {boolean}
   */
  shouldSummarize() {
    if (this.messageHistory.length < this.threshold) {
      return false;
    }

    const now = Date.now();
    if (now - this.lastSummarizeTime < this.cooldown) {
      return false;
    }

    return true;
  }

  /**
   * 备份历史
   */
  backupHistory() {
    const backupPath = path.join(this.backupDir, `history_${Date.now()}.json`);
    try {
      fs.writeFileSync(backupPath, JSON.stringify(this.messageHistory, null, 2), 'utf8');
      return backupPath;
    } catch (err) {
      console.warn('[Summarize] 备份失败:', err.message);
      return null;
    }
  }

  /**
   * 提取关键信息
   * @returns {string} 关键信息摘要
   */
  extractCriticalInfo() {
    const critical = [];
    
    // 提取任务信息
    for (const msg of this.messageHistory) {
      if (msg.role === 'system' && msg.content?.includes('任务')) {
        critical.push(msg.content.slice(0, 200));
      }
    }
    
    // 提取最后几个任务的最后状态
    const recent = this.messageHistory.slice(-10);
    for (const msg of recent) {
      if (msg.role === 'assistant' && msg.content?.length > 0) {
        critical.push(`[最近回复片段] ${msg.content.slice(0, 100)}`);
      }
    }
    
    return critical.join('\n') || '无关键信息';
  }

  /**
   * 执行自动压缩
   */
  summarize() {
    const now = Date.now();
    
    // 备份当前历史
    const backupPath = this.backupHistory();
    
    try {
      // 尝试调用外部 summarize API
      // 注意：这里需要根据实际情况实现
      const summary = this.callSummarizeAPI(this.messageHistory.slice(0, -this.reserveCount));
      
      if (summary) {
        // 成功：替换为摘要 + 保留最近消息
        this.messageHistory = [
          {
            role: 'system',
            content: `【历史摘要】${summary}`,
            timestamp: new Date().toISOString()
          },
          ...this.messageHistory.slice(-this.reserveCount)
        ];
        
        this.lastSummarizeTime = now;
        console.log(`[Summarize] 自动压缩成功: ${this.messageHistory.length} 条消息`);
        return;
      }
    } catch (err) {
      console.warn('[Summarize] API 调用失败:', err.message);
    }

    // 降级：简单裁剪
    this.fallbackCompress();
  }

  /**
   * 调用外部 Summarize API（需要根据实际情况实现）
   * @param {Array} messages - 消息数组
   * @returns {string|null} 摘要
   */
  callSummarizeAPI(messages) {
    // TODO: 实现实际的 API 调用
    // 这里返回 null 表示使用降级方案
    return null;
  }

  /**
   * 降级压缩方案
   */
  fallbackCompress() {
    const critical = this.extractCriticalInfo();
    const kept = this.messageHistory.slice(-20);
    
    this.messageHistory = [
      {
        role: 'system',
        content: `【关键信息】${critical.slice(0, 500)}`,
        timestamp: new Date().toISOString()
      },
      ...kept
    ];
    
    this.lastSummarizeTime = Date.now();
    console.log(`[Summarize] 降级压缩完成: ${this.messageHistory.length} 条消息`);
  }

  /**
   * 回滚到上一次压缩前
   * @returns {boolean} 是否成功
   */
  rollback() {
    try {
      const files = fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith('history_') && f.endsWith('.json'))
        .sort()
        .reverse();
      
      if (files.length === 0) {
        return false;
      }
      
      const latestBackup = path.join(this.backupDir, files[0]);
      const history = JSON.parse(fs.readFileSync(latestBackup, 'utf8'));
      
      this.messageHistory = history;
      console.log('[Summarize] 已回滚到最近一次压缩前');
      return true;
    } catch (err) {
      console.warn('[Summarize] 回滚失败:', err.message);
      return false;
    }
  }

  /**
   * 获取历史消息
   * @returns {Array}
   */
  getHistory() {
    return [...this.messageHistory];
  }

  /**
   * 清空历史
   */
  clear() {
    this.messageHistory = [];
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      messageCount: this.messageHistory.length,
      threshold: this.threshold,
      shouldSummarize: this.shouldSummarize(),
      lastSummarizeTime: this.lastSummarizeTime,
      autoSummarize: this.autoSummarize
    };
  }
}

// 导出单例
export const sessionSummarizer = new SessionSummarizer();

export default sessionSummarizer;