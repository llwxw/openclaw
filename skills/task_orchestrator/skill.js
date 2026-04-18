// task_orchestrator/skill.js
// 整合：评分路由 + 上下文保护 + 子代理进度上报

const { computeFineScore, getExecutionPlan } = require('./scoring');
const { spawnWithProgress } = require('./progress_reporter');
const { executeMegaTask } = require('./mega_executor');
const contextProtector = require('./context_protector');

module.exports = {
 name: 'task_orchestrator',
 version: '3.0.0',
 description: '全自动任务编排：评分路由 + 上下文保护 + 子代理进度',

 async init() {
 console.log('[TaskOrchestrator] Initialized');
 },

 hooks: {
 onUserMessage: async (message, userId, taskId) => {
 await contextProtector.addMessage('user', message, taskId);
 },
 onAssistantMessage: async (response) => {
 await contextProtector.addMessage('assistant', response);
 },
 beforeTask: async (taskSpec, context) => {
 const score = await computeFineScore(taskSpec);
 const plan = getExecutionPlan(score.totalScore, score.factors.scaleIndex);
 context.routing = plan;
 context.score = score;
 console.log(`[Router] Score=${score.totalScore} → ${plan.mode}`);
 return taskSpec;
 }
 },

 async executeTask(task, context, sendUserMessage) {
 const plan = context.routing;
 if (!plan) throw new Error('No routing plan');
 switch (plan.mode) {
 case 'DIRECT':
 return require('child_process').execSync(task.spec, { timeout: plan.timeoutSec * 1000 });
 case 'SPAWN_SUBAGENT':
 return spawnWithProgress(task.spec, [], plan.timeoutSec, plan.memLimitMB, sendUserMessage);
 case 'MEGA_TASK':
 return executeMegaTask(task.spec, plan, sendUserMessage);
 default:
 throw new Error(`Unsupported mode: ${plan.mode}`);
 }
 }
};