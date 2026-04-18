/**
 * 技能加载器 - v8 与 auto_improve 的桥接层
 */
const path = require('path');

const SKILLS = {
 auto_improve: {
 path: '../../../workspace/skills/task-orchestrator-v7/auto_improve/autoImprove.js',
 description: '自动化代码改进'
 }
 // 未来可扩展其他技能
};

/**
 * 加载技能模块
 * @param {string} skillName - 技能名称
 * @returns {Object} { execute: Function, config: Object }
 */
function loadSkill(skillName) {
 const skillInfo = SKILLS[skillName];
 if (!skillInfo) {
 throw new Error(`Unknown skill: ${skillName}`);
 }

 try {
 const skillPath = path.resolve(__dirname, skillInfo.path);
 const skillModule = require(skillPath);

 // 优先使用 runAutoImprove 函数
 if (skillModule.runAutoImprove) {
 return { execute: skillModule.runAutoImprove };
 }
 // 如果模块导出的是函数
 if (typeof skillModule === 'function') {
 return { execute: skillModule };
 }
 // 否则尝试默认导出
 return { execute: skillModule.default || skillModule };
 } catch (err) {
 console.error(`Failed to load skill ${skillName}:`, err.message);
 return null;
 }
}

module.exports = { loadSkill, SKILLS };