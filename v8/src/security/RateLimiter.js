class RateLimiter {
  constructor(maxPerSecond = 2) {
    this.maxTokens = maxPerSecond;
    this.refillInterval = 1000 / maxPerSecond;
    this.buckets = new Map();
    
    // M4 修复：定期清理过期 bucket，防止内存泄漏
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, 60000); // 每 60 秒清理一次
  }

  /**
   * 销毁函数：清理定时器
   */
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  tryAcquire(key) {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    const elapsed = now - bucket.lastRefill;
    const tokensToAdd = Math.floor(elapsed / this.refillInterval);
    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(this.maxTokens, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  cleanup(maxAgeMs = 3600000) {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefill > maxAgeMs) {
        this.buckets.delete(key);
      }
    }
  }
}

module.exports = { RateLimiter };
