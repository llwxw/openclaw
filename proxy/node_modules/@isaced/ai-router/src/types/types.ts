import type { ProviderEndpoints } from "../core/providers";

/**
 * Rate limiting configuration for an account and model
 */
export interface RateLimit {
  /**
   * Requests per minute limit
   */
  rpm?: number;

  /**
   * Tokens per minute limit (input tokens)
   */
  tpm?: number;

  /**
   * Requests per day limit
   */
  rpd?: number;
}

/**
 * Usage data for a specific account and model
 */
export interface UsageData {
  /**
   * Unique identifier for the account and model combination
   */
  id: string;

  /**
   * Number of requests made in the current minute
   */
  requestsThisMinute: number;

  /**
   * Number of tokens used in the current minute
   */
  tokensThisMinute: number;

  /**
   * Number of requests made today
   */
  requestsToday: number;

  /**
   * Timestamp of the last reset (in minutes)
   */
  lastResetTime: {

    /**
     * Timestamp of the last reset (in minutes)
     */
    minute: number;

    /**
     * Timestamp of the last reset (in days)
     */
    day: number;
  };
}

/**
 * Abstract interface for storing and retrieving usage data
 */
export interface UsageStorage {
  /**
   * Get usage data for a specific account and model
   */
  get(accountModelId: string): Promise<UsageData | null>;

  /**
   * Set usage data for a specific account and model
   */
  set(accountModelId: string, usage: UsageData): Promise<void>;
}

/**
 * Model configuration with optional rate limiting
 */
export interface ModelConfig {
  /**
   * Model name
   */
  name: string;

  /**
   * Rate limiting configuration for this model
   */
  rateLimit?: RateLimit;
}

/**
 * Account configuration for an AI service provider.
 */
export interface Account {
  /**
   * API key for the account.
   */
  apiKey: string;

  /**
   * List of models supported by the account.
   * Can be either strings (for backward compatibility) or ModelConfig objects (for per-model rate limiting)
   */
  models: (string | ModelConfig)[];
}

/**
 * Configuration for an AI service provider.
 */
export interface Provider {
  /**
   * Name of the provider.
   */
  name: string;

  /**
   * Type of the provider.
   * Corresponds to the keys of the ProviderEndpoints map.
   * Used to determine the API endpoint for the provider.
   */
  type?: keyof typeof ProviderEndpoints;

  /**
   * Endpoint for the provider's API.
   * If not specified, the endpoint will be derived from the provider's type.
   */
  endpoint?: string;

  /**
   * List of accounts for the provider.
   */
  accounts: Account[];
}

/**
 * Configuration for a model of an AI service provider.
 */
export interface ProviderModel {
  /**
   * Model name.
   */
  model: string;

  /**
   * Endpoint for the model.
   */
  endpoint: string;

  /**
   * API key for the model.
   */
  apiKey: string;
}

/**
 * Usage data for a specific account and model
 */
export interface UsageItem {
  /**
   * Unique identifier for the account and model combination
   */
  id: string;

  /**
   * Model name.
   */
  model: string;

  /**
   * Rate limiting configuration for this account
   */
  rateLimit?: RateLimit;

  /**
   * Usage data for this account and model
   */
  usage: UsageData
}

/**
 * Overall usage overview for all accounts and models
 */
export interface UsageOverview {
  /**
   * Usage data for all accounts and models
   */
  data: UsageItem[];

  /**
   * Timestamp when the overview was generated
   */
  timestamp: number;
}

/**
 * Configuration for the AIRouter.
 */
export interface AIRouterConfig {
  /**
   * List of providers to use.
   */
  providers: Provider[];

  /**
   * Strategy for selecting providers.
   *
   * @default 'random'
   *
   * 'random':
   *   Select a provider randomly for each request.
   *   This strategy does not consider rate limits and is suitable for simple load balancing.
   *
   * 'rate-limit-aware':
   *   Select a provider based on current usage and rate limits,
   *   automatically avoiding accounts that are close to or have exceeded their limits.
   *   This strategy requires the 'rateLimit' field to be set for each account to work properly.
   *   Rate limit tracking is performed per apiKey + model combination.
   */
  strategy?: "random" | "rate-limit-aware";

  /**
   * Custom storage adapter for usage data
   */
  usageStorage?: UsageStorage;
}
