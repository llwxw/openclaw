/**
 * OpenCLaw 保护层 - 主入口 (v4.3)
 * 
 * 整合所有保护模块，提供统一的 API
 * 
 * 模块：
 * - limiter: 并发限制 + 队列
 * - timeout: 超时 + 无产出检测
 * - truncation: 输出截断存储
 * - memory: 内存限制 + OOM 处理
 * - checkpoint: 检查点 + 恢复
 * - summarize: 会话自动压缩
 * - context_protector: 多维度上下文保护
 * - circuit_breaker: 熔断器与限流
 * - security_gate: 安全网关（命令白名单、路径沙箱、限流）
 * - task_validator: 任务验证与权限降级
 * - logger: 结构化日志
 * - health_checker: 健康检查
 * 
 * 使用方式：
 * import protection from './protection/index.js';
 * 
 * // 初始化
 * await protection.init();
 * 
 * // 提交任务（自动安全验证）
 * const taskId = protection.submitTask({ spec: myTask });
 * 
 * // 执行带保护的任务
 * await protection.runProtected(taskId, async () => {
 *   // 你的任务逻辑
 * });
 */

import { taskQueue } from './limiter.js';
import limiter from './limiter.js';
import { timeoutController } from './timeout.js';
import { outputTruncation } from './truncation.js';
import { memoryLimiter } from './memory.js';
import { checkpointManager } from './checkpoint.js';
import { sessionSummarizer } from './summarize.js';
import { contextProtector } from './context_protector.js';
import { CircuitBreaker, RateLimiter } from './circuit_breaker.js';
import { logger } from './logger.js';
import { healthChecker } from './health_checker.js';
import { securityGate } from './security_gate.js';
import { taskValidator } from './task_validator.js';
import { contextInjector } from './context_inject.js';
import { taskScorer } from './task_scorer.js';

class ProtectionLayer {
  constructor() {
    this.limiter = limiter;
    this.timeout = timeoutController;
    this.truncation = outputTruncation;
    this.memory = memoryLimiter;
    this.checkpoint = checkpointManager;
    this.summarizer = sessionSummarizer;
    this.context = contextProtector;
    this.logger = logger;
    this.health = healthChecker;
    this.security = securityGate;
    this.validator = taskValidator;
    this.contextInjector = contextInjector;
    this.scorer = taskScorer;
    
    // 熔断器集合
    this.circuitBreakers = new Map();
    
    // 全局限流器
    this.rateLimiter = new RateLimiter(2, 10);
    
    this.initialized = false;
  }

  /**
   * 初始化
   */
  async init() {
    if (this.initialized) return this;
    
    // 初始化上下文注入
    this.contextInjector.init();
    
    // 启动消息队列处理器
    try {
      const { processQueue } = await import('./queue_processor.js');
      processQueue();
      console.log('[Protection] 消息队列处理器已启动');
    } catch (e) {
      console.log('[Protection] 队列处理器启动失败:', e.message);
    }

    // 启动 Context HTTP 服务器
    try {
      const { default: server } = await import('./context_server.js');
      console.log('[Protection] Context HTTP 服务器已启动: http://127.0.0.1:18790');
    } catch (e) {
      console.log('[Protection] HTTP 服务器启动失败:', e.message);
    }
    
    console.log('[Protection] 初始化保护层 v4.2...');
    
    // 确保输出目录存在
    const outputDir = process.env.OPENCLAW_OUTPUT_DIR || '/tmp/openclaw';
    const checkpointDir = process.env.OPENCLAW_CHECKPOINT_DIR || '/tmp/openclaw/checkpoints';
    
    try {
      const fs = await import('fs');
      [outputDir, checkpointDir].forEach(dir => {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      });
    } catch (err) {
      console.warn('[Protection] 目录创建失败:', err.message);
    }
    
    this.initialized = true;
    console.log('[Protection] 保护层初始化完成');
    
    return this;
  }

  /**
   * 提交受保护的任务
   */
  submitTask(taskSpec) {
    // 检查限流
    if (!this.rateLimiter.acquire()) {
      const err = new Error('RATE_LIMITED');
      err.code = 429;
      throw err;
    }
    
    return this.limiter.submit({
      id: taskSpec.id,
      spec: taskSpec,
      priority: taskSpec.priority || 0
    });
  }

