# ai-router 🤖🔄

[![npm version](https://badge.fury.io/js/@isaced%2Fai-router.svg)](https://www.npmjs.com/package/@isaced/ai-router)
[![JSR](https://jsr.io/badges/@isaced/ai-router)](https://jsr.io/@isaced/ai-router)

**一个轻量级、框架无关的 AI/LLM API 请求路由器。**

在多个提供商（OpenAI、Anthropic、Gemini
等）、账户和模型之间分发流量，内置**负载均衡**、**故障转移**和**易于扩展**的特性。

非常适合开发人员构建具有弹性、可扩展的 AI 应用程序，避免供应商锁定。

> 🚀 一个接口。多个后端。零停机时间。

## ✨ 特性

- ✅ **多提供商支持**：OpenAI、Anthropic、Google Gemini、Azure 等（或您自己的）
- 🔁 **负载均衡**：在密钥/账户之间进行随机或最少负载分发
- 🛟 **故障转移和重试**：在错误或超时时自动切换到备用提供商
- 🧩 **可插拔中间件**：添加认证、日志记录、速率限制、缓存等
- ⚡ **轻量级和零依赖**：在 Node.js、无服务器和边缘运行时中工作
- 📦 **框架无关**：与 Hono、Express、Fastify 一起使用或独立使用
- 💻 **TypeScript 就绪**：包含完整的类型定义
- 🔄 **零依赖**：0 个依赖项

## 📦 安装

```bash
npm install @isaced/ai-router
```

## 🚀 快速开始

```ts
import { AIRouter } from "@isaced/ai-router";

// 定义您的提供商和 API 密钥
const router = new AIRouter({
  providers: [
    {
      name: "openai-primary",
      type: "openai",
      endpoint: "https://api.openai.com/v1",
      accounts: [
        {
          apiKey: "sk-xxx",
          models: [
            // 简单模型配置（无速率限制）
            "gpt-4-turbo",
            // 高级模型配置，带有每个模型的速率限制
            {
              name: "gpt-4",
              rateLimit: {
                rpm: 100, // 每分钟 100 个请求
                tpm: 80000, // 每分钟 80k 个令牌
                rpd: 2000, // 每天 2000 个请求
              },
            },
            {
              name: "gpt-3.5-turbo",
              rateLimit: {
                rpm: 500, // 更便宜的模型有更高的速率限制
                tpm: 200000,
              },
            },
          ],
        },
        {
          apiKey: "sk-yyy",
          models: ["gpt-3.5-turbo"], // 此账户没有速率限制
        },
      ],
    },
    {
      name: "custom-provider",
      type: "custom",
      endpoint: "https://your-custom-api.com/v1",
      accounts: [
        {
          apiKey: "custom-key-1",
          models: [
            {
              name: "custom-model-1",
              rateLimit: {
                rpm: 50,
                tpm: 30000,
              },
            },
            "custom-model-2", // 无速率限制
          ],
        },
      ],
    },
  ],
  strategy: "rate-limit-aware", // 使用速率限制感知策略进行自动负载均衡
});

// 路由聊天补全请求
const response = await router.chat({
  model: "gpt-4",
  messages: [{ role: "user", content: "Hello!" }],
});

console.log(response);
```

## 🎯 每个模型的速率限制

AI Router 现在支持每个模型的速率限制，允许您为不同的模型设置不同的速率限制：

```ts
const router = new AIRouter({
  providers: [
    {
      name: "provider",
      accounts: [
        {
          apiKey: "your-key",
          models: [
            // 高端模型，严格限制
            {
              name: "gpt-4",
              rateLimit: {
                rpm: 50, // 每分钟 50 个请求
                tpm: 40000, // 每分钟 40k 个令牌
                rpd: 1000, // 每天 1000 个请求
              },
            },
            // 更便宜的模型，宽松限制
            {
              name: "gpt-3.5-turbo",
              rateLimit: {
                rpm: 200,
                tpm: 150000,
              },
            },
            // 此模型无速率限制
            "claude-instant",
          ],
        },
      ],
    },
  ],
  strategy: "rate-limit-aware",
});
```

### 速率限制类型

- **`rpm`**：每分钟请求数 - 每分钟最大 API 调用次数
- **`tpm`**：每分钟令牌数 - 每分钟最大输入令牌数
- **`rpd`**：每天请求数 - 每天最大 API 调用次数

路由器将自动选择能够处理您的请求而不超出速率限制的最佳可用模型。

## ⚙️ 高级功能：中间件

使用中间件扩展行为：

```ts
router.use(async (req, next) => {
  console.log("发出请求:", req.url);
  const start = Date.now();
  const res = await next(req);
  console.log("响应时间:", Date.now() - start, "ms");
  return res;
});

// 添加速率限制
router.use(rateLimit({ max: 1000 / 60 })); // 1000 RPM
```

构建您自己的缓存、跟踪或身份验证中间件。

## 🔁 负载均衡策略

```ts
new AIRouter({
  providers: [...],
  strategy: 'random' // 或 'least-loaded'
})
```

- `random`：随机选择（快速）
- `least-loaded`：选择最少繁忙的（需要健康跟踪）

## 🧪 在无服务器/边缘环境中运行

在 Vercel、Cloudflare Workers、Netlify 等环境中无缝工作：

```ts
// api/chat.js (Vercel 函数)
export default async function handler(req, res) {
  const { messages } = req.body;
  const response = await router.chat({ model: "gpt-4", messages });
  res.json(response);
}
```

## 📚 示例

探索示例以了解如何将 `ai-router` 与不同的框架和用例集成：

- [Hono AI Router 示例](./examples/hono-ai-router/)：演示如何将 `ai-router` 与
  Hono Web 框架一起使用，通过速率限制和负载均衡管理多个 AI 提供商。此示例还支持
  OpenAI 兼容的 API。

## 🛠️ 开发

```bash
git clone https://github.com/isaced/ai-router.git
cd ai-router
npm install
npm run build
npm test
```

欢迎贡献！有关详细信息，请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 📄 许可证

MIT

---

> 🌐 路由您的 AI。平衡您的负载。避免您的限制。
>
> 为构建 AI 未来的开发者用 ❤️ 制作。
