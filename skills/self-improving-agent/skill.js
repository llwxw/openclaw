// ~/.openclaw/skills/self-improving-agent/skill.js
// 增强版：冲突检测 + 上下文条件解析 + 主动建议（只读）
const fs = require('fs').promises;
const path = require('path');

const MEMORY_FILE = path.join(__dirname, 'rules/memory.md');
const CORRECTIONS_FILE = path.join(__dirname, 'rules/corrections.md');
const LOG_FILE = path.join(__dirname, 'skill.log');
const STATS_FILE = path.join(__dirname, '.stats.json');

// ---------- 辅助函数 ----------
async function log(message) {
 const timestamp = new Date().toISOString();
 try {
 await fs.appendFile(LOG_FILE, `[${timestamp}] ${message}\n`, 'utf-8');
 } catch (err) { /* 静默失败 */ }
}

async function readRuleFile(filePath) {
 try {
 const content = await fs.readFile(filePath, 'utf-8');
 return content.trim();
 } catch (err) {
 if (err.code === 'ENOENT') return '';
 await log(`读取失败 ${filePath}: ${err.message}`);
 return '';
 }
}

async function loadStats() {
 try {
 const data = await fs.readFile(STATS_FILE, 'utf-8');
 return JSON.parse(data);
 } catch { return { hits: {}, violations: {} }; }
}

async function saveStats(stats) {
 try {
 await fs.writeFile(STATS_FILE, JSON.stringify(stats, null, 2), 'utf-8');
 } catch (err) { await log(`保存统计失败: ${err.message}`); }
}

