"""
主流水线：整合硬拦截、分类（含元判断）、模板注入、LLM调用、后置校验、日志记录
"""
import json
import time
import uuid
import os
from datetime import datetime

# 导入各模块
from interceptors.critical_interceptor import critical_intercept
from templates.template_map import TEMPLATE_MAP

# 尝试加载模型分类器，失败则用规则分类器
SCENE_CLASSIFIER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_PATH = os.path.join(SCENE_CLASSIFIER_DIR, "models/scene_classifier.pkl")

try:
    os.environ['HF_ENDPOINT'] = 'https://hf-mirror.com'
    from classifier.scene_classifier import SceneClassifier
    classifier = SceneClassifier.load(MODEL_PATH)
    print(f"Loaded embedding classifier from {MODEL_PATH}")
except (ImportError, FileNotFoundError) as e:
    print(f"Using rule-based fallback classifier: {e}")
    from classifier.rule_classifier import RuleClassifier
    classifier = RuleClassifier()


class PipelineOrchestrator:
    def __init__(self, log_file=None):
        if log_file is None:
            # 使用绝对路径
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            log_file = os.path.join(base_dir, "logs/meta_events.jsonl")
        self.log_file = log_file
        self.llm_call = self._mock_llm  # 可替换为真实LLM调用
        
        # 确保日志目录存在
        os.makedirs(os.path.dirname(log_file) if os.path.dirname(log_file) else "logs", exist_ok=True)
    
    def process(self, user_input, context=None):
        """
        处理单次用户输入
        context: dict，可包含 task_id, history 等
        """
        meta_events = []
        response = None
        
        # 1. 硬拦截
        block = critical_intercept(user_input)
        if block:
            meta_events.append({"stage": "critical_intercept", "action": "blocked"})
            self._log(user_input, meta_events, response=block)
            return {
                "response": block,
                "intercepted": True,
                "scene": "CRITICAL"
            }
        
        # 2. 场景分类 + 元判断
        classify_result = classifier.predict(user_input)
        meta_events.append({
            "stage": "classification",
            "meta": classify_result["meta"],
            "confidence": classify_result["confidence"],
            "top_candidates": classify_result["top_candidates"]
        })
        
        # 3. 选择模板
        if classify_result["meta"] in ("low_confidence", "ambiguous"):
            template_key = "clarify"
            candidates = [c[0] for c in classify_result["top_candidates"]]
            template_vars = {"candidates": " / ".join(candidates) if candidates else "任务操作、故障排查、闲聊等"}
        else:
            template_key = classify_result["label"] or "default"
            template_vars = self._prepare_template_vars(template_key, context)
        
        template = TEMPLATE_MAP.get(template_key, TEMPLATE_MAP["default"])
        
        # 4. 注入系统状态
        system_state = self._inject_system_state(context)
        full_prompt = f"{system_state}\n{template.format(**template_vars)}\n用户输入：{user_input}"
        
        # 5. 调用LLM
        llm_response = self.llm_call(full_prompt)
        
        # 6. 后置校验 + 元判断
        post_result = self._post_validate(llm_response, template_key)
        meta_events.append(post_result)
        
        if not post_result["valid"]:
            # 简单修复：追加警告
            if "missing_warning" in post_result.get("issues", []):
                llm_response = "[!WARNING] 此操作具有风险。\n" + llm_response
            if "missing_rollback" in post_result.get("issues", []):
                llm_response += "\n\n回滚方法：请从备份恢复或逆向操作。"
        
        response = llm_response
        
        # 7. 记录日志
        self._log(user_input, meta_events, response)
        
        return {
            "response": response,
            "intercepted": False,
            "scene": template_key,
            "meta": classify_result["meta"],
            "confidence": classify_result["confidence"]
        }
    
    def _prepare_template_vars(self, template_key, context):
        """准备模板变量"""
        task_id = context.get("task_id") if context else "unknown"
        return {
            "task_id": task_id,
            "duration": "约2分钟",
            "extra_warning": "",
            "recovery_steps": "1. 重启服务\n2. 检查日志\n3. 恢复配置文件",
            "lesson": "操作前建议先备份",
            "options": "1. 安装配置\n2. 常用命令\n3. 性能调优",
            "expert_answer": "直接给出核心配置或原理",
            "explanation": "该命令用于查看当前目录下的文件列表",
            "steps": "1. 打开终端\n2. 输入 ls\n3. 按回车",
            "status": "执行中",
            "progress": "45",
            "extra_info": "",
            "result": "任务已取消",
            "risk_description": "批量删除文件不可恢复",
            "rollback": "从备份恢复",
            "response": "有什么我可以帮你的吗？",
        }
    
    def _inject_system_state(self, context):
        """从编排器获取任务状态并注入"""
        if context and "task_id" in context:
            return f"[系统] 任务 {context['task_id']} 状态：执行中，进度：45%"
        return ""
    
    def _post_validate(self, response, template_key):
        """后置校验"""
        issues = []
        if template_key in ("high_risk_automated", "task_multi_step"):
            if "[!WARNING]" not in response:
                issues.append("missing_warning")
        if template_key == "high_risk_automated" and "回滚" not in response:
            issues.append("missing_rollback")
        
        return {
            "stage": "post_validation",
            "valid": len(issues) == 0,
            "issues": issues
        }
    
    def _log(self, user_input, meta_events, response):
        """记录元判断事件"""
        # 转换 numpy 类型为 Python 原生类型
        def convert(obj):
            if hasattr(obj, 'item'):  # numpy types
                return obj.item()
            return obj
        
        meta_events_clean = []
        for event in meta_events:
            event_clean = {}
            for k, v in event.items():
                if isinstance(v, (list, tuple)):
                    event_clean[k] = [[c[0], convert(c[1])] for c in v]
                else:
                    event_clean[k] = convert(v)
            meta_events_clean.append(event_clean)
        
        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "user_input": user_input,
            "meta_events": meta_events_clean,
            "response_preview": response[:100] + "..." if len(response) > 100 else response
        }
        with open(self.log_file, 'a', encoding='utf-8') as f:
            f.write(json.dumps(log_entry, ensure_ascii=False) + '\n')
    
    def _mock_llm(self, prompt):
        """模拟LLM调用（实际应替换为真实API）"""
        return f"[LLM响应] 基于你的输入，建议操作如下：..."


# 全局单例
pipeline = PipelineOrchestrator()


def process_input(user_input, context=None):
    return pipeline.process(user_input, context)