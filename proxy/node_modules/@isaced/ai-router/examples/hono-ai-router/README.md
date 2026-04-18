# Hono AI Router Example

A simple example demonstrating how to integrate
[ai-router](https://github.com/isaced/ai-router) with [Hono](https://hono.dev/)
web framework.

## Getting Started

This example shows how to use ai-router to manage multiple AI providers with
rate limiting and load balancing in a Hono application.

### Prerequisites

- Node.js or Bun runtime
- An OpenAI-compatible API key

### Installation

Install dependencies:

```bash
bun install
```

### Configuration

Set the required environment variables:

```bash
export OPENAI_API_BASE_URL="https://api.openai.com/v1"
export OPENAI_API_KEY="your-api-key-here"
export LLM_MODEL="gpt-3.5-turbo"
```

### Running the Project

Start the development server:

```bash
bun run start
```

Run a request

```bash
curl "http://localhost:3000/v1/chat/completions" \
  -H 'Content-Type: application/json' \
  -X POST \
  -d '{
    "messages": [
      {"role": "user", "content": "1+1=?"}
    ]
  }'
```

View rate limits

```
curl http://localhost:3000/stats
```
