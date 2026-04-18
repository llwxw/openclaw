/**
 * OpenCLaw 保护层 - 健康检查与自愈
 * 
 * 功能：
 * - 健康状态查询
 * - 主循环心跳
 * - 资源监控
 * - 自动恢复建议
 */

class HealthChecker {
  constructor(options = {}) {
    this.checkIntervalMs = options.checkIntervalMs || 10000; // 10秒
    this.lastHeartbeat = Date.now();
    this.startTime = Date.now();
    this.periodicInterval = null;
    this.listeners = new Set();
    
    this.startMonitoring();
  }

  /**
   * 更新心跳
   */
  updateHeartbeat() {
    this.lastHeartbeat = Date.now();
  }

  /**
   * 检查主循环是否响应
   */
  isMainLoopResponsive() {
    const now = Date.now();
    const threshold = 15000; // 15秒
    return (now - this.lastHeartbeat) < threshold;
  }

  /**
   * 获取健康状态
   */
  getHealth(protectionStatus = {}) {
    const now = Date.now();
    const uptime = now - this.startTime;
    
    // 基础状态
    let healthy = true;
    let issues = [];

    // 1. 检查主循环
    if (!this.isMainLoopResponsive()) {
      healthy = false;
      issues.push({ type: 'main_loop_stuck', severity: 'critical' });
    }

    // 2. 检查队列积压
    if (protectionStatus.limiter?.queueLength > 20) {
      issues.push({ type: 'queue_backlog', severity: 'warning', value: protectionStatus.limiter.queueLength });
    }

    // 3. 检查并发
    if (protectionStatus.limiter?.activeCount >= protectionStatus.limiter?.maxConcurrent) {
      issues.push({ type: 'max_concurrency', severity: 'info' });
    }

    // 4. 检查内存
    if (protectionStatus.memory?.activeRetries > 0) {
      issues.push({ type: 'memory_retries', severity: 'warning', value: protectionStatus.memory.activeRetries });
    }

    // 5. 检查冻结任务
    if (protectionStatus.memory?.frozenTasks?.length > 0) {
      issues.push({ type: 'frozen_tasks', severity: 'error', value: protectionStatus.memory.frozenTasks });
    }

    // 6. 检查上下文
    if (protectionStatus.context?.shouldSummarize?.should) {
      issues.push({ type: 'context_threshold', severity: 'warning' });
    }

    // 汇总
    if (issues.some(i => i.severity === 'critical' || i.severity === 'error')) {
      healthy = false;
    }

    return {
      healthy,
      status: healthy ? 'ok' : 'degraded',
      uptime: Math.round(uptime / 1000),
      lastHeartbeat: this.lastHeartbeat,
      mainLoopResponsive: this.isMainLoopResponsive(),
      issues,
      checks: {
        queue: protectionStatus.limiter || {},
        timeout: protectionStatus.timeout || {},
        memory: protectionStatus.memory || {},
        context: protectionStatus.context || {},
        rateLimiter: protectionStatus.rateLimiter || {}
      }
    };
  }

  /**
   * 健康检查回调
   */
  onHealthCheck(callback) {
    this.listeners.add(callback);
  }

  /**
   * 移除回调
   */
  offHealthCheck(callback) {
    this.listeners.delete(callback);
  }

  /**
   * 启动监控
   */
  startMonitoring() {
    if (this.checkIntervalMs > 0) {
      this.periodicInterval = setInterval(() => {
        const health = this.getHealth();
        
        // 触发回调
        for (const callback of this.listeners) {
          try {
            callback(health);
          } catch (err) {
            console.warn('[Health] 回调错误:', err.message);
          }
        }

        // 如果不健康，打印警告
        if (!health.healthy) {
          console.warn('[Health] 健康检查失败:', JSON.stringify(health.issues));
        }
      }, this.checkIntervalMs);
    }
  }

  /**
   * 停止监控
   */
  stop() {
    if (this.periodicInterval) {
      clearInterval(this.periodicInterval);
      this.periodicInterval = null;
    }
  }

  /**
   * 主动触发自愈
   */
  triggerRecovery(protection) {
    const issues = this.getHealth(protection?.getStatus?.() || {}).issues;
    const actions = [];

    for (const issue of issues) {
      switch (issue.type) {
        case 'queue_backlog':
          actions.push('建议: 增加并发数或清理积压任务');
          break;
        case 'frozen_tasks':
          actions.push('建议: 手动解冻任务或检查OOM原因');
          break;
        case 'context_threshold':
          actions.push('建议: 手动触发压缩或清理历史');
          break;
        default:
          actions.push(`建议: 检查 ${issue.type} 问题`);
      }
    }

    return {
      detected: issues.length,
      actions,
      timestamp: new Date().toISOString()
    };
  }
}

// 导出单例
export const healthChecker = new HealthChecker();

export default healthChecker;