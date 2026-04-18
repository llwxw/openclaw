#!/bin/bash
TIMESTAMP=$(date -Iseconds)
mkdir -p ~/.openclaw/workspace/.learnings
echo "## $TIMESTAMP" >> ~/.openclaw/workspace/.learnings/ERRORS.md
echo "- Command: $OPENCLAW_COMMAND" >> ~/.openclaw/workspace/.learnings/ERRORS.md
echo "- Error: $OPENCLAW_ERROR" >> ~/.openclaw/workspace/.learnings/ERRORS.md
echo "" >> ~/.openclaw/workspace/.learnings/ERRORS.md
