// progress_reporter.js
const { spawn } = require('child_process');

async function spawnWithProgress(cmd, args, timeoutSec, memLimitMB, onProgress) {
 const limitCmd = `ulimit -v ${memLimitMB * 1024} && exec "$@"`;
 const proc = spawn('/bin/sh', ['-c', limitCmd, '--', cmd, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
 let lastOutput = Date.now();
 const interval = setInterval(() => {
 if (Date.now() - lastOutput > 30000 && !proc.killed) onProgress?.('仍在运行，30秒无输出');
 }, 30000);
 proc.stdout.on('data', (chunk) => {
 const text = chunk.toString();
 const match = text.match(/\[PROGRESS\]\s*(.*)/);
 if (match) onProgress?.(match[1]);
 else process.stdout.write(text);
 lastOutput = Date.now();
 });
 const timeout = setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, timeoutSec * 1000);
 const code = await new Promise(resolve => proc.on('close', resolve));
 clearInterval(interval); clearTimeout(timeout);
 if (code !== 0) throw new Error(`Exit ${code}`);
}

module.exports = { spawnWithProgress };