// context_protector.js
const fs = require('fs').promises;
const path = require('path');
const STORAGE = path.join(process.env.HOME, '.openclaw', 'context.json');

class ContextProtector {
 constructor() { this.messages = []; this.totalChars = 0; this.totalTokens = 0; this.lastSummarize = 0; this.load(); }
 async load() { try { const d = JSON.parse(await fs.readFile(STORAGE)); Object.assign(this, d); } catch(e) {} }
 async save() { await fs.writeFile(STORAGE, JSON.stringify({ messages: this.messages.slice(-200), totalChars: this.totalChars, totalTokens: this.totalTokens, lastSummarize: this.lastSummarize })); }
 estimateTokens(t) { const ch = (t.match(/[\u4e00-\u9fa5]/g)||[]).length; return Math.ceil(ch/1.5 + (t.length-ch)/4); }
 async addMessage(role, content, taskId) {
 const tokens = this.estimateTokens(content);
 this.messages.push({ role, content, timestamp: Date.now(), taskId, tokens });
 this.totalChars += content.length; this.totalTokens += tokens;
 if (this.messages.length > 50 && Date.now() - this.lastSummarize > 120000) await this.summarize();
 await this.save();
 }
 async summarize() {
 const old = this.messages.slice(0, -10);
 const summary = `[Auto] ${old.length} msgs: ${old.map(m=>m.content.slice(0,30)).join('; ')}`;
 this.messages = [{ role:'system', content:`Summarized at ${new Date().toISOString()}: ${summary}`, tokens:0 }, ...this.messages.slice(-10)];
 this.totalChars = this.messages.reduce((s,m)=>s+(m.content?.length||0),0);
 this.totalTokens = this.messages.reduce((s,m)=>s+(m.tokens||0),0);
 this.lastSummarize = Date.now();
 console.log('[Context] Summarized', old.length);
 }
}

module.exports = new ContextProtector();