#!/usr/bin/env python3
"""清理 metrics JSONL 文件，保留最近7天数据"""
import sys, json
from datetime import datetime, timedelta

def cleanup(filepath, days=7):
    cutoff = datetime.now() - timedelta(days=days)
    try:
        with open(filepath) as f:
            lines = f.readlines()
    except:
        return
    
    kept = []
    for l in lines:
        try:
            obj = json.loads(l.strip())
            ts_str = obj.get('ts', '')
            if not ts_str:
                continue
            ts = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
            if ts > cutoff:
                kept.append(l)
        except:
            pass
    
    with open(filepath, 'w') as f:
        f.writelines(kept)
    
    print(f"kept {len(kept)} lines")

if __name__ == '__main__':
    if len(sys.argv) > 1:
        cleanup(sys.argv[1])
