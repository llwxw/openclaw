/**
 * memory-recall hook - 主动回忆之前的学习
 *
 * 触发时机:
 *   - agent:bootstrap (注入 recall 上下文)
 *   - agent:response (无操作)
 *
 * 功能:
 *   - bootstrap: 生成并注入最近 24 小时的任务记忆
 *   - 供 AI 在对话前了解之前做过什么
 */

import { generateRecallContext, getRecallContext } from '/home/ai/.openclaw/workspace/skills/memory-recall/recall.js';

export default async function handler(event) {
  // agent:bootstrap - 注入 recall 上下文
  if (event.type === "agent" && event.action === "bootstrap") {
    const recall = getRecallContext();
    
    const injection = `\n[MEMORY_RECALL]\n最近24小时记忆：\n${recall}\n[/MEMORY_RECALL]\n`;
    
    return { injection };
  }
  
  return null;
}
