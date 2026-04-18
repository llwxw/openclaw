/**
 * OpenCLaw 保护层 - 熔断器与限流
 */

class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || 5;
    this.timeoutSec = options.timeoutSec || 30;
    this.halfOpenSuccesses = options.halfOpenSuccesses || 3;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failures = 0;
    this.lastFailure = 0;
    this.successesInHalf = 0;
  }

  async call(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailure < this.timeoutSec * 1000) {
        throw new Error(`Circuit breaker ${this.name} is OPEN`);
      }
      this.state = 'HALF_OPEN';
      this.successesInHalf = 0;
    }

    try {
      const result = await fn();
      if (this.state === 'HALF_OPEN') {
        this.successesInHalf++;
        if (this.successesInHalf >= this.halfOpenSuccesses) {
          this.state = 'CLOSED';
          this.failures = 0;
        }
      }
      return result;
    } catch (err) {
      this.failures++;
      this.lastFailure = Date.now();
      if (this.failures >= this.failureThreshold) {
        this.state = 'OPEN';
      }
      throw err;
    }
  }

  getState() {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      lastFailure: this.lastFailure
    };
  }
}

/**
 * 令牌桶限流器
 */
class RateLimiter {
  constructor(tokensPerSec = 2, maxTokens = 10) {
    this.tokens = maxTokens;
    this.maxTokens = maxTokens;
    this.rate = tokensPerSec;
    this.lastRefill = Date.now();
  }

  acquire() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.rate);
    this.lastRefill = now;
    
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  getStatus() {
    return {
      tokens: this.tokens.toFixed(2),
      maxTokens: this.maxTokens,
      rate: this.rate
    };
  }
}

// 导出
export const circuitBreaker = (name, options) => new CircuitBreaker(name, options);
export const rateLimiter = (tokensPerSec, maxTokens) => new RateLimiter(tokensPerSec, maxTokens);
export { CircuitBreaker, RateLimiter };

export default { CircuitBreaker, RateLimiter, circuitBreaker, rateLimiter };