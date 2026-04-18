#!/bin/bash
cd /home/ai/.openclaw/context-api
node index.js >> logs/api.log 2>&1 &
echo "PID: $!"
sleep 3
ss -tlnp | grep 3101 && echo "3101 OK"
