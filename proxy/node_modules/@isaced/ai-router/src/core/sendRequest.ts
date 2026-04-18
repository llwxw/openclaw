import type { ChatCompletion } from '../types/completions';
import type { ProviderModel, AIRouterConfig } from '../types/types';
import type { ChatRequest } from '../types/chat';
import type { ProviderModelWithAccount } from './selectProvider';
import type { RateLimitManager } from './RateLimitManager';

/**
 * Sends a chat request to an AI provider and records usage.
 * 
 * @param providerModel - The provider model to use.
 * @param request - The chat request to send.
 * @param config - The router configuration (optional, for rate limiting).
 * @param rateLimitManager - The rate limit manager instance (optional).
 * @returns The chat completion response.
 */
export async function sendRequest(
    providerModel: ProviderModel,
    request: ChatRequest,
    config?: AIRouterConfig,
    rateLimitManager?: RateLimitManager
): Promise<ChatCompletion.ChatCompletion> {
    const endpoint = providerModel.endpoint;
    const url = `${endpoint}/chat/completions`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${providerModel.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ...request, model: providerModel.model })
        });

        const data = await response.json() as ChatCompletion.ChatCompletion;

        // Record usage if rate limiting is enabled
        if (config?.strategy === 'rate-limit-aware' && rateLimitManager) {
            if ((providerModel as ProviderModelWithAccount).account) {
                const account = (providerModel as ProviderModelWithAccount).account;
                const tokensUsed = data.usage?.prompt_tokens || 0;
                await rateLimitManager.recordRequest(account, providerModel.model, tokensUsed);
            }
        }

        return data;
    } catch (error) {
        // Even on error, record the request for rate limiting
        if (config?.strategy === 'rate-limit-aware' && rateLimitManager) {
            if ((providerModel as ProviderModelWithAccount).account) {
                const account = (providerModel as ProviderModelWithAccount).account;
                await rateLimitManager.recordRequest(account, providerModel.model, 0);
            }
        }
        throw error;
    }
}


