#!/bin/bash
# 简单的 Gateway 切换脚本

ACTION=$1

case $ACTION in
  proxy)
    echo "[切换] 停用 3102，启动 3105..."
    pkill -f "node.*index.js" 2>/dev/null || true
    sleep 1
    # 启动代理在 3105
    cd ~/.openclaw/proxy && nohup ~/.nvm/versions/node/v22.22.1/bin/node index.js > /tmp/proxy.log 2>&1 &
    sleep 2
    echo "代理已启动在 3105"
    ss -tlnp | grep 3105
    ;;
  gateway)
    echo "[切换] 启动原始 Gateway 在 3102..."
    cd ~/.nvm/versions/node/v22.22.1/lib/node_modules/openclaw && nohup ~/.nvm/versions/node/v22.22.1/bin/node openclaw.mjs gateway start > /tmp/gateway.log 2>&1 &
    sleep 3
    echo "Gateway 已启动在 3102"
    ss -tlnp | grep 3102
    ;;
  status)
    ss -tlnp | grep -E "3102|3105"
    ;;
  *)
    echo "用法: $0 {proxy|gateway|status}"
    ;;
esac
