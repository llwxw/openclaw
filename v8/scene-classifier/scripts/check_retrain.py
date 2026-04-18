#!/usr/bin/env python3
"""检查是否需要重新训练分类器"""
import json
import os
import sys
import argparse

def count_low_confidence(log_file, threshold=0.5):
    """统计低置信度和歧义样本数"""
    if not os.path.exists(log_file):
        print(f"日志文件 {log_file} 不存在")
        return 0
    
    count = 0
    with open(log_file, 'r') as f:
        for line in f:
            try:
                event = json.loads(line)
                if event.get('meta') in ('low_confidence', 'ambiguous'):
                    if event.get('confidence', 0) < threshold:
                        count += 1
            except:
                pass
    return count

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--threshold', type=int, default=50, help='触发重训练的样本数阈值')
    parser.add_argument('--log-file', default='logs/meta_events.jsonl')
    parser.add_argument('--auto', action='store_true', help='自动执行重训练')
    args = parser.parse_args()
    
    # 使用脚本所在目录作为基准
    script_dir = os.path.dirname(os.path.abspath(__file__))
    log_path = os.path.join(script_dir, '..', args.log_file)
    log_path = os.path.normpath(log_path)
    
    count = count_low_confidence(log_path)
    print(f"低置信样本数: {count}")
    
    if count >= args.threshold:
        print(f"达到阈值 {args.threshold}，需要重训练")
        if args.auto:
            os.system('python scripts/train_classifier.py')
            sys.exit(0)
    else:
        print(f"未达阈值，无需重训练")
        sys.exit(1)

if __name__ == '__main__':
    main()