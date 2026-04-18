/**
 * A map of provider names to their API endpoints.
 */
export const ProviderEndpoints = {
  openai: "https://api.openai.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
  anthropic: "https://api.anthropic.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
  cerebras: "https://api.cerebras.ai/v1",
  dashscope: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  ollama: "http://localhost:11434/v1",
}

/**
 * Get the API endpoint for a specific provider.
 * @param provider - The name of the provider.
 * @returns The API endpoint URL.
 */
export function getProviderEndpoint(provider: string): string {
  const endpoint = ProviderEndpoints[provider as keyof typeof ProviderEndpoints];
  if (!endpoint) {
    throw new Error(`Provider ${provider} is not supported, or endpoint is not configured.`);
  }
  return endpoint;
}