"""
反馈收集与迭代优化触发器
"""
import json
import os
from collections import defaultdict


class FeedbackCollector:
    def __init__(self, log_file="logs/meta_events.jsonl"):
        self.log_file = log_file
        self.low_confidence_samples = []
        self.ambiguous_samples = []
    
    def collect_low_confidence(self):
        """从日志中提取低置信度样本"""
        if not os.path.exists(self.log_file):
            return []
        
        samples = []
        with open(self.log_file, 'r', encoding='utf-8') as f:
            for line in f:
                try:
                    entry = json.loads(line)
                    for event in entry.get("meta_events", []):
                        if event.get("meta") == "low_confidence":
                            samples.append({
                                "input": entry["user_input"],
                                "confidence": event["confidence"],
                                "candidates": event.get("top_candidates", [])
                            })
                except:
                    continue
        return samples
    
    def generate_training_patch(self, output_file="data/new_samples.json"):
        """生成待标注样本，供人工审核后加入训练集"""
        low_conf = self.collect_low_confidence()
        
        os.makedirs(os.path.dirname(output_file) if os.path.dirname(output_file) else "data", exist_ok=True)
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(low_conf, f, ensure_ascii=False, indent=2)
        print(f"提取 {len(low_conf)} 条低置信度样本到 {output_file}")
        return low_conf


def check_retrain_needed(threshold=50):
    """检查是否需要重新训练"""
    collector = FeedbackCollector()
    samples = collector.collect_low_confidence()
    if len(samples) >= threshold:
        print(f"累积 {len(samples)} 条低置信度样本，建议重新训练")
        return True
    return False


if __name__ == "__main__":
    collector = FeedbackCollector()
    samples = collector.collect_low_confidence()
    print(f"低置信度样本数: {len(samples)}")
    
    if len(samples) > 0:
        collector.generate_training_patch()