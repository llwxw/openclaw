"""
规则兜底分类器（当模型不可用时）
"""
import re


class RuleClassifier:
    def __init__(self):
        self.rules = [
            (r"任务.*完成|进度|状态|跑完了", "task_status_query"),
            (r"取消|停止|终止.*任务", "cancel_task"),
            (r"重构|分析.*代码|扫描|质量|优化.*项目", "task_multi_step"),
            (r"起不来|挂了|报错|失败|恢复|救|崩了|怎么办", "fault_recovery"),
            (r"^nginx$|^docker$|^python$", "vague_request"),
            (r"新手|不懂|入门|教我|第一次", "novice_user"),
            (r"底层|原理|epoll|B\+树|调度器|源码", "expert_user"),
            (r"rm -rf|删除|清理.*文件|chmod|修改权限", "high_risk_automated"),
            (r"天气|你好|谢谢|笑话|吃饭|叫什么", "chitchat"),
        ]
    
    def predict(self, text):
        text_lower = text.lower()
        for pattern, label in self.rules:
            if re.search(pattern, text_lower):
                return {
                    "label": label,
                    "confidence": 1.0,
                    "meta": "confident",
                    "top_candidates": [(label, 1.0)]
                }
        return {
            "label": None,
            "confidence": 0.0,
            "meta": "low_confidence",
            "top_candidates": []
        }
    
    @classmethod
    def load(cls, path=None):
        return cls()