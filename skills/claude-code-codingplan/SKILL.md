---
name: claude-code-codingplan
description: Configure Claude Code CLI to use CodingPlan API (compatible OpenAI format). Use when user wants to run Claude Code CLI directly with their CodingPlan API key, or when Claude Code CLI fails with authentication errors.
---

# Claude Code + CodingPlan Configuration

This skill configures the Claude Code CLI to authenticate via CodingPlan API instead of Anthropic's default API.

## When to Use

- User wants to run `claude` command directly in terminal
- Claude Code CLI shows "Authentication required" or API errors
- User provides CodingPlan API endpoint and key

## Steps

### 1. Collect API Credentials

Ask user for:
- **API URL**: e.g., `https://zhenze-huhehaote.cmecloud.cn/api/coding`
- **API Key**: The CodingPlan API key
- **Model**: (optional) defaults to `minimax-m2.5`

### 2. Create Environment File

Write to `~/.openclaw/claude.env`:

```bash
# Coding Plan API 配置
export ANTHROPIC_AUTH_TOKEN="<API_KEY>"
export ANTHROPIC_BASE_URL="<API_URL>/v1"
export ANTHROPIC_MODEL="minimax-m2.5"
```

### 3. Verify Configuration

```bash
source ~/.openclaw/claude.env && claude --print -p "Say hi"
```

Expected: Claude responds successfully using the specified model.

## Notes

- OpenClaw itself uses `openclaw.json` for API configuration—this skill is only for direct `claude` CLI usage
- The base URL should end with `/v1` for OpenAI-compatible endpoints
- Model name depends on what CodingPlan provider supports (common: `minimax-m2.5`)