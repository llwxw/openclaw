/**
 * OpenClaw 保护层 - 并发限制与任务队列
 * 
 * 功能：
 * - 全局并发限制（最多3个任务）
 * - FIFO 任务队列
 * - 队列溢出保护
 * 
 * 配置：
 * - OPENCLAW_MAX_CONCURRENT: 最大并发数（默认3）
 * - OPENCLAW_QUEUE_MAX_SIZE: 队列最大长度（默认30）
 */

import { EventEmitter } from 'events';

class TaskQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxConcurrent = parseInt(process.env.OPENCLAW_MAX_CONCURRENT || '3');
    this.maxQueueSize = parseInt(process.env.OPENCLAW_QUEUE_MAX_SIZE || '30');
    this.queue = [];
    this.activeCount = 0;
    this.processing = false;
    this._lock = false; // 简单锁，非线程安全但能降低竞态
  }

  /**
   * 提交任务到队列
   * @param {Object} task - 任务对象 { id, spec, priority }
   * @returns {string} 任务ID
   */
  submit(task) {
    const taskId = task.id || `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    if (this.queue.length >= this.maxQueueSize) {
      const error = new Error('QUEUE_FULL');
      error.code = 429;
      error.message = `队列已满，请稍后重试。当前队列长度: ${this.queue.length}`;
      throw error;
    }

    this.queue.push({
      id: taskId,
      spec: task.spec,
      priority: task.priority || 0,
      submittedAt: new Date().toISOString(),
      status: 'queued'
    });

    this.emit('task_queued', { taskId, queueLength: this.queue.length });
    
    // 触发调度器
    this.schedule();
    
    return taskId;
  }

  /**
   * 调度执行（带锁保护）
   */
  schedule() {
    // 简单锁，防止重复调度
    if (this.processing || this._lock) return;
    if (this.activeCount >= this.maxConcurrent) return;
    if (this.queue.length === 0) return;

    this._lock = true;
    
    try {
      // 按优先级排序（高优先级在前）
      this.queue.sort((a, b) => b.priority - a.priority);
      
      const task = this.queue.shift();
      this.activeCount++;
      
      this.emit('task_started', { taskId: task.id, activeCount: this.activeCount });
      
      // 返回任务给调用者
      return task;
    } finally {
      this.processing = false;
      this._lock = false;
    }
  }

  /**
   * 任务完成
   * @param {string} taskId - 任务ID
   */
  complete(taskId) {
    this.activeCount--;
    this.emit('task_completed', { taskId, activeCount: this.activeCount });
    this.schedule(); // 触发下一个任务
  }

  /**
   * 任务失败
   * @param {string} taskId - 任务ID
   * @param {Error} error - 错误对象
   */
  fail(taskId, error) {
    this.activeCount--;
    this.emit('task_failed', { taskId, error: error.message });
    this.schedule();
  }

  /**
   * 获取队列状态
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      activeCount: this.activeCount,
      maxConcurrent: this.maxConcurrent,
      canSubmit: this.queue.length < this.maxQueueSize
    };
  }

  /**
   * 清理超时任务（5分钟）
   */
  cleanup() {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5分钟
    const initialLength = this.queue.length;
    
    this.queue = this.queue.filter(task => {
      const submittedAt = new Date(task.submittedAt).getTime();
      if (now - submittedAt > timeout) {
        this.emit('task_timeout', { taskId: task.id });
        return false;
      }
      return true;
    });

    if (this.queue.length < initialLength) {
      this.emit('cleanup', { removed: initialLength - this.queue.length });
    }
  }
}

// 导出单例
export const taskQueue = new TaskQueue();

// 后台清理线程（每60秒）
setInterval(() => {
  taskQueue.cleanup();
}, 60000);

export default taskQueue;