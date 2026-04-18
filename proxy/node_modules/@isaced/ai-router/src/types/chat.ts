/**
 * Chat message interface representing a single message in a conversation.
 */
export interface ChatMessage {
    /**
     * The role of the message sender.
     * 
     * @example "user", "assistant", "system"
     */
    role: string;

    /**
     * The content of the message.
     */
    content?: string;
}

/**
 * Chat request interface for AI chat completions.
 * 
 * This interface defines the structure of a chat request that can be sent
 * to various AI providers through the AI Router. It follows the OpenAI 
 * chat completions API format while allowing flexibility for additional
 * provider-specific parameters.
 */
export interface ChatRequest {
    /**
     * The model to use for the chat completion.
     * 
     * If not specified, the router will select an appropriate model
     * based on the configured providers and strategy.
     * 
     * @example "gpt-4", "gpt-3.5-turbo", "claude-3-opus"
     */
    model?: string;

    /**
     * A list of messages comprising the conversation so far.
     * 
     * Each message should have a role (e.g., "user", "assistant", "system")
     * and content. The conversation history helps provide context for
     * generating appropriate responses.
     */
    messages: ChatMessage[];

    /**
     * Additional properties that may be required by specific providers.
     * 
     * This allows the request to include provider-specific parameters
     * such as temperature, max_tokens, top_p, etc., while maintaining
     * compatibility across different AI providers.
     * 
     * @example { temperature: 0.7, max_tokens: 1000, stream: false }
     */
    [key: string]: unknown;
}
