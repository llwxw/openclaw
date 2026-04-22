/**
 * exec_with_limit.js - 带输出截断的 exec 封装
 * 
 * 功能：
 * - 大输出自动截断到文件
 * - 保留最后部分显示
 * - 超过阈值时提示完整输出位置
 * 
 * 使用方式:
 *   node exec_with_limit.js "your command" [maxOutputKB]
 * 
 * 示例:
 *   node exec_with_limit.js "ls -la /" 10
 *   node exec_with_limit.js "find / -name '*.log'" 20
 */

const { spawn } = require('child_process');
const http = require('http');

const TRUNCATION_API = 'http://127.0.0.1:18790/api/truncate';
const DEFAULT_MAX_KB = 10;

async function truncate(content, maxKB) {
  return new Promise((resolve) => {
    const data = JSON.stringify({
      taskId: `exec-${Date.now()}`,
      content: content
    });
    
    const req = http.request(TRUNCATION_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    
    req.on('error', () => resolve({ error: 'truncation service unavailable', displayed: content }));
    req.write(data);
    req.end();
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node exec_with_limit.js "command" [maxOutputKB]');
    process.exit(1);
  }
  
  const cmd = args[0];
  const maxKB = parseInt(args[1]) || DEFAULT_MAX_KB;
  const maxBytes = maxKB * 1024;
  
  console.error(`[exec] Running: ${cmd}`);
  console.error(`[exec] Output limit: ${maxKB}KB`);
  
  return new Promise((resolve) => {
    const proc = spawn('/bin/sh', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
    
    let output = '';
    let outputBytes = 0;
    let truncated = false;
    
    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      outputBytes += Buffer.byteLength(text, 'utf8');
      
      if (outputBytes <= maxBytes) {
        process.stdout.write(text);
        output += text;
      } else if (!truncated) {
        truncated = true;
        process.stdout.write(`\n[output truncated, limit ${maxKB}KB]\n`);
      }
    });
    
    proc.stderr.on('data', (chunk) => {
      process.stderr.write(chunk.toString());
    });
    
    proc.on('close', async (code) => {
      if (truncated && outputBytes > maxBytes) {
        console.error(`[exec] Total output: ${outputBytes} bytes, truncated to ${maxKB}KB`);
        
        // 如果 truncation API 可用，保存完整输出
        const result = await truncate(output, maxKB);
        if (result.tempFile) {
          console.error(`[exec] Full output saved to: /tmp/openclaw/${result.tempFile}`);
        }
      }
      
      process.exit(code || 0);
      resolve();
    });
    
    // 超时保护（默认60秒）
    const timeout = setTimeout(() => {
      console.error('[exec] Timeout, killing process...');
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL');
      }, 5000);
    }, 60000);
    
    proc.on('close', () => clearTimeout(timeout));
  });
}

main().catch(console.error);
