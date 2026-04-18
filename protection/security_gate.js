/**
 * OpenCLaw 保护层 - 安全网关
 * v4.3 新增
 * 
 * 功能：
 * - IP级别限流（令牌桶）
 * - 命令白名单
 * - 路径沙箱
 * - 任务规格大小限制
 * - 敏感信息脱敏
 */

import * as fs from 'fs';
import * as path from 'path';

class SecurityGate {
  constructor(options = {}) {
    // IP限流配置
    this.rateLimitPerSec = parseInt(process.env.RATE_LIMIT_PER_SEC || '2');
    this.tokens = new Map();
    
    // 命令白名单
    this.allowedCommands = (process.env.ALLOWED_COMMANDS || '/usr/bin/ls,/usr/bin/cat,/usr/bin/grep').split(',');
    
    // 规格大小限制 (1MB)
    this.maxSpecSize = parseInt(process.env.MAX_SPEC_SIZE_BYTES || '1048576');
    
    // 允许的输入路径前缀
    this.allowedInputPath = process.env.ALLOWED_INPUT_PATH || '/tmp/openclaw/inputs/';
  }

  /**
   * IP限流检查
   */
  rateLimit(ip) {
    const now = Date.now();
    let entry = this.tokens.get(ip);
    if (!entry) {
      entry = { tokens: this.rateLimitPerSec, lastRefill: now };
      this.tokens.set(ip, entry);
    }
    const elapsed = (now - entry.lastRefill) / 1000;
    entry.tokens = Math.min(this.rateLimitPerSec, entry.tokens + elapsed * this.rateLimitPerSec);
    entry.lastRefill = now;
    
    if (entry.tokens >= 1) {
      entry.tokens -= 1;
      return true;
    }
    throw new Error('Rate limit exceeded');
  }

  /**
   * 验证命令（白名单）
   */
  async validateCommand(cmd) {
    // 解析绝对路径
    let resolved;
    try {
      resolved = await fs.realpath(cmd);
    } catch {
      throw new Error(`Command not found: ${cmd}`);
    }
    
    if (!this.allowedCommands.includes(resolved)) {
      throw new Error(`Command not allowed: ${cmd}`);
    }
    return true;
  }

  /**
   * 验证路径（沙箱）
   */
  validatePath(arg) {
    // 禁止路径遍历
    if (arg.includes('..')) {
      throw new Error(`Path traversal forbidden: ${arg}`);
    }
    // 禁止绝对路径（除了允许的输入目录）
    if (arg.startsWith('/') && !arg.startsWith(this.allowedInputPath)) {
      throw new Error(`Absolute path not allowed: ${arg}`);
    }
    return true;
  }

  /**
   * 验证参数
   */
  validateArgs(args) {
    for (const arg of args || []) {
      this.validatePath(arg);
    }
    return true;
  }

  /**
   * 规格大小限制
   */
  validateSpecSize(spec) {
    const size = JSON.stringify(spec).length;
    if (size > this.maxSpecSize) {
      throw new Error(`Spec size ${size} exceeds limit ${this.maxSpecSize}`);
    }
    return true;
  }

  /**
   * 敏感信息脱敏（用于日志）
   */
  sanitizeSpec(spec) {
    const sensitive = ['password', 'token', 'secret', 'api_key', 'Authorization'];
    let str = JSON.stringify(spec);
    
    for (const s of sensitive) {
      // 替换 "password": "xxx" 为 "password": "***"
      const re = new RegExp(`"(${s})"\\s*:\\s*"[^"]*"`, 'gi');
      str = str.replace(re, `"$1":"***"`);
    }
    
    try {
      return JSON.parse(str);
    } catch {
      return { _sanitized: true };
    }
  }

  /**
   * 统一验证
   */
  async validate(taskSpec, ip = 'unknown') {
    // 1. IP限流
    this.rateLimit(ip);
    
    // 2. 规格大小
    this.validateSpecSize(taskSpec);
    
    // 3. 命令验证
    if (taskSpec.cmd) {
      await this.validateCommand(taskSpec.cmd);
    }
    
    // 4. 参数验证
    if (taskSpec.args) {
      this.validateArgs(taskSpec.args);
    }
    
    return true;
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      rateLimitPerSec: this.rateLimitPerSec,
      allowedCommands: this.allowedCommands.length,
      maxSpecSize: this.maxSpecSize,
      activeIPs: this.tokens.size
    };
  }
}

// 导出单例
export const securityGate = new SecurityGate();

export default securityGate;