/**
 * OpenClaw 保护层 - 内存限制与 OOM 处理
 * 
 * 功能：
 * - 使用 setrlimit 限制子代理内存
 * - OOM 检测与自动重试
 * - 指数退避重试策略
 * - 连续失败冻结机制
 * 
 * 配置：
 * - OPENCLAW_MEMORY_SOFT_MB: 软限制（默认2000MB）
 * - OPENCLAW_MEMORY_HARD_MB: 硬限制（默认2500MB）
 * - OPENCLAW_MAX_RETRIES: 最大重试次数（默认3）
 */

import { spawn } from 'child_process';
import * as fs from 'fs';

class MemoryLimiter {
  constructor() {
    this.softLimitMB = parseInt(process.env.OPENCLAW_MEMORY_SOFT_MB || '2000');
    this.hardLimitMB = parseInt(process.env.OPENCLAW_MEMORY_HARD_MB || '2500');
    this.maxRetries = parseInt(process.env.OPENCLAW_MAX_RETRIES || '3');
    this.retryCount = new Map();
    this.frozenTasks = new Set();
  }

  /**
   * 内存限制函数（供 preexec_fn 使用）
   * @returns {Function} 限制函数
   */
  createLimiter() {
    const softBytes = this.softLimitMB * 1024 * 1024;
    const hardBytes = this.hardLimitMB * 1024 * 1024;

    return function() {
      try {
        // 注意：Windows 不支持 setrlimit
        // 在非 POSIX 系统上静默失败
        if (process.platform === 'win32') {
          return;
        }
        
        const { resource } = require('posix');
        
        // 限制地址空间
        resource.setrlimit(resource.RLIMIT_AS, [softBytes, hardBytes]);
        
        // 限制常驻内存（如果支持）
        try {
          resource.setrlimit(resource.RLIMIT_RSS, [softBytes, hardBytes]);
        } catch (e) {
          // RSS 可能不支持
        }
      } catch (err) {
        // 静默处理不支持的平台
      }
    };
  }

  /**
   * 生成内存限制代码片段
   * @returns {string} Bash 脚本
   */
  getLimitScript() {
    const softKb = this.softLimitMB * 1024;
    const hardKb = this.hardLimitMB * 1024;

    return `
      # 内存限制 (ulimit)
      ulimit -v ${softKb}
      ulimit -m ${softKb}
      
      # cgroup 限制 (如果可用)
      if [ -f /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then
        echo ${hardKb}000 > /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null || true
      fi
    `;
  }

  /**
   * Spawn 带内存限制的子进程
   * @param {string} command - 命令
   * @param {string[]} args - 参数
   * @param {Object} options - 选项
   * @returns {ChildProcess} 子进程
   */
  spawnWithMemoryLimit(command, args, options = {}) {
    const spawnOptions = {
      ...options,
      // 使用 shell 包装命令以应用限制
      shell: true
    };

    // 构建带限制的命令
    const limitScript = this.getLimitScript();
    const fullCommand = `${limitScript}; ${command} ${args.join(' ')}`;

    return spawn(fullCommand, [], spawnOptions);
  }

  /**
   * 检测是否 OOM
   * @param {ChildProcess} proc - 进程
   * @returns {boolean} 是否 OOM
   */
  isOOM(proc) {
    // SIGSEGV (信号 11) 通常表示内存违规
    if (proc.exitCode === null && proc.signal === 'SIGSEGV') {
      return true;
    }
    // 退出码 137 = SIGKILL (OOM 时被 kill)
    if (proc.exitCode === 137) {
      return true;
    }
    return false;
  }

  /**
   * 使用 OOM 重试执行任务
   * @param {Function} taskFn - 任务函数
   * @param {string} taskId - 任务ID
   * @returns {Promise} 执行结果
   */
  async runWithRetry(taskFn, taskId) {
    // 检查是否被冻结
    if (this.frozenTasks.has(taskId)) {
      throw new Error(`TASK_FROZEN: 任务 ${taskId} 因连续 OOM 被冻结`);
    }

    const retries = this.retryCount.get(taskId) || 0;

    for (let attempt = retries; attempt < this.maxRetries; attempt++) {
      try {
        this.retryCount.set(taskId, attempt);
        
        const result = await taskFn();
        
        // 成功后清理重试计数
        this.retryCount.delete(taskId);
        return result;
        
      } catch (error) {
        // 检测 OOM
        if (error.signal === 'SIGSEGV' || error.code === 137 || error.message?.includes('OOM')) {
          const waitTime = Math.pow(2, attempt); // 指数退避: 1s, 2s, 4s
          
          console.warn(`[内存] 任务 ${taskId} OOM (尝试 ${attempt + 1}/${this.maxRetries}), ${waitTime}s 后重试`);
          
          await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
          
          this.retryCount.set(taskId, attempt + 1);
          continue;
        }
        
        // 非 OOM 错误，直接抛出
        throw error;
      }
    }

    // 超过最大重试次数，冻结任务
    this.frozenTasks.add(taskId);
    console.error(`[内存] 任务 ${taskId} 连续 OOM ${this.maxRetries} 次，已冻结`);
    
    throw new Error(`TASK_FROZEN: 任务 ${taskId} 因连续 OOM 被冻结`);
  }

  /**
   * 检查任务是否被冻结
   * @param {string} taskId - 任务ID
   * @returns {boolean}
   */
  isFrozen(taskId) {
    return this.frozenTasks.has(taskId);
  }

  /**
   * 解冻任务
   * @param {string} taskId - 任务ID
   */
  unfreeze(taskId) {
    this.frozenTasks.delete(taskId);
    this.retryCount.delete(taskId);
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      softLimitMB: this.softLimitMB,
      hardLimitMB: this.hardLimitMB,
      maxRetries: this.maxRetries,
      activeRetries: this.retryCount.size,
      frozenTasks: Array.from(this.frozenTasks)
    };
  }
}

// 导出单例
export const memoryLimiter = new MemoryLimiter();

export default memoryLimiter;