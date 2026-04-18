import type { AIRouterConfig, UsageItem, UsageOverview } from "./types/types";
import type { ChatRequest } from "./types/chat";
import type { ChatCompletion } from "./types/completions";
import { selectProvider } from "./core/selectProvider";
import { sendRequest } from "./core/sendRequest";
import type { Middleware } from "./types/middleware";
import { RateLimitManager } from "./core/RateLimitManager";

/**
 * A lightweight, framework-agnostic router for AI/LLM API requests.
 *
 * Distribute traffic across multiple providers (OpenAI, Anthropic, Gemini, etc.),
 * accounts, and models with built-in **load balancing**, **failover**, and **easy extensibility**.
 *
 * @class AIRouter
 * @example
 * ```
 * const config = {
 *   providers: [
 *     {
 *       name: 'provider1',
 *       type: 'openai',
 *       endpoint: 'https://api.provider1.com',
 *       accounts: [{
 *         apiKey: 'key1',
 *         models: [
 *           'gpt-3.5-turbo', // Simple string model
 *           {                // Model with rate limits
 *             name: 'gpt-4',
 *             rateLimit: { rpm: 100 }
 *           }
 *         ]
 *       }]
 *     }
 *   ],
 *   strategy: 'rate-limit-aware'
 * };
 * const router = new AIRouter(config);
 * ```
 */
class AIRouter {

  /**
   * Configuration object for the router.
   */
  private config: AIRouterConfig;

  /**
   * Rate limit manager instance for this router.
   */
  private rateLimitManager: RateLimitManager;

  /**
   * List of middleware functions to use.
   */
  private middlewares: Middleware[] = [];

  /**
   * Creates an instance of AIRouter.
   *
   * @param {AIRouterConfig} config - Configuration object for the router
   * @param {Provider[]} config.providers - List of AI service providers
   * @param {'random' | 'rate-limit-aware'} [config.strategy='random'] - Strategy for selecting providers
   */
  constructor(config: AIRouterConfig = { providers: [], strategy: "random" }) {
    this.config = config;
    this.rateLimitManager = new RateLimitManager(config.usageStorage);
  }

  /**
   * Adds middleware to process requests before they are routed to providers.
   *
   * @param {Middleware} middleware - Middleware function to add
   * @returns {AIRouter} The router instance for chaining
   */
  use(middleware: Middleware): AIRouter {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Sends a chat request to an appropriate AI provider based on the configured strategy.
   * Uses onion model middleware pattern similar to Koa.js
   *
   * @param {ChatRequest} request - Chat request object
   * @param {string} request.model - Model to use for the request
   * @param {{role: string, content: string}[]} request.messages - Array of messages
   * @returns {Promise<ChatCompletion.ChatCompletion>} Promise resolving to the chat response
   * @throws {Error} If no provider is found for the requested model
   */
  async chat(request: ChatRequest): Promise<ChatCompletion.ChatCompletion> {
    const middlewares = this.middlewares || [];

    // Build onion model middleware call chain
    const dispatch = async (i: number, req: ChatRequest): Promise<ChatCompletion.ChatCompletion> => {
      if (i >= middlewares.length) {
        // Last layer: actual AI request processing
        const providerModel = await selectProvider(this.config, this.rateLimitManager, req);
        if (!providerModel) {
          throw new Error("No provider model found for the request");
        }
        return await sendRequest(providerModel, req, this.config, this.rateLimitManager);
      }

      const currentMiddleware = middlewares[i];
      return await currentMiddleware(req, (nextReq: ChatRequest) => dispatch(i + 1, nextReq));
    };
    return await dispatch(0, request);
  }

  // Intentionally left without private methods; logic lives in src/core/* modules

  /**
   * Get the rate limit manager instance (for testing purposes)
   * @internal
   */
  getRateLimitManager(): RateLimitManager {
    return this.rateLimitManager;
  }

  /**
   * Get current usage overview for all configured accounts and models
   * This provides visibility into rate limit status and usage across all providers
   *
   * @returns {Promise<UsageOverview>} Current usage data for all accounts and models
   */
  async getUsageOverview(): Promise<UsageOverview> {
    const data: UsageItem[] = [];

    for (const provider of this.config.providers) {
      for (const account of provider.accounts) {
        for (const modelConfig of account.models) {
          const modelName = typeof modelConfig === 'string' ? modelConfig : modelConfig.name;
          const rateLimit = typeof modelConfig === 'string' ? undefined : modelConfig.rateLimit;

          const id = this.rateLimitManager.getAccountModelIdentifier(account, modelName);
          const usage = await this.rateLimitManager.getUsage(account, modelName);
            if (usage) {
              data.push({
                id,
                model: modelName,
                rateLimit,
                usage,
              });
            }
        }
      }
    }

    return {
      data,
      timestamp: Date.now()
    };
  }
}

export default AIRouter;
