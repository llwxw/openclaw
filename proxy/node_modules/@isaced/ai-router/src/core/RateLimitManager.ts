import type { Account, UsageStorage, UsageData, RateLimit } from '../types/types';
import type { ChatRequest } from '../types/chat';
import { MemoryUsageStorage } from './MemoryUsageStorage';
import { TokenEstimator } from '../utils/tokenEstimator';

/**
 * Rate limit manager with pluggable storage backend
 */
export class RateLimitManager {
    private storage: UsageStorage;
    private tokenEstimator: TokenEstimator;

    constructor(storage?: UsageStorage) {
        this.storage = storage || new MemoryUsageStorage();
        this.tokenEstimator = new TokenEstimator();
    }

    /**
     * Get account model identifier
     */
    getAccountModelIdentifier(account: Account, model: string): string {
        return this.hash(`${account.apiKey}-${model}`);
    }

    /**
     * Hash a string using a simple hash function
     */
    private hash(input: string): string {
        let hash = 0;
        for (let i = 0; i < input.length; i++) {
            const char = input.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString();
    }

    /**
     * Get current usage data, automatically reset if needed
     */
    private async getCurrentUsage(id: string): Promise<UsageData> {
        let usage = await this.storage.get(id);

        if (!usage) {
            // Initialize new usage data
            const now = Date.now();
            usage = {
                id,
                requestsThisMinute: 0,
                tokensThisMinute: 0,
                requestsToday: 0,
                lastResetTime: {
                    minute: Math.floor(now / 60000),
                    day: Math.floor(now / 86400000)
                }
            };
        }

        // Check if we need to reset counters
        const now = Date.now();
        const currentMinute = Math.floor(now / 60000);
        const currentDay = Math.floor(now / 86400000);
        let needsUpdate = false;

        // Reset minute counters
        if (usage.lastResetTime.minute !== currentMinute) {
            usage.requestsThisMinute = 0;
            usage.tokensThisMinute = 0;
            usage.lastResetTime.minute = currentMinute;
            needsUpdate = true;
        }

        // Reset day counters
        if (usage.lastResetTime.day !== currentDay) {
            usage.requestsToday = 0;
            usage.lastResetTime.day = currentDay;
            needsUpdate = true;
        }

        // Save back if we made changes
        if (needsUpdate) {
            await this.storage.set(id, usage);
        }

        return usage;
    }

    /**
     * Get model rate limit configuration from account
     */
    private getModelRateLimit(account: Account, model: string): RateLimit | undefined {
        for (const modelConfig of account.models) {
            if (typeof modelConfig === 'string') {
                if (modelConfig === model) {
                    return undefined; // No rate limit for string-only model configuration
                }
            } else {
                if (modelConfig.name === model) {
                    return modelConfig.rateLimit;
                }
            }
        }
        return undefined;
    }

    /**
     * Check if account can handle the request
     */
    async canHandleRequest(account: Account, model: string, estimatedTokens: number = 0): Promise<boolean> {
        const rateLimit = this.getModelRateLimit(account, model);
        if (!rateLimit) {
            return true; // No limits configured
        }

        const accountId = this.getAccountModelIdentifier(account, model);
        const usage = await this.getCurrentUsage(accountId);
        const limits = rateLimit;

        // Check RPM
        if (limits.rpm !== undefined && usage.requestsThisMinute >= limits.rpm) {
            return false;
        }

        // Check TPM
        if (limits.tpm !== undefined && (usage.tokensThisMinute + estimatedTokens) > limits.tpm) {
            return false;
        }

        // Check RPD
        if (limits.rpd !== undefined && usage.requestsToday >= limits.rpd) {
            return false;
        }

        return true;
    }

    /**
     * Record request usage with atomic operation when available
     */
    async recordRequest(account: Account, model: string, tokensUsed: number = 0): Promise<void> {
        const accountId = this.getAccountModelIdentifier(account, model);

        // Fallback to read-modify-write (not atomic)
        const usage = await this.getCurrentUsage(accountId);
        usage.requestsThisMinute += 1;
        usage.tokensThisMinute += tokensUsed;
        usage.requestsToday += 1;
        await this.storage.set(accountId, usage);
    }

    /**
     * Get availability score for load balancing (0-1, higher is better)
     */
    async getAvailabilityScore(account: Account, model: string): Promise<number> {
        const rateLimit = this.getModelRateLimit(account, model);
        if (!rateLimit) {
            return 1.0; // No limits = highest score
        }

        const accountId = this.getAccountModelIdentifier(account, model);
        const usage = await this.getCurrentUsage(accountId);
        const limits = rateLimit;
        let score = 1.0;

        // RPM availability
        if (limits.rpm !== undefined) {
            const remaining = Math.max(0, limits.rpm - usage.requestsThisMinute);
            score *= remaining / limits.rpm;
        }

        // TPM availability
        if (limits.tpm !== undefined) {
            const remaining = Math.max(0, limits.tpm - usage.tokensThisMinute);
            score *= remaining / limits.tpm;
        }

        // RPD availability
        if (limits.rpd !== undefined) {
            const remaining = Math.max(0, limits.rpd - usage.requestsToday);
            score *= remaining / limits.rpd;
        }

        return score;
    }

    /**
     * Estimate tokens for a request
     */
    estimateTokens(request: ChatRequest): number {
        return this.tokenEstimator.estimateInputTokens(request);
    }

    /**
     * Get current usage data for an account (useful for monitoring)
     */
    async getUsage(account: Account, model: string): Promise<UsageData | null> {
        const accountId = this.getAccountModelIdentifier(account, model);
        return await this.getCurrentUsage(accountId);
    }
}
