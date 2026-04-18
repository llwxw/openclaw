import type { ChatRequest } from '../types/chat';

/**
 * Simple token estimation utility
 */
export class TokenEstimator {
    /**
     * Estimate input tokens (approximately 4 characters = 1 token)
     * This is a simple estimation; for production use, consider using
     * a proper tokenizer library like tiktoken
     */
    estimateInputTokens(request: ChatRequest): number {
        const totalChars = request.messages.reduce((sum, msg) => {
            return sum + (msg.content?.length || 0);
        }, 0);

        return Math.ceil(totalChars / 4);
    }
}
