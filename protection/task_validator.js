/**
 * OpenCLaw 保护层 - 任务验证与权限降级
 * v4.3 新增
 * 
 * 功能：
 * - 任务规格验证
 * - 权限降级执行
 * - 资源限制
 */

import { spawn } from 'child_process';

class TaskValidator {
  constructor(options = {}) {
    this.taskUid = parseInt(process.env.TASK_UID || '65534'); // nobody
    this.taskGid = parseInt(process.env.TASK_GID || '65534');
    this.memoryLimitMB = parseInt(process.env.TASK_MEMORY_LIMIT_MB || '2048');
    this.timeoutMs = parseInt(process.env.TASK_GLOBAL_TIMEOUT_MS || '600000');
  }

  /**
   * 验证任务规格
   */
  validate(taskSpec) {
    const errors = [];
    
    // 检查必需字段
    if (!taskSpec.cmd && !taskSpec.script) {
      errors.push('Missing cmd or script');
    }
    
    // 检查超时范围
    if (taskSpec.timeout && (taskSpec.timeout < 1000 || taskSpec.timeout > 3600000)) {
      errors.push('timeout must be between 1s and 1h');
    }
    
    // 检查内存范围
    if (taskSpec.memoryLimit && (taskSpec.memoryLimit < 64 || taskSpec.memoryLimit > 8192)) {
      errors.push('memoryLimit must be between 64MB and 8GB');
    }
    
    // 检查重试次数
    if (taskSpec.maxRetries && (taskSpec.maxRetries < 0 || taskSpec.maxRetries > 10)) {
      errors.push('maxRetries must be between 0 and 10');
    }
    
    // 检查优先级
    if (taskSpec.priority !== undefined && (taskSpec.priority < 0 || taskSpec.priority > 10)) {
      errors.push('priority must be between 0 and 10');
    }
    
    if (errors.length > 0) {
      const error = new Error(`Task validation failed: ${errors.join(', ')}`);
      error.validationErrors = errors;
      throw error;
    }
    
    return true;
  }

  /**
   * 获取生效的超时时间
   */
  getEffectiveTimeout(taskSpec) {
    return taskSpec.timeout || this.timeoutMs;
  }

  /**
   * 获取生效的内存限制
   */
  getEffectiveMemoryLimit(taskSpec) {
    return taskSpec.memoryLimit || this.memoryLimitMB;
  }

  /**
   * 生成带限制的命令包装
   */
  getLimiterWrapper() {
    const memKb = this.memoryLimitMB * 1024;
    return `ulimit -v ${memKb} && ulimit -m ${memKb} && exec "$@"`;
  }

  /**
   * 权限降级配置
   */
  getSpawnOptions(cwd = '/tmp') {
    return {
      cwd,
      // 注意：非root用户无法真正降权，这里做配置保留
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      // windows 不支持 uid/gid
      ...(process.platform !== 'win32' && {
        uid: this.taskUid,
        gid: this.taskGid
      })
    };
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      taskUid: this.taskUid,
      taskGid: this.taskGid,
      memoryLimitMB: this.memoryLimitMB,
      timeoutMs: this.timeoutMs
    };
  }
}

// 导出单例
export const taskValidator = new TaskValidator();

export default taskValidator;