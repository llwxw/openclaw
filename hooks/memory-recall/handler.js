/**
 * memory-recall hook - 主动回忆之前的学习
 *
 * 触发时机:
 *   - agent:bootstrap (注入完整记忆上下文)
 *
 * 功能:
 *   - Memory Recall: 最近 24 小时任务
 *   - Active Memory: 重要实体
 *   - Self-Improving: 历史学习
 *   - QMD: 记忆搜索能力
 */

import { generateRecallContext, getRecallContext } from '/home/ai/.openclaw/workspace/skills/memory-recall/recall.js';
import { generateActiveMemoryContext } from '/home/ai/.openclaw/workspace/skills/active-memory/active_memory.js';
import { generateSelfImproveContext } from '/home/ai/.openclaw/workspace/skills/self-improving/self_improve.js';
import { generateQMDContext } from '/home/ai/.openclaw/workspace/skills/qmd/query_memory.js';

export default async function handler(event) {
  // agent:bootstrap - 注入完整记忆上下文
  if (event.type === "agent" && event.action === "bootstrap") {
    // 获取所有记忆上下文
    const recall = getRecallContext();
    const active = generateActiveMemoryContext();
    const selfImprove = generateSelfImproveContext();
    const qmd = generateQMDContext();
    
    // 组装注入内容
    let injection = '\n\n=== MEMORY SYSTEM ===\n\n';
    injection += recall + '\n';
    
    if (active) {
      injection += active + '\n';
    }
    
    if (selfImprove) {
      injection += selfImprove + '\n';
    }
    
    injection += qmd + '\n';
    injection += '=== END MEMORY ===\n\n';
    
    return { injection };
  }
  
  return null;
}
