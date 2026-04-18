# ai-router 🤖🔄

[![npm version](https://badge.fury.io/js/@isaced%2Fai-router.svg)](https://www.npmjs.com/package/@isaced/ai-router) [![JSR](https://jsr.io/badges/@isaced/ai-router)](https://jsr.io/@isaced/ai-router)

[English](README.md) | [简体中文](README.zh-CN.md)

**A lightweight, framework-agnostic router for AI/LLM API requests.**

Distribute traffic across multiple providers (OpenAI, Anthropic, Gemini, etc.), accounts, and models with built-in **load balancing**, **failover**, and **easy extensibility**.

Perfect for developers building resilient, scalable AI applications without vendor lock-in.

> 🚀 One interface. Multiple backends. Zero downtime.

## ✨ Features

- ✅ **Multi-provider support**: OpenAI, Anthropic, Google Gemini, Azure, and more (or your own)
- 🔁 **Load balancing**: Random, or least-loaded distribution across keys/accounts
- 🛟 **Failover & retry**: Automatically switch to backup providers on error or timeout
- 🧩 **Pluggable middleware**: Add auth, logging, rate limiting, caching, etc.
- ⚡ **Lightweight & dependency-free**: Works in Node.js, serverless, and edge runtimes
- 📦 **Framework-agnostic**: Use with Hono, Express, Fastify or standalone
- 💻 **TypeScript ready**: Full type definitions included
- 🔄 **Zero dependencies**: 0 dependencies

## 📦 Installation

```bash
npm install @isaced/ai-router
```

## 🚀 Quick Start

```ts
import { AIRouter } from '@isaced/ai-router';

// Define your providers and API keys
const router = new AIRouter({
  providers: [
    {
      name: 'openai-primary',
      type: 'openai',
      endpoint: 'https://api.openai.com/v1',
      accounts: [
        {
          apiKey: 'sk-xxx',
          models: [
            // Simple model configuration (no rate limits)
            'gpt-4-turbo',
            // Advanced model configuration with per-model rate limits
            {
              name: 'gpt-4',
              rateLimit: {
                rpm: 100,  // 100 requests per minute
                tpm: 80000, // 80k tokens per minute
                rpd: 2000   // 2000 requests per day
              }
            },
            {
              name: 'gpt-3.5-turbo',
              rateLimit: {
                rpm: 500,   // Higher rate limit for cheaper model
                tpm: 200000
              }
            }
          ]
        },
        {
          apiKey: 'sk-yyy',
          models: ['gpt-3.5-turbo'] // No rate limits for this account
        }
      ],
    },
    {
      name: 'custom-provider',
      type: 'custom',
      endpoint: 'https://your-custom-api.com/v1',
      accounts: [
        {
          apiKey: 'custom-key-1',
          models: [
            {
              name: 'custom-model-1',
              rateLimit: {
                rpm: 50,
                tpm: 30000
              }
            },
            'custom-model-2' // No rate limits
          ]
        }
      ]
    }
  ],
  strategy: 'rate-limit-aware' // Use rate-limit aware strategy for automatic load balancing
});

// Route a chat completion request
const response = await router.chat({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }]
});

console.log(response);
```

## 🎯 Per-Model Rate Limiting

AI Router now supports per-model rate limiting, allowing you to set different rate limits for different models:

```ts
const router = new AIRouter({
  providers: [
    {
      name: 'provider',
      accounts: [
        {
          apiKey: 'your-key',
          models: [
            // High-end model with strict limits
            {
              name: 'gpt-4',
              rateLimit: {
                rpm: 50,    // 50 requests per minute
                tpm: 40000, // 40k tokens per minute
                rpd: 1000   // 1000 requests per day
              }
            },
            // Cheaper model with relaxed limits
            {
              name: 'gpt-3.5-turbo',
              rateLimit: {
                rpm: 200,
                tpm: 150000
              }
            },
            // No rate limits for this model
            'claude-instant'
          ]
        }
      ]
    }
  ],
  strategy: 'rate-limit-aware'
});
```

### Rate Limit Types

- **`rpm`**: Requests Per Minute - Maximum number of API calls per minute
- **`tpm`**: Tokens Per Minute - Maximum number of input tokens per minute  
- **`rpd`**: Requests Per Day - Maximum number of API calls per day

The router will automatically select the best available model that can handle your request without exceeding rate limits.

## ⚙️ Advanced: Middleware

Extend behavior with middleware:

```ts
router.use(async (req, next) => {
  console.log('Outgoing request:', req.url);
  const start = Date.now();
  const res = await next(req);
  console.log('Response time:', Date.now() - start, 'ms');
  return res;
});

// Add rate limiting
router.use(rateLimit({ max: 1000 / 60 })); // 1000 RPM
```

Build your own for caching, tracing, or authentication.

## 🔁 Load Balancing Strategies

```ts
new AIRouter({
  providers: [...],
  strategy: 'random' // or 'least-loaded'
})
```

- `random`: Random pick (fast)
- `least-loaded`: Pick least busy (requires health tracking)

## 🧪 Running in Serverless / Edge

Works seamlessly in Vercel, Cloudflare Workers, Netlify, etc.:

```ts
// api/chat.js (Vercel Function)
export default async function handler(req, res) {
  const { messages } = req.body;
  const response = await router.chat({ model: 'gpt-4', messages });
  res.json(response);
}
```

## 📚 Examples

Explore examples to see how to integrate `ai-router` with different frameworks and use cases:

- [Hono AI Router Example](./examples/hono-ai-router/): Demonstrates how to use `ai-router` with the Hono web framework for managing multiple AI providers with rate limiting and load balancing. This example also supports OpenAI-compatible APIs.

## 🛠️ Development

```bash
git clone https://github.com/isaced/ai-router.git
cd ai-router
npm install
npm run build
npm test
```

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for details.


## 📄 License

MIT

---

> 🌐 Route your AI. Balance your load. Avoid your limits.
>
> Made with ❤️ for developers building the future of AI.
