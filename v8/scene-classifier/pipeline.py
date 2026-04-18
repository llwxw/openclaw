#!/usr/bin/env python3
"""
Pipeline 编排器 - 整合硬拦截、分类器、模板注入、LLM调用、后置校验
"""

import os
import sys

# 使用国内镜像
os.environ['HF_ENDPOINT'] = 'https://hf-mirror.com'

# 导入各层 - 添加 skills 目录到路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, '/home/ai/.openclaw/workspace/skills')
sys.path.insert(0, '/home/ai/.openclaw/workspace/skills/critical-interceptor')

from critical_interceptor import critical_intercept
from classifier.scene_classifier import SceneClassifier
from templates.template_map import get_template, fill_template


class OpenClawPipeline:
    def __init__(self, classifier_path=None):
        """
        初始化 Pipeline
        
        Args:
            classifier_path: 分类器模型路径，如果为 None 则不加载分类器
        """
        self.classifier = None
        if classifier_path and os.path.exists(classifier_path):
            try:
                self.classifier = SceneClassifier.load(classifier_path)
                print(f"Loaded classifier from {classifier_path}")
            except Exception as e:
                print(f"Failed to load classifier: {e}")
    
    def process(self, user_input: str, context: dict = None) -> dict:
        """
        处理用户输入
        
        Args:
            user_input: 用户输入
            context: 上下文（如任务状态）
            
        Returns:
            dict: {
                "response": str,      # 最终回复
                "intercepted": bool,  # 是否被硬拦截
                "scene": str,         # 识别的场景
                "confidence": float,  # 置信度
            }
        """
        context = context or {}
        
        # 1. 硬拦截层
        intercept_result = critical_intercept(user_input)
        if intercept_result.intercepted:
            return {
                "response": intercept_result.response,
                "intercepted": True,
                "scene": "CRITICAL",
                "confidence": 1.0
            }
        
        # 2. 场景分类（如果没有分类器，走默认）
        scene_label = "default"
        confidence = 0.0
        
        if self.classifier:
            scene_label, confidence = self.classifier.predict(user_input)
            if scene_label is None:
                scene_label = "default"
        
        # 3. 获取模板
        template = get_template(scene_label)
        
        # 4. 注入系统状态
        system_context = self._inject_system_state(context)
        
        # 5. 填充模板（这里先用占位符，真实 LLM 调用在后置处理）
        response = self._build_response(user_input, scene_label, template, context, system_context)
        
        # 6. 后置校验
        response = self._post_validate(response, scene_label)
        
        return {
            "response": response,
            "intercepted": False,
            "scene": scene_label,
            "confidence": confidence
        }
    
    def _inject_system_state(self, context):
        """从上下文获取任务状态"""
        if "task_id" in context:
            task = context.get("task", {})
            return f"[系统] 任务 {context['task_id']} 状态：{task.get('status', 'unknown')}，进度：{task.get('progress', 0)}%"
        return ""
    
    def _build_response(self, user_input, scene_label, template, user_context, system_context):
        """构建回复（模板填充）"""
        # 根据场景填充不同参数
        if scene_label == "task_multi_step":
            return fill_template(
                scene_label,
                task_id=user_context.get("task_id", "pending"),
                duration=user_context.get("duration", "待估算"),
                context=system_context
            )
        elif scene_label == "fault_recovery":
            return fill_template(
                scene_label,
                step1="检查日志",
                step2="回滚配置",
                step3="重启服务",
                lesson="下次修改配置前建议先备份",
                context=system_context
            )
        elif scene_label == "vague_request":
            return fill_template(
                scene_label,
                option1="安装配置",
                option2="常用命令",
                option3="性能调优",
                context=system_context
            )
        elif scene_label == "high_risk_automated":
            return fill_template(
                scene_label,
                operation=user_input,
                risk_description="可能造成数据丢失或服务中断",
                mitigation="请先在测试环境验证",
                context=system_context
            )
        elif scene_label == "task_status_query":
            task_id = user_context.get("task_id", "unknown")
            return fill_template(
                scene_label,
                task_id=task_id,
                status=user_context.get("status", "unknown"),
                progress=user_context.get("progress", 0),
                additional_info=user_context.get("additional_info", ""),
                context=system_context
            )
        else:
            # 默认模板
            return fill_template(
                scene_label,
                user_input=user_input,
                analysis="我正在分析你的请求...",
                context=system_context
            )
    
    def _post_validate(self, response, scene_label):
        """后置校验：检查是否包含禁止内容"""
        # 高风险场景必须包含 [!WARNING]
        if scene_label in ["high_risk_automated", "fault_recovery"]:
            if "[!WARNING]" not in response and "[!WARNING]" not in response:
                response = "[!WARNING] 此操作具有风险，请谨慎执行。\n" + response
        
        # 禁止无意义内容
        endings = ["祝你顺利", "有其他问题吗", "请问还有什么需要"]
        for ending in endings:
            if ending in response:
                response = response.replace(ending, "")
        
        return response.strip()


# 测试
if __name__ == "__main__":
    pipeline = OpenClawPipeline()
    
    test_cases = [
        "帮我格式化磁盘",
        "帮我分析代码质量",
        "服务器起不来了",
        "nginx",
        "我是新手",
        "任务123完成了吗",
    ]
    
    print("=== Pipeline 测试 ===\n")
    for text in test_cases:
        result = pipeline.process(text)
        print(f"Input: {text}")
        print(f"  Scene: {result['scene']}, Intercepted: {result['intercepted']}")
        print(f"  Response: {result['response'][:100]}...")
        print()