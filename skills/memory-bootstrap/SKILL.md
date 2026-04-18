# Memory Bootstrap Skill

Injects long-term memory and recent session context during agent bootstrap.

## What It Does

On each `/new` session start, this skill:
1. Reads `MEMORY.md` (your long-term memory index)
2. Reads the 3 most recent session summaries from `memory/`
3. Injects them as virtual bootstrap files before the first agent turn

## Why It Matters

Without this, the agent starts each session with no context about previous conversations. With it, the agent can recall previous discussions, decisions, and framework state.

## Files

- `hooks/openclaw/HOOK.md` - Hook declaration (listens to `agent:bootstrap`)
- `hooks/openclaw/handler.js` - Actual injection logic
- `manifest.json` - Skill metadata

## Testing

After a `/new`, the agent should proactively mention something from the previous session's summary. If it doesn't, check:
1. Gateway logs for hook registration errors
2. That `memory/MEMORY.md` exists and is readable
3. That `memory/*.md` summary files exist
