/**
 * OpenClaw 保护层 - 加载器
 * 
 * 使用方式：
 * 1. 在 Node.js 中直接加载：
 *    const protection = await import('./protection/loader.js');
 *    protection.init();
 * 
 * 2. 通过环境变量启用：
 *    OPENCLAW_PROTECTION_ENABLED=true
 * 
 * 3. 通过配置文件：
 *    在 ~/.openclaw/openclaw.json 中添加 protection 配置
 */

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 加载配置
 */
function loadConfig() {
  const configPath = path.join(__dirname, 'config.env');
  
  if (!fs.existsSync(configPath)) {
    console.warn('[Protection] 配置文件不存在，使用默认值');
    return {};
  }

  const config = {};
  const content = fs.readFileSync(configPath, 'utf8');
  
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed) continue;
    
    const [key, ...valueParts] = trimmed.split('=');
    if (key && valueParts.length > 0) {
      config[key.trim()] = valueParts.join('=').trim();
    }
  }
  
  // 应用环境变量覆盖
  const envPrefix = 'OPENCLAW_';
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(envPrefix)) {
      config[key] = value;
    }
  }
  
  return config;
}

/**
 * 初始化保护层
 */
export async function init() {
  const config = loadConfig();
  
  console.log('[Protection] 初始化保护层...');
  
  // 加载各个模块
  const [
    limiter,
    timeout,
    truncation,
    memory,
    checkpoint,
    summarize
  ] = await Promise.all([
    import('./limiter.js'),
    import('./timeout.js'),
    import('./truncation.js'),
    import('./memory.js'),
    import('./checkpoint.js'),
    import('./summarize.js')
  ]);

  // 应用配置
  if (config.OPENCLAW_MAX_CONCURRENT) {
    process.env.OPENCLAW_MAX_CONCURRENT = config.OPENCLAW_MAX_CONCURRENT;
  }
  // ... 其他配置应用

  const protection = {
    limiter: limiter.taskQueue,
    timeout: timeout.timeoutController,
    truncation: truncation.outputTruncation,
    memory: memory.memoryLimiter,
    checkpoint: checkpoint.checkpointManager,
    summarizer: summarize.sessionSummarizer,
    
    // 便捷方法
    async runProtected(taskId, taskFn, options = {}) {
      // 启动超时监控
      this.timeout.startTask(taskId, options.timeoutMs || 60000);
      
      try {
        const result = await taskFn();
        this.timeout.complete(taskId);
        this.limiter.complete(taskId);
        return result;
      } catch (error) {
        this.limiter.fail(taskId, error);
        throw error;
      }
    },
    
    getStatus() {
      return {
        limiter: this.limiter.getStatus(),
        timeout: this.timeout.getStatus(),
        truncation: this.truncation.getStatus(),
        memory: this.memory.getStatus(),
        summarizer: this.summarizer.getStatus()
      };
    }
  };

  console.log('[Protection] 保护层初始化完成');
  console.log('[Protection] 状态:', JSON.stringify(protection.getStatus(), null, 2));
  
  return protection;
}

/**
 * 检查是否启用
 */
export function isEnabled() {
  return process.env.OPENCLAW_PROTECTION_ENABLED === 'true' ||
         process.argv.includes('--protection') ||
         fs.existsSync(path.join(__dirname, 'enabled'));
}

// 自动初始化
if (isEnabled()) {
  init().catch(console.error);
}

export default { init, isEnabled };