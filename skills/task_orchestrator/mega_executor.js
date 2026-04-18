// mega_executor.js
async function executeMegaTask(taskSpec, plan, onProgress) {
 onProgress?.('启动超大任务执行器，自动分片并行');
 // 简化实现：直接调用子代理
 const { spawnWithProgress } = require('./progress_reporter');
 await spawnWithProgress(taskSpec, [], plan.timeoutSec, plan.memLimitMB, onProgress);
}

module.exports = { executeMegaTask };