  /**
   * 运行受保护的任务
   */
  async runProtected(taskId, taskFn, options = {}) {
    const {
      timeoutMs = 60000,
      enableCheckpoint = false,
      enableMemoryLimit = true,
      enableOutputTruncation = true,
      stepExtractor = null
    } = options;

    // 启动超时监控
    this.timeout.startTask(taskId, timeoutMs, options);

    try {
      let result;

      if (enableCheckpoint && stepExtractor) {
        result = await this.checkpoint.resume(
          { id: taskId, steps: stepExtractor() },
          async (task, startStep) => {
            const steps = task.steps;
            for (let i = startStep; i < steps.length; i++) {
              await taskFn(steps[i], i);
              this.checkpoint.saveCheckpoint(taskId, {
                status: 'running',
                lastCompletedStep: i,
                totalSteps: steps.length
              });
            }
            return { completed: true, stepsCompleted: steps.length };
          }
        );
      } else {
        result = await taskFn();
      }

      this.timeout.complete(taskId);
      this.limiter.complete(taskId);
      
      if (enableCheckpoint) {
        this.checkpoint.deleteCheckpoint(taskId);
      }

      return result;

    } catch (error) {
      this.limiter.fail(taskId, error);
      throw error;
    }
  }

  /**
   * Spawn 带保护的子代理
   */
  async spawnSubagent(config) {
    const {
      task,
      runtime = 'subagent',
      timeoutSeconds = 300,
      enableMemoryLimit = true
    } = config;

    const taskId = `subagent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const queuedTaskId = this.limiter.submit({
      id: taskId,
      spec: config
    });

    return new Promise((resolve, reject) => {
      this.timeout.startTask(taskId, timeoutSeconds * 1000);

      setImmediate(async () => {
        try {
          // TODO: 实际调用 spawn
          // const spawnFn = global.openclaw_spawn || (() => { throw new Error('not configured'); });
          // const result = await spawnFn({ task, runtime, timeoutSeconds });
          
          // 模拟
          const result = { taskId, status: 'simulated' };
          
          this.timeout.complete(taskId);
          this.limiter.complete(taskId);
          resolve(result);

        } catch (error) {
          this.limiter.fail(taskId, error);
          reject(error);
        }
      });
    });
  }

  /**
   * 获取或创建熔断器
   */
  getCircuitBreaker(name, options) {
    if (!this.circuitBreakers.has(name)) {
      this.circuitBreakers.set(name, new CircuitBreaker(name, options));
    }
    return this.circuitBreakers.get(name);
  }

  /**
   * 路由任务（v5 评分系统）
   */
  routeTask(taskSpec, userOverrides = {}) {
    return this.scorer.routeTask(taskSpec, userOverrides);
  }

  /**
   * 快速获取路由信息
   */
  getRoute(total) {
    return this.scorer.getRouteInfo(total, this.scorer.getSystemLoad());
  }

  /**
   * 处理新消息（触发上下文保护）
   */
  handleMessage(message) {
    // 更新会话历史
    this.summarizer.addMessage(message);
    
    // 触发多维度检测
    const result = this.context.onNewMessage(message);
    
    return result;
  }

  /**
   * 获取所有模块状态
   */
  getStatus() {
    return {
      limiter: this.limiter.getStatus(),
      timeout: this.timeout.getStatus(),
      truncation: this.truncation.getStatus(),
      memory: this.memory.getStatus(),
      summarizer: this.summarizer.getStatus(),
      context: this.context.getStatus(),
      rateLimiter: this.rateLimiter.getStatus(),
      circuitBreakers: Array.from(this.circuitBreakers.values()).map(cb => cb.getState()),
      logger: this.logger.getStatus(),
      health: this.health.getHealth(),
      security: this.security.getStatus(),
      validator: this.validator.getStatus(),
      scorer: this.scorer.getStatus()
    };
  }
}

// 创建单例
const protection = new ProtectionLayer();

export default protection;
export { protection };

// 自动初始化（如果已启用）
if (typeof process !== 'undefined' && process.env?.OPENCLAW_PROTECTION_ENABLED === 'true') {
  protection.init().catch(console.error);
}