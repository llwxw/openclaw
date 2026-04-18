import type { AIRouterConfig, ProviderModel, Account } from '../types/types';
import type { ChatRequest } from '../types/chat';
import type { RateLimitManager } from './RateLimitManager';
import { getProviderEndpoint } from './providers';

/**
 * Enhanced provider model with account information
 */
export interface ProviderModelWithAccount extends ProviderModel {
    account: Account;
}

/**
 * Selects a provider model based on the configuration.
 * 
 * @param config - The configuration for the router.
 * @param rateLimitManager - The rate limit manager instance.
 * @param request - Optional chat request for token estimation.
 * @returns The selected provider model.
 */
export async function selectProvider(
    config: AIRouterConfig,
    rateLimitManager?: RateLimitManager,
    request?: ChatRequest
): Promise<ProviderModel> {
    if (!config.providers || config.providers.length === 0) {
        throw new Error('No providers configured');
    }

    // Flatten the providers structure with account information
    const providerModels: Array<ProviderModelWithAccount> = config.providers.flatMap(provider =>
        provider.accounts.flatMap(account =>
            account.models.map(modelConfig => {
                const modelName = typeof modelConfig === 'string' ? modelConfig : modelConfig.name;
                return {
                    model: modelName,
                    endpoint: provider.endpoint ?? getProviderEndpoint(provider.name),
                    apiKey: account.apiKey,
                    account
                };
            })
        )
    );

    // Random strategy
    if (config.strategy === 'random' || !config.strategy) {
        return providerModels[Math.floor(Math.random() * providerModels.length)];
    }

    // Rate-limit aware strategy
    if (config.strategy === 'rate-limit-aware') {
        if (!rateLimitManager) {
            throw new Error('Rate limit manager is required for rate-limit-aware strategy');
        }
        return await selectRateLimitAwareProvider(providerModels, rateLimitManager, request);
    }

    throw new Error('Unknown strategy');
}

/**
 * Select provider using rate-limit aware strategy
 */
async function selectRateLimitAwareProvider(
    providerModels: ProviderModelWithAccount[],
    rateLimitManager: RateLimitManager,
    request?: ChatRequest
): Promise<ProviderModel> {

    // Estimate tokens for the request
    const estimatedTokens = request
        ? rateLimitManager.estimateTokens(request)
        : 0;

    // Filter available providers that can handle the request
    const availableProviders: ProviderModelWithAccount[] = [];

    for (const pm of providerModels) {
        const canHandle = await rateLimitManager.canHandleRequest(pm.account, pm.model, estimatedTokens);
        if (canHandle) {
            availableProviders.push(pm);
        }
    }

    if (availableProviders.length === 0) {
        throw new Error('All accounts have exceeded their rate limits');
    }

    // Calculate availability scores for load balancing
    const scored: Array<{ provider: ProviderModelWithAccount; score: number }> = [];

    for (const pm of availableProviders) {
        const score = await rateLimitManager.getAvailabilityScore(pm.account, pm.model);
        scored.push({ provider: pm, score });
    }

    // Sort by score (highest first) and select the best one
    scored.sort((a, b) => b.score - a.score);

    return scored[0].provider;
}