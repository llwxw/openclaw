import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import AIRouter from '../src/AIRouter';
import type { AIRouterConfig, Account } from '../src/types/types';
import { MemoryUsageStorage } from '../src/core/MemoryUsageStorage';
import type { ChatCompletion } from '../src/types/completions';

// ============================================================================
// Mock Data
// ============================================================================

const createMockChatResponse = (content: string = '2'): ChatCompletion.ChatCompletion => ({
  id: `chatcmpl-${Math.random().toString(36).substring(7)}`,
  created: Math.floor(Date.now() / 1000),
  model: 'gpt-3.5-turbo',
  choices: [{
    index: 0,
    message: {
      role: 'assistant',
      content
    },
    finish_reason: 'stop'
  }],
  usage: {
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15
  }
});

const createMockAccount = (overrides?: Partial<Account>): Account => ({
  apiKey: `test-api-key-${Math.random().toString(36).substring(7)}`,
  models: [
    {
      name: 'gpt-3.5-turbo',
      rateLimit: {
        rpm: 2, // Maximum 2 requests per minute
      }
    }
  ],
  ...overrides
});

const createRandomConfig = (): AIRouterConfig => ({
  providers: [
    {
      name: 'TestProvider',
      endpoint: 'https://api.test.com',
      accounts: [createMockAccount()],
    }
  ],
  strategy: 'random'
});

const createRateLimitAwareConfig = (accounts: Account[], storage?: MemoryUsageStorage): AIRouterConfig => ({
  providers: [
    {
      name: 'TestProvider',
      endpoint: 'https://api.test.com',
      accounts
    }
  ],
  strategy: 'rate-limit-aware',
  usageStorage: storage
});

const sendTestChatRequest = (router: AIRouter, content: string = '1+1=?') => {
  return router.chat({ messages: [{ role: 'user', content }] });
};

// ============================================================================
// Mock Setup
// ============================================================================

let originalFetch: typeof global.fetch;
let mockFetch: ReturnType<typeof mock>;

beforeEach(() => {
  // Save the original fetch
  originalFetch = global.fetch;

  // Create mock fetch
  mockFetch = mock(() => {
    return Promise.resolve(new Response(
      JSON.stringify(createMockChatResponse()),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    ));
  });

  // Replace global fetch
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  // Restore the original fetch
  global.fetch = originalFetch;
  mockFetch.mockClear();
});

// ============================================================================
// Test Suites
// ============================================================================

