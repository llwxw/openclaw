// scoring.js - Task Orchestrator v3.0
// 评分因子与路由 - 调整后支持 0-100 分完整覆盖

const WEIGHTS = {
 instructionCount: 0.12,
 codeLines: 0.08,
 dependencyComplexity: 0.10,
 cpuIntensity: 0.10,
 ioIntensity: 0.08,
 networkIntensity: 0.12,
 estimatedDuration: 0.12,
 scaleIndex: 0.28
};

function computeComplexity(taskSpec) {
 const cnt = (taskSpec.match(/&&|;|\n/g) || []).length + 1;
 if (cnt === 1) return 1;
 if (cnt <= 3) return 2;
 if (cnt <= 6) return 3;
 if (cnt <= 10) return 4;
 return 5;
}

function computeCodeLines(taskSpec) {
 const lines = (taskSpec.match(/\n/g) || []).length + 1;
 if (lines <= 10) return 1;
 if (lines <= 50) return 2;
 if (lines <= 100) return 3;
 if (lines <= 500) return 4;
 return 5;
}

function computeScaleIndex(taskSpec) {
 const lower = taskSpec.toLowerCase();
 let score = 0;
 
 const patterns = [
   'docker', 'docker-compose', 'kubernetes', 'kubectl', 'helm',
   'terraform', 'ansible', 'packer', 'vault',
   'jenkins', 'gitlab', 'github actions', 'ci cd',
   'git clone', 'npm install', 'pip install',
   'make all', 'make test', 'build', 'compile'
 ];
 
 for (const p of patterns) {
   if (lower.includes(p)) score += 1;
 }
 
 // 基础分1，最多加到5
 return Math.min(5, Math.max(1, score));
}

async function computeFineScore(taskSpec) {
 const factors = {
   instructionCount: computeComplexity(taskSpec),
   codeLines: computeCodeLines(taskSpec),
   dependencyComplexity: /npm install|pip install|apt install|yum install|brew install/i.test(taskSpec) ? 4 : 
                          /install|setup|init/i.test(taskSpec) ? 2 : 1,
   cpuIntensity: /make|compile|gcc|g\+\+|clang|build|npm run build/i.test(taskSpec) ? 4 : 
                 /python.*\.py|node.*\.js/i.test(taskSpec) ? 2 : 1,
   ioIntensity: /cp|mv|tar|dd|rsync|backup|dump/i.test(taskSpec) ? 4 : 1,
   networkIntensity: /curl|wget|git clone|fetch|download|http|https/i.test(taskSpec) ? 4 : 
                     /ssh|scp|rsync/i.test(taskSpec) ? 2 : 1,
   estimatedDuration: /sleep|wait|timeout/i.test(taskSpec) ? 4 : 
                      /compile|build|install|test/i.test(taskSpec) ? 3 : 1,
   scaleIndex: computeScaleIndex(taskSpec)
 };
 
 let weighted = 0;
 for (const [k, v] of Object.entries(factors)) {
   weighted += v * WEIGHTS[k];
 }
 
 const totalScore = Math.min(100, Math.round(weighted * 20));
 return { totalScore, factors };
}

function getExecutionPlan(score, scaleIndex) {
 if (scaleIndex >= 4) return { mode: 'MEGA_TASK', timeoutSec: 7200, memLimitMB: 8192 };
 if (score <= 20) return { mode: 'DIRECT', timeoutSec: 30 };
 if (score <= 40) return { mode: 'STEP_ARCHIVE', stepTimeoutSec: 60, memLimitMB: 1024 };
 if (score <= 60) return { mode: 'SPAWN_SUBAGENT', timeoutSec: Math.max(60, Math.min(180, score * 3)), memLimitMB: 2048 };
 if (score <= 80) return { mode: 'PARALLEL_SHARDS', timeoutSec: Math.max(120, Math.min(160, score * 2)), memLimitMB: 2048 };
 return { mode: 'MEGA_TASK', timeoutSec: 7200, memLimitMB: 8192 };
}

module.exports = { computeFineScore, getExecutionPlan };