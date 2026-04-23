#!/bin/bash
# Start OpenClaw Monitor (diagnostic panel on port 18790)
# Auto-restart via systemd: openclaw-monitor.service

exec /usr/bin/node /home/ai/.openclaw/monitor/server.js