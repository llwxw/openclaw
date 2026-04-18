---
name: memory-bootstrap
description: "Injects MEMORY.md and recent session summaries during agent bootstrap"
metadata: {"openclaw":{"emoji":"🧠","events":["agent:bootstrap"]}}
---

# Memory Bootstrap Hook

Injects long-term memory (MEMORY.md) and recent session summaries into the agent context during bootstrap.

## What It Does

- Fires on `agent:bootstrap` (before workspace files are injected)
- Reads `memory/MEMORY.md` (long-term memory index)
- Reads recent session summaries from `memory/` directory
- Injects them as virtual bootstrap files

## Configuration

No configuration needed. Enable with:

```bash
openclaw skills enable memory-bootstrap
```