function parseRule(line, sourceFile) {
 const rulePattern = /^-\s+(.+?)(?:\s+\[context:\s*(.+?)\])?(?:\s+#(\d{4}-\d{2}-\d{2}))?$/;
 const match = line.match(rulePattern);
 if (!match) return null;
 const [, text, condition, date] = match;
 return {
 text: text.trim(),
 condition: condition ? condition.trim() : null,
 date: date || null,
 source: sourceFile,
 raw: line
 };
}

function isConflict(ruleA, ruleB) {
 const opposites = [
 [/\b使用中文\b/, /\b使用英文\b/],
 [/\b不要用表情\b/, /\b可以用表情\b/],
 [/\b详细回答\b/, /\b简洁回答\b/],
 ];
 for (const [pat1, pat2] of opposites) {
 if (pat1.test(ruleA.text) && pat2.test(ruleB.text)) return true;
 if (pat2.test(ruleA.text) && pat1.test(ruleB.text)) return true;
 }
 return false;
}

function evaluateCondition(condition, userMessage) {
 if (!condition) return true;
 const lowerMsg = (userMessage || '').toLowerCase();
 const lowerCond = condition.toLowerCase();
 if (lowerCond.startsWith('包含')) {
 const keyword = lowerCond.replace('包含', '').trim();
 return lowerMsg.includes(keyword);
 }
 if (lowerCond.startsWith('正则:')) {
 try {
 const regex = new RegExp(lowerCond.slice(3).trim(), 'i');
 return regex.test(lowerMsg);
 } catch { return false; }
 }
 return lowerMsg.includes(lowerCond);
}

async function buildSmartPrompt(userMessage) {
 const memoryRaw = await readRuleFile(MEMORY_FILE);
 const correctionsRaw = await readRuleFile(CORRECTIONS_FILE);
 const allLines = [];
 if (memoryRaw) allLines.push(...memoryRaw.split('\n').map(l => ({ line: l, src: 'memory.md' })));
 if (correctionsRaw) allLines.push(...correctionsRaw.split('\n').map(l => ({ line: l, src: 'corrections.md' })));

 const rules = [];
 for (const { line, src } of allLines) {
 if (line.startsWith('-')) {
 const rule = parseRule(line, src);
 if (rule) rules.push(rule);
 }
 }

 const stats = await loadStats();

 const conflicts = [];
 for (let i = 0; i < rules.length; i++) {
 for (let j = i+1; j < rules.length; j++) {
 if (isConflict(rules[i], rules[j])) {
 conflicts.push([rules[i], rules[j]]);
 }
 }
 }

 const activeRules = rules.filter(rule => evaluateCondition(rule.condition, userMessage));
 const inactiveRules = rules.filter(rule => !evaluateCondition(rule.condition, userMessage));

 let suggestions = '';
 for (const rule of rules) {
 const key = `${rule.source}|${rule.text}`;
 if (stats.violations[key] && stats.violations[key] > 3) {
 suggestions += `- ⚠️ 规则"${rule.text}"已被违反 ${stats.violations[key]} 次，你可能需要修改或删除它。\n`;
 }
 }
 if (conflicts.length > 0) {
 suggestions += `- 🔥 检测到冲突规则：\n`;
 for (const [r1, r2] of conflicts) {
 suggestions += ` * "${r1.text}" (来自 ${r1.source}) 与 "${r2.text}" (来自 ${r2.source}) 矛盾。建议手动编辑文件保留其中一条。\n`;
 }
 }

 let prompt = '';
 if (activeRules.length) {
 prompt += `## 当前生效规则（已根据对话上下文自动筛选）\n`;
 for (const r of activeRules) {
 prompt += `- ${r.text}`;
 if (r.condition) prompt += ` [条件: ${r.condition}]`;
 if (r.date) prompt += ` (记录于 ${r.date})`;
 prompt += `\n`;
 }
 prompt += `\n`;
 }
 if (inactiveRules.length) {
 prompt += `## 未激活规则（当前上下文不满足条件，暂不应用）\n`;
 for (const r of inactiveRules) {
 prompt += `- ${r.text} [需要: ${r.condition}]\n`;
 }
 prompt += `\n`;
 }
 if (suggestions) {
 prompt += `## 💡 维护建议\n${suggestions}\n`;
 }
 if (!activeRules.length && !inactiveRules.length && !suggestions) {
 prompt = '';
 } else {
 prompt = `【self-improving-agent 智能规则】\n${prompt}\n请严格遵守上述规则，并根据维护建议提醒用户（但不要自动修改规则文件）。\n`;
 }
 return { prompt, stats };
}

async function injectPrompt(context, promptText) {
 if (!promptText) return false;
 if (typeof context.addSystemMessage === 'function') {
 context.addSystemMessage(promptText);
 await log('注入 via addSystemMessage');
 return true;
 }
 if (context.systemMessage !== undefined) {
 context.systemMessage = `${promptText}\n\n${context.systemMessage}`;
 await log('注入 via systemMessage');
 return true;
 }
 if (context.userMessage !== undefined) {
 context.userMessage = `${promptText}\n\n${context.userMessage || ''}`;
 await log('注入 via userMessage (fallback)');
 return true;
 }
 await log('注入失败：无可用方法');
 return false;
}

let injectedThisSession = false;

exports.onStart = async function(context) {
 if (injectedThisSession) {
 await log('本会话已注入过，跳过');
 return { success: true, skipped: true };
 }

 const userMessage = context.userMessage || context.prompt || '';
 const { prompt, stats } = await buildSmartPrompt(userMessage);

 if (prompt) {
 const ok = await injectPrompt(context, prompt);
 if (ok) {
 injectedThisSession = true;
 await log(`智能规则注入成功 (长度 ${prompt.length})`);
 context._selfImprovingStats = stats;
 return { success: true, loaded: true };
 } else {
 await log('智能规则注入失败');
 return { success: false, error: 'injection failed' };
 }
 } else {
 await log('无规则需要注入');
 return { success: true, loaded: false };
 }
};

exports.onResponse = async function(context, response) {
 return { success: true };
};

exports.onEnd = async function() {
 injectedThisSession = false;
 await log('会话结束，重置注入标记');
};