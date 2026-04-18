/**
 * OpenCLaw 保护层 - 结构化日志
 * 
 * 功能：
 * - JSON Lines 格式输出
 * - 事件分类
 * - 限速保护
 * - 轮转日志
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

class Logger {
  constructor(options = {}) {
    this.logDir = options.logDir || '/var/log/openclaw';
    this.maxFileSize = options.maxFileSize || 100 * 1024 * 1024; // 100MB
    this.maxFiles = options.maxFiles || 10;
    this.rateLimit = options.rateLimit || 100; // 每秒最多100条
    this.logFile = 'events.log';
    
    this.count = 0;
    this.lastReset = Date.now();
    this.ensureDir();
  }

  ensureDir() {
    if (!fs.existsSync(this.logDir)) {
      try {
        fs.mkdirSync(this.logDir, { recursive: true });
      } catch (err) {
        // 回退到临时目录
        this.logDir = path.join(os.tmpdir(), 'openclaw', 'logs');
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    }
  }

  /**
   * 限速检查
   */
  checkRateLimit() {
    const now = Date.now();
    if (now - this.lastReset >= 1000) {
      this.count = 0;
      this.lastReset = now;
    }
    return this.count < this.rateLimit;
  }

  /**
   * 写入日志
   */
  write(event, meta = {}) {
    if (!this.checkRateLimit()) {
      return false; // 限流丢弃
    }

    const entry = {
      timestamp: new Date().toISOString(),
      event,
      ...meta
    };

    const filepath = path.join(this.logDir, this.logFile);
    
    try {
      fs.appendFileSync(filepath, JSON.stringify(entry) + '\n', 'utf8');
      this.count++;
      return true;
    } catch (err) {
      console.warn('[Logger] 写入失败:', err.message);
      return false;
    }
  }

  /**
   * 便捷方法
   */
  taskStart(taskId, score, route) {
    return this.write('task_start', { taskId, score, route });
  }

  taskProgress(taskId, step, elapsed) {
    return this.write('task_progress', { taskId, step, elapsed });
  }

  taskTimeout(taskId, timeoutSec) {
    return this.write('task_timeout', { taskId, timeoutSec });
  }

  taskOom(taskId, memLimit) {
    return this.write('task_oom', { taskId, memLimit });
  }

  taskEnd(taskId, status, duration) {
    return this.write('task_end', { taskId, status, duration });
  }

  autoSummarize(beforeCount, afterCount, reason) {
    return this.write('auto_summarize', { beforeCount, afterCount, reason });
  }

  outputTruncated(taskId, savedTo) {
    return this.write('output_truncated', { taskId, savedTo });
  }

  circuitOpen(name) {
    return this.write('circuit_open', { name });
  }

  error(type, message, details = {}) {
    return this.write('error', { type, message, ...details });
  }

  /**
   * 获取日志状态
   */
  getStatus() {
    const filepath = path.join(this.logDir, this.logFile);
    let size = 0;
    let exists = false;
    
    try {
      if (fs.existsSync(filepath)) {
        const stats = fs.statSync(filepath);
        size = stats.size;
        exists = true;
      }
    } catch (err) {}
    
    return {
      logDir: this.logDir,
      logFile: this.logFile,
      exists,
      sizeKB: Math.round(size / 1024),
      maxSizeKB: Math.round(this.maxFileSize / 1024),
      rateLimit: this.rateLimit,
      currentCount: this.count
    };
  }
}

// 导出单例
export const logger = new Logger();

export default logger;