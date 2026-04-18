#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const configDir = path.join(process.env.HOME, '.openclaw/config');
const modelsPath = path.join(configDir, 'models.json');
const rulesPath = path.join(configDir, 'routing_rules.json');
const openclawPath = path.join(process.env.HOME, '.openclaw/openclaw.json');

let hasError = false;

// 1. 检查文件存在
[modelsPath, rulesPath, openclawPath].forEach(f => {
  if (!fs.existsSync(f)) {
    console.error(`❌ Missing: ${f}`);
    hasError = true;
  }
});
if (hasError) process.exit(1);

const models = JSON.parse(fs.readFileSync(modelsPath));
const rules = JSON.parse(fs.readFileSync(rulesPath));
const openclaw = JSON.parse(fs.readFileSync(openclawPath));

// 2. 校验 provider 环境变量
Object.entries(models.providers).forEach(([name, cfg]) => {
  const envKey = cfg.apiKey.replace('${', '').replace('}', '');
  if (!process.env[envKey]) {
    console.warn(`⚠️ Environment variable ${envKey} not set (provider: ${name})`);
  }
});

// 3. 校验 modelRef 存在
const agentList = openclaw.agents?.list || [];
const modelIds = Object.keys(models.models);
agentList.forEach(agent => {
  if (agent.modelRef && !modelIds.includes(agent.modelRef)) {
    console.error(`❌ Agent '${agent.id}' references unknown modelRef '${agent.modelRef}'`);
    hasError = true;
  }
});

// 4. 校验 target_agent 存在
const agentIds = agentList.map(a => a.id);
rules.rules.forEach(rule => {
  if (!agentIds.includes(rule.target_agent)) {
    console.error(`❌ Rule '${rule.id}' targets unknown agent '${rule.target_agent}'`);
    hasError = true;
  }
});

// 5. 校验 fallback 模型存在
Object.entries(models.models).forEach(([name, cfg]) => {
  if (cfg.fallback && !models.models[cfg.fallback]) {
    console.error(`❌ Model '${name}' fallback '${cfg.fallback}' not found`);
    hasError = true;
  }
});

// 6. 警告：priority 重复
const priorities = rules.rules.map(r => r.priority);
if (new Set(priorities).size !== priorities.length) {
  console.warn('⚠️ Duplicate priority values detected in routing rules');
}

console.log(hasError ? '❌ Validation failed' : '✅ Validation passed');
process.exit(hasError ? 1 : 0);