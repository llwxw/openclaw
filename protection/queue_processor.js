/**
 * OpenClaw Context Queue Processor
 * 定期扫描消息队列，处理消息并调用保护层
 */

import * as fs from 'fs';
import * as path from 'path';

const QUEUE_FILE = '/tmp/openclaw/msg_queue/incoming.jsonl';
const PROCESSED_DIR = '/tmp/openclaw/msg_queue/processed';
const CHECK_INTERVAL = 5000; // 5秒检查一次

async function initProtection() {
  try {
    const protection = await import('./index.js');
    await protection.default.init();
    return protection.default;
  } catch (e) {
    console.error('[ContextQueue] 保护层初始化失败:', e.message);
    return null;
  }
}

async function processQueue() {
  let protection = await initProtection();
  
  // 如果保护层没有初始化成功，每隔一段时间重试
  setInterval(async () => {
    if (!protection) {
      protection = await initProtection();
    }
    
    if (!protection) return;
    
    // 检查队列文件是否存在
    if (!fs.existsSync(QUEUE_FILE)) return;
    
    // 读取队列
    const content = fs.readFileSync(QUEUE_FILE, 'utf8');
    if (!content.trim()) return;
    
    const lines = content.trim().split('\n');
    const newLines = [];
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const msg = JSON.parse(line);
        
        // 调用保护层
        if (global.openclaw && global.openclaw.addContextMessage) {
          global.openclaw.addContextMessage(msg.role, msg.content, msg.taskId);
          console.log(`[ContextQueue] 处理消息: ${msg.role} - ${String(msg.content).slice(0, 30)}`);
        } else {
          // 保留未处理的消息
          newLines.push(line);
        }
      } catch (e) {
        console.warn('[ContextQueue] 解析失败:', e.message);
        newLines.push(line);
      }
    }
    
    // 如果有未处理的消息，保留它们
    if (newLines.length > 0) {
      fs.writeFileSync(QUEUE_FILE, newLines.join('\n'), 'utf8');
    } else {
      // 全部处理完成，清空队列
      fs.unlinkSync(QUEUE_FILE);
    }
    
  }, CHECK_INTERVAL);
  
  console.log('[ContextQueue] 消息队列处理器已启动');
  console.log(`[ContextQueue] 检查间隔: ${CHECK_INTERVAL}ms`);
  console.log(`[ContextQueue] 队列文件: ${QUEUE_FILE}`);
}

// 启动
if (import.meta.url === `file://${process.argv[1]}`) {
  processQueue();
}

export { processQueue };
export default { processQueue };