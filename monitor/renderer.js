/**
 * Monitor Renderer
 * 将聚合结果渲染为 HTML
 */

export function render(data) {
  const { alerts, summary, ts } = data;
  
  // 状态判断
  let statusIcon, statusText, statusClass;
  if (summary.total === 0) {
    statusIcon = '✅';
    statusText = '系统正常';
    statusClass = 'status-ok';
  } else if (summary.high > 0) {
    statusIcon = '🔴';
    statusText = `需要行动 (${summary.total}个告警)`;
    statusClass = 'status-error';
  } else {
    statusIcon = '⚠️';
    statusText = `需要关注 (${summary.total}个告警)`;
    statusClass = 'status-warn';
  }
  
  // 告警列表 HTML
  const alertRows = alerts.map(alert => {
    const icon = alert.severity === 'high' ? '🔴' : alert.severity === 'medium' ? '⚠️' : 'ℹ️';
    return `
    <div class="alert-item ${alert.severity}">
      <div class="alert-header">
        <span class="alert-icon">${icon}</span>
        <span class="alert-type">${alert.type}</span>
        <span class="alert-severity">${alert.severity}</span>
      </div>
      <div class="alert-message">${alert.message}</div>
      ${alert.detail ? `<div class="alert-detail">${alert.detail}</div>` : ''}
    </div>`;
  }).join('');
  
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><title>OpenClaw Monitor</title>
<style>
*{box-sizing:border-box}
body{font-family:system-ui;background:#0f0f1a;color:#ddd;margin:0;padding:20px;min-height:100vh}
.status-bar{display:flex;align-items:center;gap:12px;padding:20px;background:#1a1a2e;border-radius:12px;margin-bottom:24px}
.status-icon{font-size:48px}
.status-text h2{margin:0;color:#fff}
.status-text p{margin:4px 0 0;color:#888}
.status-ok .status-icon{filter:grayscale(0)}
.status-warn .status-icon{filter:hue-rotate(30deg)}
.status-error .status-icon{filter:hue-rotate(-20deg) saturate(2)}
.alerts{${summary.total === 0 ? 'display:none' : ''}}
.alert-item{background:#1a1a2e;border-radius:8px;padding:16px;margin-bottom:12px;border-left:4px solid}
.alert-item.high{border-color:#ff4444}
.alert-item.medium{border-color:#ffaa00}
.alert-item.low{border-color:#888}
.alert-header{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.alert-icon{font-size:18px}
.alert-type{font-weight:600;color:#fff}
.alert-severity{background:#333;padding:2px 8px;border-radius:4px;font-size:12px;color:#888}
.alert-message{color:#ddd}
.alert-detail{color:#666;font-size:13px;margin-top:4px}
.diagnostic{background:#1a1a2e;border-radius:8px;padding:20px;margin-top:24px}
.diagnostic h3{color:#00d4ff;margin:0 0 12px;font-size:14px}
.diagnostic pre{background:#0f0f1a;padding:12px;border-radius:6px;overflow-x:auto;font-size:12px;color:#888;max-height:300px;overflow-y:auto}
.copy-btn{background:#00d4ff;color:#000;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:600;margin-top:12px}
.copy-btn:hover{background:#00b8e6}
.timestamp{color:#555;font-size:12px;margin-top:16px;text-align:center}
</style></head><body>

<div class="status-bar ${statusClass}">
  <span class="status-icon">${statusIcon}</span>
  <div class="status-text">
    <h2>${statusText}</h2>
    <p>${ts}</p>
  </div>
</div>

${summary.total > 0 ? `
<div class="alerts">
  <h3 style="color:#888;margin:0 0 12px;font-size:14px">告警详情</h3>
  ${alertRows}
</div>
` : `
<div style="text-align:center;padding:40px;color:#666">
  <p style="font-size:18px">🎉 系统运行正常，无异常告警</p>
</div>
`}

<div class="diagnostic">
  <h3>📋 诊断数据（复制发送给 AI）</h3>
  <pre>${JSON.stringify(data, null, 2)}</pre>
  <button class="copy-btn" onclick="navigator.clipboard.writeText(document.querySelector('pre').textContent)">复制诊断数据</button>
</div>

<div class="timestamp">页面每 30 秒自动刷新</div>
<script>setTimeout(()=>location.reload(),30000)</script>
</body></html>`;
}
