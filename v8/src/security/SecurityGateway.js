const path = require('path');
const { RateLimiter } = require('./RateLimiter');

class SecurityGateway {
  constructor(config) {
    this.allowedCommands = config.executor.allowedCommands;
    this.workspaceRoot = config.executor.workspaceRoot;
    this.maskingEnabled = config.security.secretMasking.enabled;
    this.maskPatterns = config.security.secretMasking.patterns || [];
    this.rateLimiter = config.security.rateLimit.enabled ?
      new RateLimiter(config.security.rateLimit.maxPerSecond) : null;
  }

  validateCommand(command, args, cwd) {
    // 1. 命令白名单
    const baseCmd = path.basename(command);
    if (!this.allowedCommands.includes(command) && !this.allowedCommands.includes(baseCmd)) {
      return { valid: false, reason: `Command '${command}' not in whitelist` };
    }

    // 2. P0-3 修复：禁止 shell 元字符（防止注入）- 补全 ! \n \r
    const dangerousPattern = /[;&|`$(){}\[\]<>\\!\n\r]/;
    for (const arg of args) {
      if (dangerousPattern.test(arg)) {
        return { valid: false, reason: `Argument contains dangerous characters: ${arg}` };
      }
      // 检测空字节
      if (arg.includes('\0')) {
        return { valid: false, reason: 'Argument contains null byte' };
      }
    }

    // 3. 路径沙箱
    if (cwd) {
      const resolved = path.resolve(this.workspaceRoot, cwd);
      if (!resolved.startsWith(path.resolve(this.workspaceRoot))) {
        return { valid: false, reason: `cwd '${cwd}' escapes workspace root` };
      }
    }

    return { valid: true };
  }

  maskSecrets(text) {
    if (!this.maskingEnabled || !text) return text;

    let masked = text;
    for (const pattern of this.maskPatterns) {
      const regex = new RegExp(`(${pattern}[\\s]*[=:]\\s*)([^\\s"']+)`, 'gi');
      masked = masked.replace(regex, '$1***REDACTED***');
    }
    masked = masked.replace(/Bearer\s+[A-Za-z0-9\-\._~\+\/]+/gi, 'Bearer ***REDACTED***');
    return masked;
  }

  checkRateLimit(ip) {
    if (!this.rateLimiter) return true;
    return this.rateLimiter.tryAcquire(ip);
  }
}

module.exports = { SecurityGateway };
