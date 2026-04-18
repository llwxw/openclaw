const EventEmitter = require('events');

class ContextProtector extends EventEmitter {
  constructor(config) {
    super();
    this.maxTokens = config.context.maxContextTokens || 128000;
    this.summarizeThreshold = config.context.summarizeThreshold || 0.8;
    this.chunkSize = config.context.chunkSize || 4096;
  }

  estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }

  async protectContext(messages, newMessage) {
    const fullContext = [...messages, newMessage];
    let totalText = fullContext.map(m => m.content).join('\n');
    let tokenCount = this.estimateTokens(totalText);

    if (tokenCount > this.maxTokens * this.summarizeThreshold) {
      this.emit('summarize:triggered', { tokenCount, threshold: this.maxTokens });
      const systemMessages = messages.filter(m => m.role === 'system');
      const recentMessages = messages.slice(-5);
      const summary = await this._summarize(messages.slice(0, -5));
      const compressed = [
        ...systemMessages,
        { role: 'assistant', content: `[Previous conversation summary: ${summary}]` },
        ...recentMessages,
        newMessage
      ];
      totalText = compressed.map(m => m.content).join('\n');
      tokenCount = this.estimateTokens(totalText);
      return { messages: compressed, tokenCount, summarized: true };
    }

    return { messages: fullContext, tokenCount, summarized: false };
  }

  async _summarize(messages) {
    const text = messages.map(m => `${m.role}: ${m.content}`).join('\n');
    if (text.length > 2000) {
      return text.substring(0, 2000) + '...';
    }
    return text;
  }

  async readFileInChunks(filePath) {
    const fs = require('fs').promises;
    const stats = await fs.stat(filePath);
    const chunks = [];
    let bytesRead = 0;
    const fd = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(this.chunkSize);
    while (bytesRead < stats.size) {
      const { bytesRead: read } = await fd.read(buffer, 0, this.chunkSize, bytesRead);
      if (read === 0) break;
      chunks.push(buffer.slice(0, read).toString('utf8'));
      bytesRead += read;
    }
    await fd.close();
    return chunks.join('');
  }
}

module.exports = { ContextProtector };
