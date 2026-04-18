/**
 * OpenClaw 保护层 - 超时与无产出检测
 * 
 * 功能：
 * - 任务级超时控制
 * - 步骤级超时控制  
 * - 全局硬超时兜底
 * - 无产出检测（卡死判定）
 * - SIGTERM → SIGKILL 强制终止
 * 
 * 配置：
 * - OPENCLAW_DIRECT_TIMEOUT: 直接执行超时（默认30秒）
 * - OPENCLAW_STEP_TIMEOUT: 步骤超时（默认60秒）
 * - OPENCLAW_GLOBAL_TIMEOUT: 全局硬超时（默认600秒）
 * - OPENCLAW_NO_OUTPUT_TIMEOUT: 无产出超时（默认30秒）
 */

import { EventEmitter } from 'events';

class TimeoutController extends EventEmitter {
  constructor() {
    super();
    this.timers = new Map();
    this.tasks = new Map();
  }

  /**
   * 启动任务超时监控
   * @param {string} taskId - 任务ID
   * @param {number} timeoutMs - 超时毫秒数
   * @param {Object} options - 选项
   */
  startTask(taskId, timeoutMs, options = {}) {
    const globalTimeout = parseInt(process.env.OPENCLAW_GLOBAL_TIMEOUT || '600000'); // 10分钟
    const noOutputTimeout = parseInt(process.env.OPENCLAW_NO_OUTPUT_TIMEOUT || '30000'); // 30秒

    // 记录任务开始时间
    this.tasks.set(taskId, {
      startTime: Date.now(),
      lastOutputTime: Date.now(),
      timeoutMs,
      globalTimeout,
      noOutputTimeout,
      pid: options.pid,
      pgid: options.pgid,
      terminated: false
    });

    // 全局硬超时
    const globalTimer = setTimeout(() => {
      this.emit('global_timeout', { taskId, timeoutMs: globalTimeout });
      this.forceKill(taskId);
    }, globalTimeout);
    this.timers.set(`${taskId}_global`, globalTimer);

    // 无产出检测
    this.startNoOutputMonitor(taskId);

    this.emit('task_started', { taskId, timeoutMs, globalTimeout });
  }

  /**
   * 启动无产出监控
   * @param {string} taskId - 任务ID
   */
  startNoOutputMonitor(taskId) {
    const checkInterval = 5000; // 每5秒检查一次
    
    const monitor = setInterval(() => {
      const task = this.tasks.get(taskId);
      if (!task || task.terminated) {
        clearInterval(monitor);
        return;
      }

      const now = Date.now();
      const timeSinceLastOutput = now - task.lastOutputTime;
      const elapsed = now - task.startTime;
      
      // 预估时间 × 3 且 超过30秒无产出 = 卡死
      const estimatedTime = task.timeoutMs || 30000;
      const threshold = Math.max(estimatedTime * 3, 30000);

      if (elapsed > threshold && timeSinceLastOutput > task.noOutputTimeout) {
        this.emit('no_output_detected', { 
          taskId, 
          elapsed, 
          noOutputTime: timeSinceLastOutput,
          threshold 
        });
        
        // 发送 SIGINFO 打印堆栈
        this.sendSignal(taskId, 'SIGINFO');
        
        // 再等30秒
        setTimeout(() => {
          const currentTask = this.tasks.get(taskId);
          if (currentTask && !currentTask.terminated) {
            const afterWait = Date.now() - currentTask.lastOutputTime;
            if (afterWait > 20000) {
              this.emit('stuck_confirmed', { taskId });
              this.forceKill(taskId);
            }
          }
        }, 30000);
        
        clearInterval(monitor);
      }
    }, checkInterval);

    this.timers.set(`${taskId}_nooutput`, monitor);
  }

  /**
   * 更新最后输出时间
   * @param {string} taskId - 任务ID
   */
  updateOutput(taskId) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.lastOutputTime = Date.now();
    }
  }

  /**
   * 步骤超时启动
   * @param {string} stepId - 步骤ID
   * @param {number} timeoutMs - 超时毫秒数
   * @param {Function} onTimeout - 超时回调
   */
  startStep(stepId, timeoutMs, onTimeout) {
    const stepTimeout = parseInt(process.env.OPENCLAW_STEP_TIMEOUT || '60000');
    const effectiveTimeout = Math.min(timeoutMs, stepTimeout);

    const timer = setTimeout(() => {
      this.emit('step_timeout', { stepId, timeoutMs: effectiveTimeout });
      if (onTimeout) onTimeout();
    }, effectiveTimeout);

    this.timers.set(`step_${stepId}`, timer);
  }

  /**
   * 取消步骤超时
   * @param {string} stepId - 步骤ID
   */
  cancelStep(stepId) {
    const timer = this.timers.get(`step_${stepId}`);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(`step_${stepId}`);
    }
  }

  /**
   * 发送信号
   * @param {string} taskId - 任务ID
   * @param {string} signal - 信号名
   */
  sendSignal(taskId, signal) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    try {
      const sig = signal === 'SIGINFO' ? 'SIGUSR1' : signal; // SIGINFO 可能不支持
      
      if (task.pgid) {
        process.kill(-task.pgid, sig);
      } else if (task.pid) {
        process.kill(task.pid, sig);
      }
      
      this.emit('signal_sent', { taskId, signal });
    } catch (error) {
      this.emit('signal_error', { taskId, signal, error: error.message });
    }
  }

  /**
   * 强制终止任务
   * @param {string} taskId - 任务ID
   */
  forceKill(taskId) {
    const task = this.tasks.get(taskId);
    if (!task || task.terminated) return;
    
    task.terminated = true;
    this.emit('force_kill_start', { taskId });

    // 先 SIGTERM
    this.sendSignal(taskId, 'SIGTERM');

    // 等待5秒
    setTimeout(() => {
      const currentTask = this.tasks.get(taskId);
      if (currentTask && !currentTask.terminated) {
        // 再 SIGKILL
        this.sendSignal(taskId, 'SIGKILL');
        this.emit('force_kill', { taskId });
      }
    }, 5000);
  }

  /**
   * 任务完成，清理
   * @param {string} taskId - 任务ID
   */
  complete(taskId) {
    this.clearTask(taskId);
    this.emit('task_completed', { taskId });
  }

  /**
   * 清理任务所有定时器
   * @param {string} taskId - 任务ID
   */
  clearTask(taskId) {
    const timersToDelete = [];
    for (const key of this.timers.keys()) {
      if (key.startsWith(taskId) || key.startsWith(`step_${taskId}`)) {
        timersToDelete.push(key);
      }
    }
    
    timersToDelete.forEach(key => {
      const timer = this.timers.get(key);
      if (timer) clearTimeout(timer);
      this.timers.delete(key);
    });

    this.tasks.delete(taskId);
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      activeTasks: this.tasks.size,
      activeTimers: this.timers.size,
      tasks: Array.from(this.tasks.keys())
    };
  }
}

// 导出单例
export const timeoutController = new TimeoutController();

export default timeoutController;