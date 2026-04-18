import { AIRouter, type AIRouterConfig } from '@isaced/ai-router';
import { Hono } from 'hono';

const app = new Hono()

const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL;

if (!OPENAI_API_BASE_URL || !OPENAI_API_KEY || !LLM_MODEL) {
  throw new Error('Missing required environment variables');
}

const routerConfig: AIRouterConfig = {
  providers: [
    {
      name: 'TestProvider',
      endpoint: OPENAI_API_BASE_URL,
      accounts: [
        {
          apiKey: OPENAI_API_KEY,
          models: [
            {
              name: LLM_MODEL,
              rateLimit: {
                rpm: 3,
              }
            }
          ],
        }
      ],
    }
  ],
  strategy: 'rate-limit-aware'
};

const router = new AIRouter(routerConfig);

/**
 * Chat completion endpoint
 */
app.post('/v1/chat/completions', async (c) => {
  try {
    const body = await c.req.json()
    const response = await router.chat({
      messages: body.messages
    })
    return c.json(response);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Get usage statistics
 */
app.get('/stats', async (c) => {
  return c.json(await router.getUsageOverview());
});

export default app