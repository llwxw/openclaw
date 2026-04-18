/**
 * OpenClaw 任务评分与路由系统 v5
 * 
 * 4维评分 + 负载降级 + 4种执行模式
 * 
 * 评分维度:
 * - logic: 逻辑复杂度 (0-3)
 * - risk: 风险度 (0-3)
 * - duration: 预估时长 (0-3)
 * - resource: 资源消耗 (0-3)
 */

import * as os from 'os';

class TaskScorer {
  constructor(options = {}) {
    // 路由阈值
    this.thresholds = {
      direct: parseInt(process.env.ROUTING_THRESHOLD_DIRECT || '2'),
      step: parseInt(process.env.ROUTING_THRESHOLD_STEP || '5'),
      spawn: parseInt(process.env.ROUTING_THRESHOLD_SPAWN || '8')
    };
    
    // 时长→超时映射（秒）
    this.durationTimeout = {
      0: parseInt(process.env.DURATION_TIMEOUT_0 || '30'),     // <1分钟
      1: parseInt(process.env.DURATION_TIMEOUT_1 || '600'),    // 1-10分钟
      2: parseInt(process.env.DURATION_TIMEOUT_2 || '1800'),   // 10-60分钟
      3: parseInt(process.env.DURATION_TIMEOUT_3 || '3600')    // >1小时
    };
    
    // 步骤超时
    this.stepTimeout = parseInt(process.env.STEP_TIMEOUT_SEC || '60');
    
    // 负载降级阈值
    this.loadDowngradeCpu = parseFloat(process.env.LOAD_DOWNGRADE_CPU || '0.8');
    this.loadDowngradeMem = parseFloat(process.env.LOAD_DOWNGRADE_MEM || '0.8');
    
    // 直接执行默认超时
    this.directTimeout = parseInt(process.env.DIRECT_TIMEOUT_SEC || '30');
  }

  /**
   * 自动评分（4维）
   */
  autoScore(taskSpec) {
    let logic = 0, risk = 0, duration = 0, resource = 0;
    const specStr = JSON.stringify(taskSpec);
    
    // 1. 逻辑复杂度：统计分支/循环关键字
    const branchCount = (specStr.match(/\b(if|for|while|case|function|=>|switch)\b/g) || []).length;
    if (branchCount === 0) logic = 0;
    else if (branchCount <= 3) logic = 1;
    else if (branchCount <= 8) logic = 2;
    else logic = 3;
    
    // 2. 风险度：网络、外部命令、交互
    if (/\b(curl|wget|npm install|pip install|git clone|fetch|axios)\b/.test(specStr)) risk = 2;
    if (/\b(input|readline|prompt|stdin)\b/.test(specStr)) risk = Math.max(risk, 3);
    if (risk === 0 && /(localhost|127\.0\.0\.1|0\.0\.0\.0)/.test(specStr)) risk = 1;
    if (!risk && /\b(exec|spawn|eval|require)\b/.test(specStr)) risk = 2;
    
    // 3. 预估时长：基于耗时命令
    if (/\b(sleep|wait|tar|gzip|make|compile|build|docker build)\b/.test(specStr)) duration = 2;
    else if (/\b(git clone|docker pull|pip install|npm install|yarn)\b/.test(specStr)) duration = 1;
    else if (/\b(grep|find|awk|sed|cat|head|tail)\b/.test(specStr)) duration = 0;
    else duration = 0;
    
    // 4. 资源消耗：基于解释器/编译器
    if (/\b(node|python|java|ruby|php|go run)\b/.test(specStr)) resource = 2;
    else if (/\b(cp|mv|rsync|scp|dd)\b/.test(specStr)) resource = 1;
    else if (/\b(gcc|clang|cargo|cmake)\b/.test(specStr)) resource = 3;
    else resource = 1;
    
    return { logic, risk, duration, resource, total: logic + risk + duration + resource };
  }

  /**
   * 获取基础路由
   */
  getBaseRoute(total) {
    if (total <= this.thresholds.direct) return 'DIRECT';
    if (total <= this.thresholds.step) return 'STEP_ARCHIVE';
    if (total <= this.thresholds.spawn) return 'SPAWN_SUBAGENT';
    return 'MULTI_SUBAGENT';
  }

  /**
   * 获取系统负载
   */
  getSystemLoad() {
    const cpus = os.cpus();
    const avgLoad = os.loadavg()[0] / cpus.length;
    const memUsage = 1 - (os.freemem() / os.totalmem());
    return { 
      cpu: avgLoad, 
      mem: memUsage,
      cpuPercent: (avgLoad / cpus.length * 100).toFixed(1),
      memPercent: (memUsage * 100).toFixed(1)
    };
  }

  /**
   * 降级路由（负载过高时）
   */
  downgradeRoute(route, load) {
    const ORDER = ['DIRECT', 'STEP_ARCHIVE', 'SPAWN_SUBAGENT', 'MULTI_SUBAGENT'];
    const idx = ORDER.indexOf(route);
    
    if ((load.cpu > this.loadDowngradeCpu || load.mem > this.loadDowngradeMem) && idx > 0) {
      return ORDER[idx - 1];
    }
    return route;
  }

  /**
   * 获取超时时间
   */
  getTimeout(route, durationScore) {
    if (route === 'DIRECT') return this.directTimeout;
    if (route === 'STEP_ARCHIVE') return this.stepTimeout;
    return this.durationTimeout[durationScore] || 60;
  }

  /**
   * 主路由函数
   */
  routeTask(taskSpec, userOverrides = {}) {
    // 1. 自动评分
    let score = this.autoScore(taskSpec);
    
    // 2. 用户覆盖
    if (userOverrides.logic !== undefined) score.logic = userOverrides.logic;
    if (userOverrides.risk !== undefined) score.risk = userOverrides.risk;
    if (userOverrides.duration !== undefined) score.duration = userOverrides.duration;
    if (userOverrides.resource !== undefined) score.resource = userOverrides.resource;
    score.total = score.logic + score.risk + score.duration + score.resource;
    
    // 3. 基础路由
    let baseRoute = this.getBaseRoute(score.total);
    
    // 4. 负载降级
    const load = this.getSystemLoad();
    const finalRoute = this.downgradeRoute(baseRoute, load);
    
    // 5. 超时计算
    const timeoutSec = this.getTimeout(finalRoute, score.duration);
    const stepTimeoutSec = finalRoute === 'STEP_ARCHIVE' ? this.stepTimeout : undefined;
    
    return {
      route: finalRoute,
      isDowngraded: finalRoute !== baseRoute,
      baseRoute,
      timeoutSec,
      stepTimeoutSec,
      checkpointEnabled: finalRoute === 'STEP_ARCHIVE',
      score,
      load
    };
  }

  /**
   * 快速路由（用于展示）
   */
  getRouteInfo(total, load) {
    const baseRoute = this.getBaseRoute(total);
    const finalRoute = this.downgradeRoute(baseRoute, load);
    return {
      baseRoute,
      finalRoute,
      isDowngraded: finalRoute !== baseRoute,
      load
    };
  }

  /**
   * 获取状态
   */
  getStatus() {
    const load = this.getSystemLoad();
    return {
      thresholds: this.thresholds,
      durationTimeout: this.durationTimeout,
      stepTimeout: this.stepTimeout,
      load,
      loadDowngrade: {
        cpu: this.loadDowngradeCpu * 100 + '%',
        mem: this.loadDowngradeMem * 100 + '%'
      }
    };
  }
}

// 导出单例
export const taskScorer = new TaskScorer();

export default taskScorer;