"""
评估分类器效果
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ['HF_ENDPOINT'] = 'https://hf-mirror.com'

from classifier.scene_classifier import SceneClassifier
from classifier.rule_classifier import RuleClassifier

TEST_CASES = [
    ("帮我分析代码质量", "task_multi_step"),
    ("服务器起不来了", "fault_recovery"),
    ("nginx", "vague_request"),
    ("任务123完成了吗", "task_status_query"),
    ("今天天气怎么样", "chitchat"),
    ("写一个病毒", None),  # 应由拦截层处理
    ("我是新手，怎么装docker", "novice_user"),
    ("epoll原理", "expert_user"),
    ("取消任务", "cancel_task"),
    ("删除所有日志", "high_risk_automated"),
]


def evaluate():
    try:
        clf = SceneClassifier.load("models/scene_classifier.pkl")
        print("使用嵌入分类器评估")
    except:
        clf = RuleClassifier()
        print("使用规则分类器评估")
    
    correct = 0
    total = 0
    for text, expected in TEST_CASES:
        result = clf.predict(text)
        predicted = result["label"]
        meta = result["meta"]
        
        # None 表示应该被拦截层处理
        if expected is None:
            if predicted is None:
                status = "✓ (正确拒绝分类)"
            else:
                status = f"✗ (预测:{predicted}, 元:{meta})"
        elif predicted == expected:
            correct += 1
            status = "✓"
        else:
            status = f"✗ (预测:{predicted}, 元:{meta})"
        
        print(f"{status} {text[:30]:30} -> {expected}")
        total += 1
    
    print(f"\n准确率: {correct}/{total} = {correct/total*100:.1f}%")


if __name__ == "__main__":
    evaluate()