#!/usr/bin/env python3
"""
Scene Classifier - 场景分类器

5个核心模块：
1. data/synthetic_training_data.py - 训练数据构造
2. classifier/scene_classifier.py - 基于嵌入向量的分类器
3. scripts/train_classifier.py - 训练脚本
4. pipeline.py - 模板注入与 LLM 调用集成
5. feedback/collector.py - 迭代优化闭环

使用方式：
    from scene_classifier import pipeline
    
    result = pipeline.process("帮我分析代码质量")
    print(result["response"])
"""

from .pipeline import OpenClawPipeline
from .classifier.scene_classifier import SceneClassifier
from .feedback.collector import FeedbackLoop
from .data.synthetic_training_data import generate_training_data, get_scene_template

__all__ = [
    "OpenClawPipeline",
    "SceneClassifier", 
    "FeedbackLoop",
    "generate_training_data",
    "get_scene_template",
]

__version__ = "1.0.0"