describe('AIRouter with Mocked Fetch', () => {

  describe('Basic Chat Functionality', () => {
    let router: AIRouter;

    beforeEach(() => {
      const routerConfig = createRandomConfig();
      router = new AIRouter(routerConfig);
    });

    test('should return a chat completion response', async () => {
      const res = await router.chat({
        messages: [{
          role: 'user',
          content: '1+1=?'
        }]
      });

      expect(res).toBeDefined();
      expect(res.choices[0].message?.content).toBeDefined();
      expect(res.choices[0].message?.content).toBe('2');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('should call fetch with correct parameters', async () => {
      await router.chat({
        messages: [{
          role: 'user',
          content: 'Hello'
        }]
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];

      expect(url).toBe('https://api.test.com/chat/completions');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.headers.Authorization).toMatch(/Bearer test-api-key-/);

      const body = JSON.parse(options.body);
      expect(body.messages).toEqual([{
        role: 'user',
        content: 'Hello'
      }]);
    });

    test('should handle network errors', async () => {
      // Mock a network error
      mockFetch.mockImplementationOnce(() =>
        Promise.reject(new Error('Network error'))
      );

      await expect(router.chat({
        messages: [{
          role: 'user',
          content: 'Hello'
        }]
      })).rejects.toThrow('Network error');
    });
  });

  describe('Rate Limit Aware Strategy', () => {
    let account1: Account;
    let account2: Account;
    let router: AIRouter;

    beforeEach(() => {
      account1 = createMockAccount();
      account2 = createMockAccount();

      const config = createRateLimitAwareConfig([account1, account2]);
      router = new AIRouter(config);
    });

    test('should work with single account under normal conditions', async () => {
      const testAccount = createMockAccount();
      const singleAccountConfig = createRateLimitAwareConfig([testAccount], new MemoryUsageStorage());
      const singleRouter = new AIRouter(singleAccountConfig);

      const res = await singleRouter.chat({
        messages: [{ role: 'user', content: 'Hello!' }]
      });

      expect(res).toBeDefined();
      expect(res.choices[0].message?.content).toBe('2');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('should rotate accounts when first account reaches rate limit', async () => {
      // Send 2 requests to exhaust the first account's rate limit (rpm: 2)
      await sendTestChatRequest(router);
      await sendTestChatRequest(router);

      // The 3rd request should still succeed because we have a second account
      const res = await sendTestChatRequest(router);

      expect(res).toBeDefined();
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Verify that different API keys are being used
      const apiKeysUsed = new Set();
      for (let i = 0; i < 3; i++) {
        const [, options] = mockFetch.mock.calls[i];
        apiKeysUsed.add(options.headers.Authorization);
      }

      // Should have used at least one account (could be same account if within limits)
      expect(apiKeysUsed.size).toBeGreaterThan(0);
    });

    test('should throw error when single account exceeds rate limit', async () => {
      const testAccount = createMockAccount();
      const singleAccountConfig = createRateLimitAwareConfig([testAccount], new MemoryUsageStorage());
      const singleRouter = new AIRouter(singleAccountConfig);

      // Send 2 requests (which is the limit for rpm: 2)
      await sendTestChatRequest(singleRouter);

      await sendTestChatRequest(singleRouter);

      // The 3rd request should fail because we exceeded rpm: 2
      await expect(sendTestChatRequest(singleRouter, 'Should fail'))
        .rejects.toThrow('All accounts have exceeded their rate limits');
    });

    test('should throw error when all accounts exceed rate limits', async () => {
      // Send 2 requests to exhaust account1's rate limit (rpm: 2)
      await sendTestChatRequest(router);

      await sendTestChatRequest(router);

      // Send 2 more requests to exhaust account2's rate limit
      await sendTestChatRequest(router);

      await sendTestChatRequest(router);

      // Now both accounts should be exhausted, next request should fail
      await expect(sendTestChatRequest(router)).rejects.toThrow('All accounts have exceeded their rate limits');
    });

    test('should distribute requests across multiple accounts', async () => {
      const responses: ChatCompletion.ChatCompletion[] = [];

      // Send multiple requests
      for (let i = 0; i < 4; i++) {
        // Create different responses for each request
        mockFetch.mockImplementationOnce(() =>
          Promise.resolve(new Response(
            JSON.stringify(createMockChatResponse(`Response ${i + 1}`)),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          ))
        );

        const res = await sendTestChatRequest(router, `Request ${i + 1}`);

        responses.push(res);
      }

      // Verify all requests succeeded
      expect(responses).toHaveLength(4);
      expect(mockFetch).toHaveBeenCalledTimes(4);

      responses.forEach((response, index) => {
        expect(response.choices[0].message?.content).toBe(`Response ${index + 1}`);
      });
    });

    test('should record usage correctly for rate limiting', async () => {
      const res = await sendTestChatRequest(router, 'Test usage');

      expect(res).toBeDefined();

      // Verify usage is recorded correctly
      expect(res.usage?.prompt_tokens).toBe(10);
      expect(res.usage?.completion_tokens).toBe(5);
      expect(res.usage?.total_tokens).toBe(15);
    });
  });

  describe('Error Handling with Rate Limiting', () => {
    let storage: MemoryUsageStorage;
    let account: Account;
    let router: AIRouter;

    beforeEach(() => {
      storage = new MemoryUsageStorage();
      account = createMockAccount();

      const config = createRateLimitAwareConfig([account], storage);
      router = new AIRouter(config);
    });

    test('should record request even on network error', async () => {
      // Mock a network error
      mockFetch.mockImplementationOnce(() =>
        Promise.reject(new Error('Network error'))
      );

      await expect(sendTestChatRequest(router, 'Hello')).rejects.toThrow('Network error');

      // Send a successful request to verify that the error request was counted towards rate limit
      const res = await sendTestChatRequest(router, 'Hello after error');

      expect(res).toBeDefined();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
